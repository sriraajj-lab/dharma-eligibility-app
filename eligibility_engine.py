"""
eligibility_engine.py — v2.2
Stedi 270/271 eligibility + pVerify coverage discovery + dental stub.
Security hardened: API keys read fresh per call, PROVIDER_NPI validated,
unknown payer IDs raise ValueError, dental stub returns no dollar amounts.
DEMO_MODE=true returns realistic sandbox data without live API keys.
"""

import os
import json
import time
import logging
import hashlib
import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PHI masking helpers
# ---------------------------------------------------------------------------

def _mask_logs() -> bool:
    return os.environ.get("MASK_PHI_LOGS", "true").lower() != "false"


def mask_phi(patient: dict) -> dict:
    if not _mask_logs():
        return patient
    masked = dict(patient)
    if "first_name" in masked:
        masked["first_name"] = masked["first_name"][:1] + "***"
    if "last_name" in masked:
        masked["last_name"] = masked["last_name"][:1] + "***"
    if "dob" in masked:
        masked["dob"] = "****-**-**"
    if "member_id" in masked:
        mid = str(masked["member_id"])
        masked["member_id"] = mid[:3] + "***" + mid[-2:] if len(mid) > 5 else "***"
    return masked


def mask_coverage(cov: dict) -> dict:
    if not _mask_logs():
        return cov
    masked = dict(cov)
    for key in ("deductible", "deductible_met", "oop_max", "oop_met",
                "copay", "coinsurance", "plan_begin_date"):
        if key in masked:
            masked[key] = "***"
    return masked


# ---------------------------------------------------------------------------
# Demo mode helper
# ---------------------------------------------------------------------------

