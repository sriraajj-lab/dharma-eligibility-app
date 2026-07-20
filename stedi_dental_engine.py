"""
stedi_dental_engine.py — Stedi Dental Eligibility (270/271) Integration
Dharma Eligibility Tool v2.3

Stedi is a self-serve clearinghouse that supports 200+ dental payers via
the X12 270/271 standard. This engine adds dental-specific handling:
  - Service Type Code 35 (Dental Care) in the encounter object
  - Full parsing of dental benefit categories from the 271 response
  - Frequency limits, waiting periods, coverage percentages
  - Missing tooth clause, replacement rules, ortho, implants

Setup (self-serve, free to start):
  1. Sign up at https://www.stedi.com/app/signup
  2. Go to Settings → API Keys → Create API Key
  3. Set environment variables:
       STEDI_API_KEY=your_api_key
       PROVIDER_NPI=your_npi
       PROVIDER_ORG=Your Practice Name
       DENTAL_PROVIDER=stedi   (already the default)
       DEMO_MODE=false

Stedi docs: https://www.stedi.com/docs/healthcare/eligibility
Payer list:  https://www.stedi.com/app/network
"""

import os
import logging
import requests

logger = logging.getLogger(__name__)

STEDI_ELIGIBILITY_URL = "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3"

# ── Service Type Codes for dental benefit categories ──────────────────────────
# These are the X12 STC codes used in 271 responses for dental
DENTAL_STC_MAP = {
    "35":  "dental",           # Dental Care (general)
    "23":  "diagnostic",       # Diagnostic Dental
    "24":  "endodontics",      # Endodontics
    "25":  "restorative",      # Restorative
    "26":  "periodontics",     # Periodontics
    "27":  "crowns",           # Crowns
    "28":  "oral_surgery",     # Oral Surgery
    "29":  "orthodontics",     # Orthodontics
    "F3":  "dental_accident",  # Dental Accident
    "AJ":  "preventive",       # Preventive Dental
    "48":  "hospital",         # Hospital - Inpatient
    "UC":  "urgent_care",      # Urgent Care
}

# ── Benefit code meanings (X12 EB01) ─────────────────────────────────────────
BENEFIT_CODE_MAP = {
    "1":  "active_coverage",
    "2":  "active_full_risk",
    "3":  "active_service_capitation",
    "4":  "active_service_fee",
    "5":  "active_supplemental",
    "6":  "inactive",
    "7":  "inactive_pending",
    "8":  "inactive_terminated",
    "A":  "coinsurance",
    "B":  "copayment",
    "C":  "deductible",
    "CB": "coverage_basis",
    "D":  "benefit_description",
    "E":  "exclusions",
    "F":  "limitations",
    "G":  "out_of_pocket",
    "H":  "out_of_pocket_met",
    "I":  "non_covered",
    "J":  "cost_containment",
    "K":  "reserve",
    "L":  "primary_care_provider",
    "M":  "contact_following_surgery",
    "MC": "maximum_coverage",
    "N":  "services_restricted",
    "O":  "not_deemed_medical_necessary",
    "P":  "benefit_disclaimer",
    "Q":  "second_surgical_opinion",
    "R":  "other_or_additional_payor",
    "S":  "prior_year_history",
    "T":  "card_reported_lost",
    "U":  "contact",
    "V":  "cannot_process",
    "W":  "other_source_of_data",
    "X":  "health_care_facility",
    "Y":  "spend_down",
}

# ── Time period qualifier meanings ────────────────────────────────────────────
TIME_PERIOD_MAP = {
    "21": "calendar_year",
    "22": "service_year",
    "23": "plan_year",
    "24": "year_to_date",
    "25": "contract",
    "26": "episode",
    "27": "visit",
    "28": "outlier",
    "29": "remaining",
    "30": "exceeded",
    "31": "not_exceeded",
    "32": "lifetime",
    "33": "lifetime_remaining",
    "34": "month",
    "35": "week",
    "36": "day",
    "6":  "hour",
    "7":  "day",
    "LS": "life_of_service",
    "MN": "months",
    "WK": "weeks",
    "YR": "years",
}


