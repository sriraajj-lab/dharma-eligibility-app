"""
Insurance Eligibility & COB API — FastAPI backend  v2.2.0

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
from typing import Optional, List
from datetime import datetime
from contextlib import contextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request, Security, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
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
app = FastAPI(title="Insurance Eligibility & COB API", version="2.2.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ─── SECURITY: CORS — explicit allowlist only ─────────────────────────────────
# Never use allow_origins=["*"] — any website could call this API and exfiltrate PHI.
# Set ELIGIBILITY_ALLOWED_ORIGINS env var (comma-separated) to override defaults.

_DEFAULT_ORIGINS = [
    "https://denialsdoctor.com",
    "https://app.denialsdoctor.com",
    "https://eligibility.denialsdoctor.com",
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
# Set ELIGIBILITY_API_KEY env var. Clients must send: X-API-Key: <key>
# Separate ELIGIBILITY_DD_API_KEY for DD internal service-to-service calls.
# IMPORTANT: uses secrets.compare_digest() to prevent timing attacks.

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
    # Constant-time comparison — prevents timing attacks on a healthcare API
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


# ─── SQLite job store (survives container restarts) ───────────────────────────
# Replaces the in-memory JOBS dict that was wiped on every restart.
# api_key_hash column enables per-job ownership checks for multi-tenant use.
# Upgrade to Redis for multi-instance deployments.

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
        # Multi-tenant isolation: verify key hash matches
        if row["api_key_hash"] and not secrets.compare_digest(
            row["api_key_hash"], _key_hash(api_key)
        ):
            return None  # Treat as not found — don't leak existence
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
    return Response(content=template, media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=eligibility_template.csv"})


# ─── Root — serve demo HTML page ─────────────────────────────────────────────

@app.get("/")
async def root():
    here = os.path.dirname(__file__)
    path = os.path.join(here, "index.html")
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Dharma Eligibility API</h1><p>See <a href='/docs'>/docs</a> for API docs.</p>")


# ─── Health check (no auth — used by load balancer / Caddy HEALTHCHECK) ───────

@app.get("/health")
async def health():
    try:
        with _db() as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "version": "2.2.0", "db": "sqlite" if db_ok else "error"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
