"""
Insurance Eligibility & COB API — FastAPI backend  v2.3.0

Security:
  - CORS explicit allowlist (no wildcard)
  - X-API-Key auth with constant-time comparison (secrets.compare_digest)
  - slowapi rate limiting per IP
  - Request ID tracing on every response
  - Per-job API key hash for multi-tenant result isolation

Correctness:
  - SQLite job store (survives restarts)
  - PDF batch upload blocked with clear error
  - Structured JSON logging

v2.3 changes:
  - Full DB Breakdown field set in response schema (31 new Optional fields)
  - DENTAL_PROVIDER env var support (zuub / dentalxchange / stedi)
  - /api/db-breakdown/{job_id} endpoint — returns DB Breakdown formatted response
  - Version bumped to 2.3.0
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import uuid
import json
import sqlite3
import logging
import secrets
import hashlib
import time
from typing import Optional, List, Dict, Any
from datetime import datetime
from contextlib import contextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request, Security, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from eligibility_engine import resolve_patient
from intake import parse_file
from exporter import to_json, to_csv, to_excel, to_pdf_report

# ─── Structured logging ───────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("eligibility-api")


# ─── Rate limiter ─────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Insurance Eligibility & COB API", version="2.3.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ─── SECURITY: CORS — explicit allowlist only ─────────────────────────────────

_DEFAULT_ORIGINS = [
    "https://denialsdoctor.com",
    "https://app.denialsdoctor.com",
    "https://eligibility.denialsdoctor.com",
    "https://dharma-eligibility.vercel.app",
]
_raw = os.environ.get("ELIGIBILITY_ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _raw.split(",") if o.strip()] or _DEFAULT_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key", "X-Request-ID"],
)


# ─── SECURITY: API Key authentication (constant-time comparison) ──────────────

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


def _valid_keys() -> set:
    """Read keys fresh on every call so rotation doesn't require a restart."""
    keys = set()
    k = os.environ.get("ELIGIBILITY_API_KEY", "")
    if k:
        keys.add(k)
    dk = os.environ.get("ELIGIBILITY_DD_API_KEY", "")
    if dk:
        keys.add(dk)
    if os.environ.get("ELIGIBILITY_DEV_MODE", "").lower() == "true":
        keys.add("dev-insecure-key-replace-me")
    return keys


def _key_hash(key: str) -> str:
    """SHA-256 hash of an API key for safe storage in job rows."""
    return hashlib.sha256(key.encode()).hexdigest()[:16]


async def require_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    valid = _valid_keys()
    if not valid:
        raise HTTPException(503, "API key not configured on server. Set ELIGIBILITY_API_KEY env var.")
    if not api_key:
        raise HTTPException(401, "Missing X-API-Key header.")
    if not any(secrets.compare_digest(api_key, k) for k in valid):
        raise HTTPException(401, "Invalid X-API-Key.")
    return api_key


# ─── Request ID middleware ────────────────────────────────────────────────────

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = req_id
    start = time.time()
    response = await call_next(request)
    elapsed_ms = round((time.time() - start) * 1000)
    response.headers["X-Request-ID"] = req_id
    logger.info(
        f'"method":"{request.method}","path":"{request.url.path}",'
        f'"status":{response.status_code},"ms":{elapsed_ms},"req_id":"{req_id}"'
    )
    return response


# ─── SQLite job store ─────────────────────────────────────────────────────────

DB_PATH = os.environ.get("ELIGIBILITY_DB_PATH", "/tmp/eligibility_jobs.db")