def check_dental_eligibility_stedi(patient: dict) -> dict:
    """
    Call Stedi Eligibility API with dental Service Type Code 35.
    Returns a normalized dental benefits dict covering all DB Breakdown fields.

    patient dict keys used:
      first_name, last_name, dob, member_id, payer_name, payer_id,
      group_number, subscriber_dob, subscriber_name
    """
    stedi_api_key = os.environ.get("STEDI_API_KEY", "")
    provider_npi  = os.environ.get("PROVIDER_NPI", "")

    if not stedi_api_key:
        raise ValueError("STEDI_API_KEY environment variable is not set. Sign up free at stedi.com")
    if not provider_npi:
        raise ValueError("PROVIDER_NPI environment variable is not set.")

    logger.info("check_dental_eligibility_stedi payer=%s", patient.get("payer_name", ""))

    # Resolve payer ID
    from eligibility_engine import _lookup_payer_id
    payer_name = patient.get("payer_name", "")
    payer_id   = patient.get("payer_id") or _lookup_payer_id(payer_name)

    # Build 270 payload with dental STC 35
    payload = {
        "controlNumber": "000000001",
        "tradingPartnerServiceId": payer_id,
        "provider": {
            "organizationName": os.environ.get("PROVIDER_ORG", "Dental Practice"),
            "npi": provider_npi,
        },
        "subscriber": {
            "memberId":    patient.get("member_id", ""),
            "firstName":   patient.get("first_name", ""),
            "lastName":    patient.get("last_name", ""),
            "dateOfBirth": patient.get("dob", "").replace("-", ""),  # YYYYMMDD
        },
        # ── KEY: Request dental benefits specifically ──
        "encounter": {
            "serviceTypeCodes": ["35"],  # 35 = Dental Care
            "dateOfService": "",         # Leave blank for current date
        },
    }

    # Add dependent info if subscriber is different from patient
    subscriber_dob = patient.get("subscriber_dob", "")
    subscriber_name = patient.get("subscriber_name", "")
    if subscriber_dob and subscriber_dob != patient.get("dob", ""):
        payload["dependent"] = {
            "firstName":   patient.get("first_name", ""),
            "lastName":    patient.get("last_name", ""),
            "dateOfBirth": patient.get("dob", "").replace("-", ""),
        }
        payload["subscriber"]["dateOfBirth"] = subscriber_dob.replace("-", "")
        if subscriber_name:
            parts = subscriber_name.strip().split(" ", 1)
            payload["subscriber"]["firstName"] = parts[0]
            payload["subscriber"]["lastName"]  = parts[1] if len(parts) > 1 else ""

    headers = {
        "Authorization": f"Key {stedi_api_key}",
        "Content-Type":  "application/json",
    }

    # Add test header for sandbox testing
    if os.environ.get("STEDI_SANDBOX", "false").lower() == "true":
        headers["stedi-test"] = "true"

    resp = requests.post(
        STEDI_ELIGIBILITY_URL,
        headers=headers,
        json=payload,
        timeout=20,
    )
    resp.raise_for_status()
    raw = resp.json()

    logger.info("Stedi dental response received for payer=%s", payer_name)
    return normalize_stedi_dental_response(raw, patient)