def _demo_mode() -> bool:
    return os.environ.get("DEMO_MODE", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Payer ID map (33 payers)
# ---------------------------------------------------------------------------

PAYER_ID_MAP: dict[str, str] = {
    # Commercial
    "aetna":                    "60054",
    "anthem":                   "00510",
    "bcbs_al":                  "00100",
    "bcbs_az":                  "86047",
    "bcbs_fl":                  "00590",
    "bcbs_il":                  "00620",
    "bcbs_ma":                  "00650",
    "bcbs_mi":                  "00710",
    "bcbs_nc":                  "00752",
    "bcbs_tx":                  "84980",
    "cigna":                    "62308",
    "humana":                   "61101",
    "united_healthcare":        "87726",
    "molina":                   "MOLIN",
    "oscar":                    "OSCAR",
    "centene":                  "68069",
    "wellcare":                 "WELCR",
    "kaiser":                   "94135",
    "highmark":                 "00115",
    "carefirst":                "00580",
    "independence_bcbs":        "23284",
    "premera":                  "PREME",
    "regence":                  "REGBS",
    "tufts":                    "04271",
    "harvard_pilgrim":          "04272",
    # Government
    "medicare":                 "00120",
    "medicaid":                 "00120",
    "tricare":                  "TRICR",
    "champva":                  "CHMPV",
    "va":                       "VAHCS",
    # Dental / Vision
    "delta_dental":             "DLTDL",
    "metlife_dental":           "METLF",
    "vsp":                      "VSPVS",
}

DENTAL_PAYERS = {"delta_dental", "metlife_dental", "vsp", "delta dental", "metlife dental"}


def _lookup_payer_id(payer_name: str) -> str:
    """Return Stedi payer ID for *payer_name* or raise ValueError."""
    key = payer_name.strip().lower().replace(" ", "_").replace("-", "_")
    payer_id = PAYER_ID_MAP.get(key)
    if payer_id is None:
        raise ValueError(
            "Unknown payer '%s'. Add it to PAYER_ID_MAP or pass a raw payer_id." % payer_name
        )
    return payer_id


def _is_dental_payer(payer_name: str) -> bool:
    """Return True if payer_name looks like a dental plan."""
    name = payer_name.strip().lower()
    key = name.replace(" ", "_").replace("-", "_")
    if key in DENTAL_PAYERS or name in DENTAL_PAYERS:
        return True
    dental_keywords = ("dental", "ortho", "dds", "vsp", "vision")
    return any(kw in name for kw in dental_keywords)


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------

def _demo_medical(patient: dict) -> dict:
    """Return realistic demo medical eligibility data."""
    payer = patient.get("payer_name", "Blue Cross Blue Shield PPO")
    return {
        "active":           True,
        "plan_name":        payer if payer else "Blue Cross Blue Shield PPO",
        "plan_begin_date":  "2026-01-01",
        "deductible":       1500.00,
        "deductible_met":   425.00,
        "oop_max":          5000.00,
        "oop_met":          850.00,
        "copay":            30.00,
        "coinsurance":      0.20,
        "active_medical":   True,
        "active_dental":    False,
        "_demo":            True,
        "_note":            "Demo mode — not real eligibility data.",
    }


def _demo_dental(patient: dict) -> dict:
    """Return realistic payer-specific demo dental eligibility data."""
    payer_raw = patient.get("payer_name", "Delta Dental PPO")
    payer_key = payer_raw.strip().lower()

    # Payer-specific demo profiles
    if "metlife" in payer_key:
        profile = {
            "plan_name":                "MetLife Dental PDP Plus",
            "annual_maximum":           1500.00,
            "annual_maximum_used":      200.00,
            "annual_maximum_remaining": 1300.00,
            "deductible":               75.00,
            "deductible_met":           0.00,
            "preventive_coverage":      1.00,
            "basic_coverage":           0.80,
            "major_coverage":           0.50,
            "ortho_coverage":           0.50,
            "ortho_lifetime_max":       1000.00,
            "waiting_period_basic":     "None",
            "waiting_period_major":     "12 months",
            "network":                  "PDP Plus In-Network",
        }
    elif "vsp" in payer_key or "vision" in payer_key:
        profile = {
            "plan_name":                "VSP Choice Plan",
            "annual_maximum":           None,
            "annual_maximum_used":      None,
            "annual_maximum_remaining": None,
            "deductible":               0.00,
            "deductible_met":           0.00,
            "preventive_coverage":      1.00,
            "basic_coverage":           None,
            "major_coverage":           None,
            "ortho_coverage":           None,
            "ortho_lifetime_max":       None,
            "waiting_period_basic":     "N/A",
            "waiting_period_major":     "N/A",
            "network":                  "VSP Choice Network",
            "_note_vision":             "VSP is a vision plan. Dental benefits not applicable.",
        }
    elif "cigna" in payer_key and "dental" in payer_key:
        profile = {
            "plan_name":                "Cigna Dental 1000",
            "annual_maximum":           1000.00,
            "annual_maximum_used":      450.00,
            "annual_maximum_remaining": 550.00,
            "deductible":               50.00,
            "deductible_met":           50.00,
            "preventive_coverage":      1.00,
            "basic_coverage":           0.80,
            "major_coverage":           0.50,
            "ortho_coverage":           0.00,
            "ortho_lifetime_max":       0.00,
            "waiting_period_basic":     "6 months",
            "waiting_period_major":     "12 months",
            "network":                  "DPPO In-Network",
        }
    elif "guardian" in payer_key:
        profile = {
            "plan_name":                "Guardian DentalGuard Preferred",
            "annual_maximum":           2500.00,
            "annual_maximum_used":      0.00,
            "annual_maximum_remaining": 2500.00,
            "deductible":               50.00,
            "deductible_met":           0.00,
            "preventive_coverage":      1.00,
            "basic_coverage":           0.80,
            "major_coverage":           0.60,
            "ortho_coverage":           0.50,
            "ortho_lifetime_max":       2000.00,
            "waiting_period_basic":     "None",
            "waiting_period_major":     "6 months",
            "network":                  "DentalGuard Preferred",
        }
    elif "aetna" in payer_key and "dental" in payer_key:
        profile = {
            "plan_name":                "Aetna Dental PPO",
            "annual_maximum":           1500.00,
            "annual_maximum_used":      125.00,
            "annual_maximum_remaining": 1375.00,
            "deductible":               50.00,
            "deductible_met":           25.00,
            "preventive_coverage":      1.00,
            "basic_coverage":           0.80,
            "major_coverage":           0.50,
            "ortho_coverage":           0.50,
            "ortho_lifetime_max":       1500.00,
            "waiting_period_basic":     "None",
            "waiting_period_major":     "12 months",
            "network":                  "Aetna Dental PPO",
        }
    else:
        # Default: Delta Dental PPO
        profile = {
            "plan_name":                payer_raw if payer_raw else "Delta Dental PPO",
            "annual_maximum":           2000.00,
            "annual_maximum_used":      350.00,
            "annual_maximum_remaining": 1650.00,
            "deductible":               50.00,
            "deductible_met":           50.00,
            "preventive_coverage":      1.00,
            "basic_coverage":           0.80,
            "major_coverage":           0.50,
            "ortho_coverage":           0.50,
            "ortho_lifetime_max":       1500.00,
            "waiting_period_basic":     "None",
            "waiting_period_major":     "12 months",
            "network":                  "PPO In-Network",
        }

    return {
        "active":       True,
        "plan_begin_date": "2026-01-01",
        "plan_type":    "dental",
        **profile,
        "group_number": patient.get("group_number", "GRP-00123"),
        "member_id":    patient.get("member_id", "DD-987654"),
        "active_medical": False,
        "active_dental":  True,
        "_demo":        True,
        "_note":        "Demo mode — not real eligibility data.",
    }


# ---------------------------------------------------------------------------
# Stedi 270/271 — real-time eligibility
# ---------------------------------------------------------------------------

def callEligibility(patient: dict) -> dict:
    """
    Call Stedi Eligibility API (270/271).
    Reads STEDI_API_KEY and PROVIDER_NPI fresh on every invocation.
    """
    stedi_api_key = os.environ.get("STEDI_API_KEY", "")
    provider_npi  = os.environ.get("PROVIDER_NPI", "")

    if not stedi_api_key:
        raise ValueError("STEDI_API_KEY environment variable is not set.")
    if not provider_npi:
        raise ValueError("PROVIDER_NPI environment variable is not set.")

    logger.info("callEligibility patient=%s", mask_phi(patient))

    payer_name = patient.get("payer_name", "")
    payer_id   = patient.get("payer_id") or _lookup_payer_id(payer_name)

    payload = {
        "controlNumber": "000000001",
        "tradingPartnerServiceId": payer_id,
        "provider": {
            "organizationName": os.environ.get("PROVIDER_ORG", "Aria Agency"),
            "npi": provider_npi,
        },
        "subscriber": {
            "memberId":    patient.get("member_id", ""),
            "firstName":   patient.get("first_name", ""),
            "lastName":    patient.get("last_name", ""),
            "dateOfBirth": patient.get("dob", ""),
        },
    }

    resp = requests.post(
        "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3",
        headers={
            "Authorization": "Key %s" % stedi_api_key,
            "Content-Type":  "application/json",
        },
        json=payload,
        timeout=15,
    )
    resp.raise_for_status()
    raw = resp.json()
    logger.debug("Stedi raw response keys=%s", list(raw.keys()))
    result = _parse_stedi_response(raw, patient)
    result["active_medical"] = result.get("active", False)
    result["active_dental"]  = False
    return result


# ---------------------------------------------------------------------------
# Parse Stedi 271 response
# ---------------------------------------------------------------------------

def _parse_stedi_response(raw: dict, patient: dict) -> dict:
    """Extract structured coverage data from a Stedi 271 response."""
    result: dict = {
        "active":           False,
        "plan_name":        None,
        "plan_begin_date":  None,
        "deductible":       None,
        "deductible_met":   None,
        "oop_max":          None,
        "oop_met":          None,
        "copay":            None,
        "coinsurance":      None,
        "raw":              raw,
    }

    try:
        benefits = (
            raw.get("benefitsInformation") or
            raw.get("benefits") or
            []
        )

        # Active coverage flag
        for b in benefits:
            code = (b.get("code") or b.get("benefitCode") or "").upper()
            if code in ("1", "30", "W"):
                result["active"] = True
                break

        # Plan name
        plan_info = raw.get("planInformation") or {}
        result["plan_name"] = plan_info.get("planDescription") or plan_info.get("planName")

        # Financial benefits
        for b in benefits:
            name  = (b.get("name") or b.get("benefitDescription") or "").lower()
            value = b.get("benefitAmount") or b.get("amount")
            if value is None:
                continue
            try:
                value = float(value)
            except (TypeError, ValueError):
                continue

            if "deductible" in name and "met" not in name and result["deductible"] is None:
                result["deductible"] = value
            elif "deductible" in name and "met" in name and result["deductible_met"] is None:
                result["deductible_met"] = value
            elif "out-of-pocket" in name and "met" not in name and result["oop_max"] is None:
                result["oop_max"] = value
            elif "out-of-pocket" in name and "met" in name and result["oop_met"] is None:
                result["oop_met"] = value
            elif "copay" in name and result["copay"] is None:
                result["copay"] = value
            elif "coinsurance" in name and result["coinsurance"] is None:
                result["coinsurance"] = value

        # Plan begin date
        plan_dates = raw.get("planDateInformation") or {}
        result["plan_begin_date"] = plan_dates.get("planBegin") or plan_dates.get("eligibilityBegin")

    except Exception as exc:
        logger.warning("_parse_stedi_response error: %s", exc)

    logger.info("parsed coverage=%s", mask_coverage(result))
    return result


# ---------------------------------------------------------------------------
# Stub eligibility (non-Stedi payers / offline mode)
# ---------------------------------------------------------------------------

def _stub_eligibility(patient: dict) -> dict:
    logger.warning("_stub_eligibility called for patient=%s", mask_phi(patient))
    return {
        "active":          True,
        "plan_name":       "Stub Plan",
        "plan_begin_date": None,
        "deductible":      None,
        "deductible_met":  None,
        "oop_max":         None,
        "oop_met":         None,
        "copay":           None,
        "coinsurance":     None,
        "active_medical":  True,
        "active_dental":   False,
        "_stub":           True,
    }


# ---------------------------------------------------------------------------
# pVerify — coverage discovery
# ---------------------------------------------------------------------------

def _get_pverify_token(client_id: str, client_secret: str) -> str:
    """Obtain a pVerify OAuth2 bearer token."""
    resp = requests.post(
        "https://api.pverify.com/Token",
        data={
            "grant_type":    "client_credentials",
            "Client_Id":     client_id,
            "Client_Secret": client_secret,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def discoverCoverage(patient: dict) -> dict:
    """
    Call pVerify to discover all active coverage for a patient.
    Reads PVERIFY_CLIENT_ID and PVERIFY_CLIENT_SECRET fresh on every call.
    """
    client_id     = os.environ.get("PVERIFY_CLIENT_ID", "")
    client_secret = os.environ.get("PVERIFY_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        logger.warning("pVerify credentials not configured — returning empty coverage list.")
        return {"coverages": [], "_stub": True}

    logger.info("discoverCoverage patient=%s", mask_phi(patient))

    token = _get_pverify_token(client_id, client_secret)

    payload = {
        "PatientInfo": {
            "FirstName":   patient.get("first_name", ""),
            "LastName":    patient.get("last_name", ""),
            "DOB":         patient.get("dob", ""),
            "MemberID":    patient.get("member_id", ""),
        },
        "ProviderInfo": {
            "NPI": os.environ.get("PROVIDER_NPI", ""),
        },
    }

    resp = requests.post(
        "https://api.pverify.com/api/CoverageDiscovery",
        headers={
            "Authorization": "Bearer %s" % token,
            "Content-Type":  "application/json",
            "Client-API-Id": client_id,
        },
        json=payload,
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()

    coverages = []
    for plan in (data.get("Plans") or []):
        coverages.append({
            "payer_name":   plan.get("PayerName"),
            "payer_id":     plan.get("PayerCode"),
            "member_id":    plan.get("MemberID"),
            "active":       plan.get("EligibilityStatus", "").lower() == "active",
            "plan_name":    plan.get("PlanName"),
            "relationship": plan.get("Relationship"),
        })

    logger.info("discoverCoverage found %d plans", len(coverages))
    return {"coverages": coverages}


# ---------------------------------------------------------------------------
# Dental eligibility
# ---------------------------------------------------------------------------

def checkDentalEligibility(patient: dict) -> dict:
    """
    Dental eligibility check.
    In DEMO_MODE returns realistic sandbox benefit data.
    In production: stub — wire a real dental clearinghouse for live data.
    """
    logger.info("checkDentalEligibility patient=%s", mask_phi(patient))

    if _demo_mode():
        return _demo_dental(patient)

    # Production stub — no fabricated dollar amounts
    return {
        "active":    True,
        "plan_name": patient.get("payer_name", "Dental Plan"),
        "plan_type": "dental",
        "active_medical": False,
        "active_dental":  True,
        "_stub":     True,
        "_note":     (
            "Dental eligibility requires a dental clearinghouse integration "
            "(e.g. Vyne Dental / Availity). Contact support to enable live dental benefits."
        ),
    }


# ---------------------------------------------------------------------------
# Main resolver
# ---------------------------------------------------------------------------

def resolve_patient(patient: dict, coverages: list = None) -> dict:
    """
    Resolve eligibility for a single patient dict.

    Routes dental payers to checkDentalEligibility().
    Routes medical payers to Stedi (callEligibility()).
    Falls back to stub on any non-ValueError exception.

    coverages: list of CoverageIn dicts (for COB ordering, passed through).
    """
    if coverages is None:
        coverages = []

    # Determine plan type from coverages list or patient dict
    plan_type = patient.get("plan_type", "")
    payer_name = patient.get("payer_name", "")

    # Check if any coverage is dental, or if the payer name is dental
    is_dental = (
        plan_type == "dental"
        or _is_dental_payer(payer_name)
        or any(c.get("plan_type") == "dental" for c in coverages)
    )

    if is_dental:
        # Inject payer_name + member_id from the first dental coverage into patient dict
        # so _demo_dental() can use them for payer-specific profiles.
        dental_coverage = next(
            (c for c in coverages if c.get("plan_type") == "dental"),
            coverages[0] if coverages else {}
        )
        patient_with_payer = dict(patient)
        if not patient_with_payer.get("payer_name") and dental_coverage.get("payer_name"):
            patient_with_payer["payer_name"] = dental_coverage["payer_name"]
        if not patient_with_payer.get("member_id") and dental_coverage.get("member_id"):
            patient_with_payer["member_id"] = dental_coverage["member_id"]
        if not patient_with_payer.get("group_number") and dental_coverage.get("group_number"):
            patient_with_payer["group_number"] = dental_coverage["group_number"]
        result = checkDentalEligibility(patient_with_payer)
        result["active_dental"]  = result.get("active", False)
        result["active_medical"] = False
        return result

    # Medical path
    if _demo_mode():
        return _demo_medical(patient)

    try:
        result = callEligibility(patient)
        result["active_medical"] = result.get("active", False)
        result["active_dental"]  = False
        return result
    except ValueError as exc:
        logger.error("resolve_patient ValueError: %s", exc)
        raise
    except Exception as exc:
        logger.warning("resolve_patient Stedi error (%s) — using stub", exc)
        return _stub_eligibility(patient)