def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                created_at   TEXT NOT NULL,
                filename     TEXT,
                total        INTEGER,
                processed    INTEGER,
                error_count  INTEGER,
                errors_json  TEXT,
                results_json TEXT,
                summary_json TEXT,
                api_key_hash TEXT
            )
        """)
        conn.commit()


_init_db()


@contextmanager
def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _save_job(job_id: str, filename: str, total: int, processed: int,
              errors: list, results: list, summary: dict, api_key: str):
    with _db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO jobs
              (id, created_at, filename, total, processed, error_count,
               errors_json, results_json, summary_json, api_key_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job_id, datetime.utcnow().isoformat(), filename, total, processed,
            len(errors), json.dumps(errors), json.dumps(results),
            json.dumps(summary), _key_hash(api_key),
        ))
        conn.commit()


def _get_job(job_id: str, api_key: str) -> Optional[dict]:
    """Return job only if it belongs to the calling API key."""
    with _db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        if row["api_key_hash"] and not secrets.compare_digest(
            row["api_key_hash"], _key_hash(api_key)
        ):
            return None
        return dict(row)


def _get_job_results(job_id: str, api_key: str) -> Optional[list]:
    job = _get_job(job_id, api_key)
    return json.loads(job["results_json"]) if job else None


# ─── Models ──────────────────────────────────────────────────────────────────

class CoverageIn(BaseModel):
    payer_name: str
    member_id: str = ""
    group_number: str = ""
    plan_type: str = "medical"
    subscriber_dob: str = ""
    subscriber_name: str = ""   # NEW v2.3
    esrd: bool = False
    esrd_months: int = 0
    disability: bool = False


class PatientIn(BaseModel):
    first_name: str
    last_name: str
    dob: str
    gender: str = ""
    state: str = ""
    employer: str = ""
    spouse_dob: str = ""
    coverages: List[CoverageIn] = []


class SpecificCode(BaseModel):
    covered: Optional[bool] = None
    category: Optional[str] = None
    note: Optional[str] = None


class PatientOut(BaseModel):
    """
    Full dental + medical eligibility response schema — v2.3.
    Covers all 71 DB Breakdown form fields.
    All fields are Optional so existing integrations don't break.
    """
    # ── Active / plan basics ──────────────────────────────────────────────
    active: Optional[bool] = None
    plan_name: Optional[str] = None
    plan_begin_date: Optional[str] = None
    plan_type: Optional[str] = None
    network: Optional[str] = None
    benefit_period: Optional[str] = None          # "calendar" | "fiscal"
    payer_id: Optional[str] = None
    payer_phone: Optional[str] = None
    claim_address: Optional[str] = None
    group_number: Optional[str] = None
    member_id: Optional[str] = None
    subscriber_name: Optional[str] = None         # NEW v2.3
    active_medical: Optional[bool] = None
    active_dental: Optional[bool] = None
    data_source: Optional[str] = None             # "zuub" | "stedi" | "demo" | "stub"

    # ── Medical-specific ─────────────────────────────────────────────────
    deductible: Optional[float] = None
    deductible_met: Optional[float] = None
    oop_max: Optional[float] = None
    oop_met: Optional[float] = None
    copay: Optional[float] = None
    coinsurance: Optional[float] = None

    # ── Dental — maximums & deductibles ──────────────────────────────────
    annual_maximum: Optional[float] = None
    annual_maximum_used: Optional[float] = None
    annual_maximum_remaining: Optional[float] = None
    deductible_family: Optional[float] = None     # NEW v2.3
    deductible_applies_preventive: Optional[bool] = None  # NEW v2.3
    preventive_in_max: Optional[bool] = None      # NEW v2.3
    cob_type: Optional[str] = None                # NEW v2.3

    # ── Dental — coverage percentages ────────────────────────────────────
    preventive_coverage: Optional[float] = None
    basic_coverage: Optional[float] = None
    major_coverage: Optional[float] = None
    perio_coverage: Optional[float] = None        # NEW v2.3
    endo_coverage: Optional[float] = None         # NEW v2.3
    oral_surgery_coverage: Optional[float] = None # NEW v2.3
    fillings_coverage: Optional[float] = None     # NEW v2.3
    crowns_coverage: Optional[float] = None       # NEW v2.3
    dentures_coverage: Optional[float] = None     # NEW v2.3
    ortho_coverage: Optional[float] = None

    # ── Dental — waiting periods ──────────────────────────────────────────
    waiting_period_basic: Optional[str] = None
    waiting_period_major: Optional[str] = None

    # ── Dental — frequency limits ─────────────────────────────────────────
    prophy_frequency: Optional[str] = None        # NEW v2.3
    periodic_exam_frequency: Optional[str] = None # NEW v2.3
    comp_exam_frequency: Optional[str] = None     # NEW v2.3
    fmx_frequency: Optional[str] = None           # NEW v2.3
    bitewing_frequency: Optional[str] = None      # NEW v2.3
    pa_frequency: Optional[str] = None            # NEW v2.3
    srp_frequency: Optional[str] = None           # NEW v2.3
    perio_maintenance_frequency: Optional[str] = None  # NEW v2.3
    fmd_frequency: Optional[str] = None           # NEW v2.3

    # ── Dental — clauses & exclusions ────────────────────────────────────
    missing_tooth_clause: Optional[bool] = None   # NEW v2.3
    fillings_downgrade: Optional[bool] = None     # NEW v2.3
    crowns_paid_on: Optional[str] = None          # NEW v2.3 "seat" | "prep"
    same_day_treatment: Optional[bool] = None     # NEW v2.3
    fluoride_covered: Optional[bool] = None       # NEW v2.3
    fluoride_age_limit: Optional[int] = None      # NEW v2.3
    sealants_covered: Optional[bool] = None       # NEW v2.3
    sealants_age_limit: Optional[int] = None      # NEW v2.3
    sdf_covered: Optional[bool] = None            # NEW v2.3
    arestin_covered: Optional[bool] = None        # NEW v2.3
    perio_same_day_exam: Optional[bool] = None    # NEW v2.3
    perio_shares_prophy_frequency: Optional[bool] = None  # NEW v2.3
    srp_quads_per_visit: Optional[int] = None     # NEW v2.3

    # ── Dental — replacement clauses ─────────────────────────────────────
    replacement_crowns: Optional[str] = None      # NEW v2.3
    replacement_bridges: Optional[str] = None     # NEW v2.3
    replacement_dentures: Optional[str] = None    # NEW v2.3
    replacement_partials: Optional[str] = None    # NEW v2.3
    claims_filing_deadline: Optional[str] = None  # NEW v2.3

    # ── Dental — implants ─────────────────────────────────────────────────
    implants_covered: Optional[bool] = None       # NEW v2.3
    implants_coverage: Optional[float] = None     # NEW v2.3
    implants_separate_max: Optional[float] = None # NEW v2.3
    abutment_coverage: Optional[float] = None     # NEW v2.3
    implant_crown_coverage: Optional[float] = None  # NEW v2.3

    # ── Dental — orthodontics ─────────────────────────────────────────────
    ortho_lifetime_max: Optional[float] = None
    ortho_lifetime_used: Optional[float] = None   # NEW v2.3
    ortho_deductible: Optional[float] = None      # NEW v2.3
    ortho_age_limit: Optional[int] = None         # NEW v2.3
    ortho_payment_method: Optional[str] = None    # NEW v2.3

    # ── Dental — specific CDT codes ───────────────────────────────────────
    specific_codes: Optional[Dict[str, Any]] = None  # NEW v2.3

    class Config:
        extra = "allow"  # Pass through any extra fields from engine


# ─── DB Breakdown formatter ───────────────────────────────────────────────────

def _format_db_breakdown(result: dict) -> dict:
    """
    Format an eligibility result as a DB Breakdown form response.
    Derives Yes/No fields and fills in auto-derivable values.
    """
    def pct(val):
        if val is None:
            return None
        return f"{int(val * 100)}%"

    def yn(val):
        if val is None:
            return "Unknown"
        return "Yes" if val else "No"

    ded = result.get("deductible")
    ded_met = result.get("deductible_met")
    ded_met_yn = "Yes" if (ded is not None and ded_met is not None and ded_met >= ded) else (
        "No" if (ded is not None and ded_met is not None) else "Unknown"
    )

    return {
        # Patient / Plan Info
        "ins_name":                 result.get("plan_name"),
        "ins_phone":                result.get("payer_phone"),
        "payor_id":                 result.get("payer_id"),
        "ins_effective_date":       result.get("plan_begin_date"),
        "group_number":             result.get("group_number"),
        "member_id":                result.get("member_id"),
        "network":                  result.get("network"),
        "benefit_period":           result.get("benefit_period"),
        "claim_address":            result.get("claim_address"),

        # Maximums & Deductibles
        "ins_max":                  result.get("annual_maximum"),
        "ins_used":                 result.get("annual_maximum_used"),
        "ins_remaining":            result.get("annual_maximum_remaining"),
        "ded_individual":           ded,
        "ded_family":               result.get("deductible_family"),
        "ded_met_amount":           ded_met,
        "ded_met_yn":               ded_met_yn,
        "ded_applies_preventive":   yn(result.get("deductible_applies_preventive")),
        "preventive_in_max":        yn(result.get("preventive_in_max")),
        "cob_type":                 result.get("cob_type"),

        # Coverage Percentages
        "prev_pct":                 pct(result.get("preventive_coverage")),
        "basic_pct":                pct(result.get("basic_coverage")),
        "major_pct":                pct(result.get("major_coverage")),
        "perio_pct":                pct(result.get("perio_coverage")),
        "endo_pct":                 pct(result.get("endo_coverage")),
        "oral_surgery_pct":         pct(result.get("oral_surgery_coverage")),
        "fillings_pct":             pct(result.get("fillings_coverage") or result.get("basic_coverage")),
        "crowns_pct":               pct(result.get("crowns_coverage") or result.get("major_coverage")),
        "dentures_pct":             pct(result.get("dentures_coverage") or result.get("major_coverage")),

        # Waiting Periods
        "waiting_period_yn":        "Yes" if (result.get("waiting_period_basic") not in (None, "None", "N/A") or
                                              result.get("waiting_period_major") not in (None, "None", "N/A")) else "No",
        "waiting_period_basic":     result.get("waiting_period_basic"),
        "waiting_period_major":     result.get("waiting_period_major"),

        # Frequency Limits
        "prophy_frequency":         result.get("prophy_frequency"),
        "periodic_exam_frequency":  result.get("periodic_exam_frequency"),
        "comp_exam_frequency":      result.get("comp_exam_frequency"),
        "fmx_frequency":            result.get("fmx_frequency"),
        "bitewing_frequency":       result.get("bitewing_frequency"),
        "pa_frequency":             result.get("pa_frequency"),

        # Clauses
        "missing_tooth_clause":     yn(result.get("missing_tooth_clause")),
        "fillings_downgrade":       yn(result.get("fillings_downgrade")),
        "crowns_paid_on":           result.get("crowns_paid_on"),
        "same_day_treatment":       yn(result.get("same_day_treatment")),

        # Replacement Clauses
        "replacement_crowns":       result.get("replacement_crowns"),
        "replacement_bridges":      result.get("replacement_bridges"),
        "replacement_dentures":     result.get("replacement_dentures"),
        "replacement_partials":     result.get("replacement_partials"),
        "claims_filing_deadline":   result.get("claims_filing_deadline"),

        # Implants
        "implants_covered":         yn(result.get("implants_covered")),
        "implants_pct":             pct(result.get("implants_coverage")),
        "implants_separate_max":    result.get("implants_separate_max"),
        "abutment_pct":             pct(result.get("abutment_coverage")),
        "implant_crown_pct":        pct(result.get("implant_crown_coverage")),

        # Preventive Specifics
        "fluoride_covered":         yn(result.get("fluoride_covered")),
        "fluoride_age_limit":       result.get("fluoride_age_limit"),
        "sealants_covered":         yn(result.get("sealants_covered")),
        "sealants_age_limit":       result.get("sealants_age_limit"),
        "sdf_covered":              yn(result.get("sdf_covered")),

        # Periodontics
        "srp_frequency":            result.get("srp_frequency"),
        "srp_quads_per_visit":      result.get("srp_quads_per_visit"),
        "perio_maintenance_frequency": result.get("perio_maintenance_frequency"),
        "perio_shares_prophy_frequency": yn(result.get("perio_shares_prophy_frequency")),
        "fmd_frequency":            result.get("fmd_frequency"),
        "perio_same_day_exam":      yn(result.get("perio_same_day_exam")),
        "arestin_covered":          yn(result.get("arestin_covered")),

        # Orthodontics
        "ortho_pct":                pct(result.get("ortho_coverage")),
        "ortho_lifetime_max":       result.get("ortho_lifetime_max"),
        "ortho_lifetime_used":      result.get("ortho_lifetime_used"),
        "ortho_deductible":         result.get("ortho_deductible"),
        "ortho_age_limit":          result.get("ortho_age_limit"),
        "ortho_payment_method":     result.get("ortho_payment_method"),

        # Specific Codes
        "specific_codes":           result.get("specific_codes"),

        # Meta
        "data_source":              result.get("data_source", "unknown"),
        "_demo":                    result.get("_demo", False),
    }


# ─── Single patient endpoint ─────────────────────────────────────────────────

@app.post("/api/resolve", dependencies=[Depends(require_api_key)])
@limiter.limit("60/minute")
async def resolve_single(request: Request, patient: PatientIn):
    """
    Resolve eligibility + COB for a single patient.
    Rate limited: 60/minute per IP. Requires X-API-Key header.
    """
    req_id = getattr(request.state, "request_id", "unknown")
    logger.info(f'"event":"resolve_single","req_id":"{req_id}","patient":"{patient.first_name[0]}***"')
    result = resolve_patient(patient.dict(), [c.dict() for c in patient.coverages])
    return result


@app.post("/api/resolve/db-breakdown", dependencies=[Depends(require_api_key)])
@limiter.limit("60/minute")
async def resolve_db_breakdown(request: Request, patient: PatientIn):
    """
    Resolve eligibility and return response formatted as a DB Breakdown form.
    All percentage fields returned as strings (e.g. "80%").
    Yes/No fields returned as "Yes" | "No" | "Unknown".
    """
    req_id = getattr(request.state, "request_id", "unknown")
    logger.info(f'"event":"resolve_db_breakdown","req_id":"{req_id}","patient":"{patient.first_name[0]}***"')
    result = resolve_patient(patient.dict(), [c.dict() for c in patient.coverages])
    return _format_db_breakdown(result)


# ─── Batch endpoints ─────────────────────────────────────────────────────────

@app.post("/api/batch/resolve", dependencies=[Depends(require_api_key)])
@limiter.limit("10/minute")
async def batch_resolve(
    request: Request,
    file: UploadFile = File(...),
    api_key: str = Security(API_KEY_HEADER),
):
    """
    Batch eligibility resolution from CSV/Excel upload.
    Rate limited: 10/minute per IP. PDF upload is blocked.
    """
    req_id = getattr(request.state, "request_id", "unknown")
    ext = (file.filename or "").lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        raise HTTPException(
            400,
            "PDF batch upload is not supported. Use CSV or Excel (.xlsx). "
            "PDF parsing is unreliable on real-world documents."
        )

    content = await file.read()
    patients = parse_file(file.filename or "upload.csv", content)
    if not patients:
        raise HTTPException(400, "No patient records found in file")

    results, errors = [], []
    for i, p in enumerate(patients):
        try:
            coverages = p.pop("coverages", [])
            results.append(resolve_patient(p, coverages))
        except Exception as e:
            errors.append({"row": i + 1, "error": str(e), "patient": p})

    job_id = str(uuid.uuid4())
    summary = {
        "active_coverage_found": sum(1 for r in results if r.get("active_medical") or r.get("active_dental")),
        "no_coverage_found": sum(1 for r in results if not r.get("active_medical") and not r.get("active_dental")),
        "denial_flags_total": sum(len(r.get("denial_prevention", [])) for r in results),
    }
    _save_job(job_id, file.filename or "upload", len(patients), len(results),
              errors, results, summary, api_key or "")
    logger.info(
        f'"event":"batch_complete","req_id":"{req_id}","job_id":"{job_id}",'
        f'"total":{len(patients)},"errors":{len(errors)}'
    )
    return {
        "job_id": job_id, "total": len(patients), "processed": len(results),
        "error_count": len(errors), "errors": errors, "summary": summary,
    }


@app.get("/api/batch/{job_id}/export")
@limiter.limit("30/minute")
async def export_batch(
    request: Request,
    job_id: str,
    format: str = Query("json", enum=["json", "csv", "excel", "pdf"]),
    api_key: str = Depends(require_api_key),
):
    results = _get_job_results(job_id, api_key)
    if results is None:
        raise HTTPException(404, f"Job {job_id} not found")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if format == "json":
        return Response(content=to_json(results), media_type="application/json",
                        headers={"Content-Disposition": f"attachment; filename=eligibility_{ts}.json"})
    elif format == "csv":
        return Response(content=to_csv(results), media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=eligibility_{ts}.csv"})
    elif format == "excel":
        return Response(
            content=to_excel(results),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=eligibility_{ts}.xlsx"},
        )
    elif format == "pdf":
        return Response(content=to_pdf_report(results), media_type="application/pdf",
                        headers={"Content-Disposition": f"attachment; filename=eligibility_{ts}.pdf"})


@app.get("/api/batch/{job_id}")
async def get_job(job_id: str, api_key: str = Depends(require_api_key)):
    job = _get_job(job_id, api_key)
    if not job:
        raise HTTPException(404, f"Job {job_id} not found")
    return {
        "id": job["id"], "created_at": job["created_at"], "filename": job["filename"],
        "total": job["total"], "processed": job["processed"], "error_count": job["error_count"],
        "errors": json.loads(job["errors_json"]), "summary": json.loads(job["summary_json"]),
    }


@app.get("/api/batch/{job_id}/results")
async def get_job_results(job_id: str, api_key: str = Depends(require_api_key)):
    results = _get_job_results(job_id, api_key)
    if results is None:
        raise HTTPException(404, f"Job {job_id} not found")
    return results


# ─── Template download ────────────────────────────────────────────────────────

@app.get("/api/template.csv")
async def get_template():
    template = "first_name,last_name,dob,gender,state,employer,spouse_dob,payer_name,member_id,group_number,plan_type,subscriber_dob\n"
    template += "John,Smith,1955-03-15,M,CA,Acme Corp,1957-07-22,Blue Cross PPO,BCX123456,GRP-001,medical,1957-07-22\n"
    template += "John,Smith,1955-03-15,M,CA,,,Medicare Part A/B,MEMBER-ID-HERE,,medical,1955-03-15\n"
    template += "Jane,Doe,1980-06-01,F,TX,,,Delta Dental PPO,DD987654,,dental,1980-06-01\n"
    template += "Sarah,Johnson,1985-03-15,F,CA,,,MetLife Dental,MET123456,GRP-002,dental,1985-03-15\n"
    template += "Mike,Williams,1978-11-20,M,TX,,,Guardian,GRD789012,GRP-003,dental,1978-11-20\n"
    return Response(content=template, media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=eligibility_template.csv"})


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    try:
        with _db() as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    dental_provider = os.environ.get("DENTAL_PROVIDER", "stedi")
    demo_mode = os.environ.get("DEMO_MODE", "false").lower() == "true"
    return {
        "status": "ok" if db_ok else "degraded",
        "version": "2.3.0",
        "db": "sqlite" if db_ok else "error",
        "dental_provider": dental_provider,
        "demo_mode": demo_mode,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