def normalize_stedi_dental_response(raw: dict, patient: dict) -> dict:
    """
    Parse a Stedi 271 response and map it to the full DB Breakdown schema.

    The 271 response structure:
    {
      "benefitsInformation": [
        {
          "code": "1",           // EB01 — benefit code
          "name": "Active Coverage",
          "serviceTypeCodes": ["35"],
          "serviceTypes": ["Dental Care"],
          "insuranceTypeCode": "...",
          "planCoverage": "...",
          "timePeriodQualifierCode": "21",
          "benefitAmount": "2000",
          "benefitPercent": "0.8",
          "authOrCertIndicator": "N",
          "inPlanNetworkIndicatorCode": "Y",
          "additionalInformation": [{"description": "..."}],
          "eligibilityAdditionalInformation": {...}
        },
        ...
      ],
      "planInformation": {
        "planDescription": "Delta Dental PPO",
        "groupNumber": "GRP-001",
        "groupDescription": "...",
        "planNumber": "...",
        "planBeginDate": "20260101",
        "planEndDate": "20261231"
      },
      "subscriberInformation": {
        "memberId": "DD-987654",
        "firstName": "Jane",
        "lastName": "Doe",
        "dateOfBirth": "19850615",
        "address": {...}
      },
      "payerInformation": {
        "name": "Delta Dental",
        "payerId": "DLTDL"
      }
    }
    """
    benefits     = raw.get("benefitsInformation") or []
    plan_info    = raw.get("planInformation") or {}
    payer_info   = raw.get("payerInformation") or {}
    subscriber   = raw.get("subscriberInformation") or {}

    # ── Helper: parse date YYYYMMDD → YYYY-MM-DD ─────────────────────────────
    def parse_date(d):
        if not d:
            return None
        d = str(d).replace("-", "").replace("/", "")
        if len(d) == 8:
            return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        return d

    # ── Helper: get float from benefit ───────────────────────────────────────
    def get_amount(b):
        v = b.get("benefitAmount")
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def get_percent(b):
        v = b.get("benefitPercent")
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    # ── Helper: check if benefit is dental (STC 35 or dental keywords) ───────
    def is_dental(b):
        stcs = b.get("serviceTypeCodes") or []
        types = [t.lower() for t in (b.get("serviceTypes") or [])]
        return "35" in stcs or any("dental" in t for t in types)

    # ── Helper: check if in-network ──────────────────────────────────────────
    def is_in_network(b):
        code = (b.get("inPlanNetworkIndicatorCode") or "").upper()
        return code in ("Y", "W", "")  # Y=yes, W=not applicable, blank=unspecified

    # ── Active coverage ───────────────────────────────────────────────────────
    active = False
    for b in benefits:
        code = (b.get("code") or "").upper()
        if code in ("1", "30", "W") and is_dental(b):
            active = True
            break
    # Fallback: any active code
    if not active:
        for b in benefits:
            code = (b.get("code") or "").upper()
            if code == "1":
                active = True
                break

    # ── Plan basics ───────────────────────────────────────────────────────────
    plan_name   = plan_info.get("planDescription") or plan_info.get("planName") or payer_info.get("name")
    plan_begin  = parse_date(plan_info.get("planBeginDate"))
    group_num   = plan_info.get("groupNumber") or patient.get("group_number")
    member_id   = subscriber.get("memberId") or patient.get("member_id")
    payer_id    = payer_info.get("payerId") or patient.get("payer_id")

    # ── Initialize result ─────────────────────────────────────────────────────
    result = {
        "active":                       active,
        "plan_name":                    plan_name,
        "plan_begin_date":              plan_begin,
        "plan_type":                    "dental",
        "network":                      None,
        "benefit_period":               "calendar",
        "payer_id":                     payer_id,
        "payer_phone":                  None,
        "claim_address":                None,
        "group_number":                 group_num,
        "member_id":                    member_id,
        # Maximums
        "annual_maximum":               None,
        "annual_maximum_used":          None,
        "annual_maximum_remaining":     None,
        "deductible":                   None,
        "deductible_met":               None,
        "deductible_family":            None,
        "deductible_applies_preventive": None,
        "preventive_in_max":            None,
        "cob_type":                     "standard",
        # Coverage percentages
        "preventive_coverage":          None,
        "basic_coverage":               None,
        "major_coverage":               None,
        "perio_coverage":               None,
        "endo_coverage":                None,
        "oral_surgery_coverage":        None,
        "fillings_coverage":            None,
        "crowns_coverage":              None,
        "dentures_coverage":            None,
        "ortho_coverage":               None,
        # Waiting periods
        "waiting_period_basic":         None,
        "waiting_period_major":         None,
        # Frequency limits
        "prophy_frequency":             None,
        "periodic_exam_frequency":      None,
        "comp_exam_frequency":          None,
        "fmx_frequency":                None,
        "bitewing_frequency":           None,
        "pa_frequency":                 None,
        "srp_frequency":                None,
        "perio_maintenance_frequency":  None,
        "fmd_frequency":                None,
        # Clauses
        "missing_tooth_clause":         None,
        "fillings_downgrade":           None,
        "crowns_paid_on":               None,
        "same_day_treatment":           None,
        "fluoride_covered":             None,
        "fluoride_age_limit":           None,
        "sealants_covered":             None,
        "sealants_age_limit":           None,
        "sdf_covered":                  None,
        "arestin_covered":              None,
        "perio_same_day_exam":          None,
        "perio_shares_prophy_frequency": None,
        "srp_quads_per_visit":          None,
        # Replacement
        "replacement_crowns":           None,
        "replacement_bridges":          None,
        "replacement_dentures":         None,
        "replacement_partials":         None,
        "claims_filing_deadline":       None,
        # Implants
        "implants_covered":             None,
        "implants_coverage":            None,
        "implants_separate_max":        None,
        "abutment_coverage":            None,
        "implant_crown_coverage":       None,
        # Ortho
        "ortho_lifetime_max":           None,
        "ortho_lifetime_used":          None,
        "ortho_deductible":             None,
        "ortho_age_limit":              None,
        "ortho_payment_method":         None,
        # Specific codes
        "specific_codes":               {},
        # Meta
        "active_medical":               False,
        "active_dental":                active,
        "data_source":                  "stedi",
        "_raw_stedi":                   raw,
    }

    # ── Parse benefits array ──────────────────────────────────────────────────
    for b in benefits:
        code    = (b.get("code") or "").upper()
        name    = (b.get("name") or b.get("benefitDescription") or "").lower()
        stcs    = b.get("serviceTypeCodes") or []
        types   = [t.lower() for t in (b.get("serviceTypes") or [])]
        amount  = get_amount(b)
        pct     = get_percent(b)
        period  = b.get("timePeriodQualifierCode", "")
        in_net  = is_in_network(b)
        add_info = [x.get("description", "").lower() for x in (b.get("additionalInformation") or [])]

        # ── Annual maximum ────────────────────────────────────────────────────
        if code == "MC" and amount is not None and in_net:
            if "35" in stcs or any("dental" in t for t in types):
                if result["annual_maximum"] is None:
                    result["annual_maximum"] = amount

        # ── Deductible ────────────────────────────────────────────────────────
        if code == "C" and amount is not None:
            if "35" in stcs or any("dental" in t for t in types) or not stcs:
                if "family" in name or "family" in " ".join(add_info):
                    if result["deductible_family"] is None:
                        result["deductible_family"] = amount
                elif result["deductible"] is None and in_net:
                    result["deductible"] = amount

        # ── Deductible met (remaining) ────────────────────────────────────────
        if code in ("CB", "29") and amount is not None:
            if "deductible" in name:
                if result["deductible_met"] is None:
                    ded = result["deductible"]
                    if ded is not None:
                        result["deductible_met"] = max(0, ded - amount)

        # ── Coverage percentages by STC ───────────────────────────────────────
        if code == "A" and pct is not None and in_net:
            # Preventive (STC AJ or 35 with preventive keyword)
            if "AJ" in stcs or any("preventive" in t for t in types):
                if result["preventive_coverage"] is None:
                    result["preventive_coverage"] = pct
            # Endodontics (STC 24)
            elif "24" in stcs or any("endo" in t for t in types):
                if result["endo_coverage"] is None:
                    result["endo_coverage"] = pct
            # Periodontics (STC 26)
            elif "26" in stcs or any("perio" in t for t in types):
                if result["perio_coverage"] is None:
                    result["perio_coverage"] = pct
            # Crowns (STC 27)
            elif "27" in stcs or any("crown" in t for t in types):
                if result["crowns_coverage"] is None:
                    result["crowns_coverage"] = pct
            # Oral Surgery (STC 28)
            elif "28" in stcs or any("oral surgery" in t for t in types):
                if result["oral_surgery_coverage"] is None:
                    result["oral_surgery_coverage"] = pct
            # Orthodontics (STC 29)
            elif "29" in stcs or any("ortho" in t for t in types):
                if result["ortho_coverage"] is None:
                    result["ortho_coverage"] = pct
            # Restorative / Basic (STC 25)
            elif "25" in stcs or any("restorative" in t or "basic" in t for t in types):
                if result["basic_coverage"] is None:
                    result["basic_coverage"] = pct
            # General dental (STC 35) — map to basic/major based on name
            elif "35" in stcs:
                if any(kw in name for kw in ("basic", "restorative", "filling")):
                    if result["basic_coverage"] is None:
                        result["basic_coverage"] = pct
                elif any(kw in name for kw in ("major", "crown", "bridge", "denture")):
                    if result["major_coverage"] is None:
                        result["major_coverage"] = pct
                elif any(kw in name for kw in ("preventive", "prophy", "cleaning")):
                    if result["preventive_coverage"] is None:
                        result["preventive_coverage"] = pct

        # ── Ortho lifetime max ────────────────────────────────────────────────
        if "29" in stcs and code == "MC" and amount is not None:
            if result["ortho_lifetime_max"] is None:
                result["ortho_lifetime_max"] = amount

        # ── Limitations / exclusions text ─────────────────────────────────────
        if code in ("F", "E"):
            desc_text = " ".join(add_info) + " " + name
            if "missing tooth" in desc_text:
                result["missing_tooth_clause"] = True
            if "downgrade" in desc_text or "alternate benefit" in desc_text:
                result["fillings_downgrade"] = True
            if "waiting period" in desc_text:
                for info in add_info:
                    if "basic" in info and result["waiting_period_basic"] is None:
                        result["waiting_period_basic"] = info
                    if "major" in info and result["waiting_period_major"] is None:
                        result["waiting_period_major"] = info

        # ── Frequency limits (from additionalInformation descriptions) ────────
        if code in ("F", "1", "D"):
            for info in add_info:
                if "prophy" in info or "d1110" in info or "cleaning" in info:
                    if result["prophy_frequency"] is None:
                        result["prophy_frequency"] = info
                elif "periodic exam" in info or "d0120" in info:
                    if result["periodic_exam_frequency"] is None:
                        result["periodic_exam_frequency"] = info
                elif "bitewing" in info or "d0274" in info or "d0272" in info:
                    if result["bitewing_frequency"] is None:
                        result["bitewing_frequency"] = info
                elif "fmx" in info or "d0210" in info or "full mouth" in info:
                    if result["fmx_frequency"] is None:
                        result["fmx_frequency"] = info
                elif "srp" in info or "d4341" in info or "scaling" in info:
                    if result["srp_frequency"] is None:
                        result["srp_frequency"] = info
                elif "perio maintenance" in info or "d4910" in info:
                    if result["perio_maintenance_frequency"] is None:
                        result["perio_maintenance_frequency"] = info

    # ── Derive remaining maximum ──────────────────────────────────────────────
    if result["annual_maximum"] is not None and result["annual_maximum_used"] is not None:
        result["annual_maximum_remaining"] = max(
            0, result["annual_maximum"] - result["annual_maximum_used"]
        )

    # ── Derive major coverage from basic if not set ───────────────────────────
    if result["major_coverage"] is None and result["basic_coverage"] is not None:
        # Common pattern: major is 50% when basic is 80%
        pass  # Leave as None — don't guess

    # ── Network status ────────────────────────────────────────────────────────
    for b in benefits:
        code = (b.get("code") or "").upper()
        if code == "1":
            net_code = (b.get("inPlanNetworkIndicatorCode") or "").upper()
            if net_code == "Y":
                result["network"] = "In-Network"
            elif net_code == "N":
                result["network"] = "Out-of-Network"
            break

    # ── Benefit period ────────────────────────────────────────────────────────
    for b in benefits:
        period = b.get("timePeriodQualifierCode", "")
        if period == "21":
            result["benefit_period"] = "calendar"
            break
        elif period in ("22", "23"):
            result["benefit_period"] = "plan_year"
            break

    logger.info(
        "normalize_stedi_dental_response: active=%s plan=%s max=%s deductible=%s",
        result["active"], result["plan_name"],
        result["annual_maximum"], result["deductible"]
    )
    return result
