"""
zuub_engine.py — Zuub Dental Eligibility API integration
Dharma Eligibility Tool v2.3

Zuub is a dental-native REST API that returns the most complete dental
benefits breakdown available — including frequency limits, missing tooth
clause, perio/endo/OS %, implants, replacement clauses, and CDT code-level
coverage. This is the recommended production dental provider.

Setup:
  1. Contact Zuub at https://zuub.com/dental-insurance-eligibility-api/
     to get sandbox credentials.
  2. Set environment variables:
       ZUUB_API_KEY=your_api_key
       ZUUB_API_URL=https://api.zuub.com/v1   (or sandbox URL from Zuub)
       DENTAL_PROVIDER=zuub
       DEMO_MODE=false

Zuub API docs: https://docs.zuub.com (provided after signup)
"""

import os
import logging
import requests

logger = logging.getLogger(__name__)

ZUUB_API_URL = os.environ.get("ZUUB_API_URL", "https://api.zuub.com/v1")


def _zuub_headers() -> dict:
    """Build Zuub auth headers. Key read fresh on every call."""
    api_key = os.environ.get("ZUUB_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ZUUB_API_KEY environment variable is not set. "
            "Contact Zuub at https://zuub.com/dental-insurance-eligibility-api/ to get credentials."
        )
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }


def check_dental_eligibility_zuub(patient: dict) -> dict:
    """
    Call Zuub Eligibility API and return a normalized dental benefits dict
    that maps to all DB Breakdown form fields.

    patient dict keys used:
      first_name, last_name, dob, member_id, payer_id (or payer_name),
      group_number, subscriber_dob

    Returns a dict with all DB Breakdown fields populated where available.
    Fields not returned by Zuub for a given payer will be None.
    """
    logger.info("check_dental_eligibility_zuub payer=%s", patient.get("payer_name", ""))

    provider_npi = os.environ.get("PROVIDER_NPI", "")
    if not provider_npi:
        raise ValueError("PROVIDER_NPI environment variable is not set.")

    # Build Zuub request payload
    # NOTE: Exact field names depend on Zuub's API version.
    # Update these keys once you receive Zuub's API documentation.
    payload = {
        "subscriber": {
            "firstName":   patient.get("first_name", ""),
            "lastName":    patient.get("last_name", ""),
            "dateOfBirth": patient.get("dob", ""),
            "memberId":    patient.get("member_id", ""),
            "groupNumber": patient.get("group_number", ""),
        },
        "payer": {
            # Zuub accepts either their internal payer ID or the standard EDI payer ID
            "id": patient.get("payer_id", ""),
            "name": patient.get("payer_name", ""),
        },
        "provider": {
            "npi":              provider_npi,
            "organizationName": os.environ.get("PROVIDER_ORG", ""),
        },
        # Request all benefit categories
        "requestedBenefits": [
            "preventive", "basic", "major", "periodontics", "endodontics",
            "oralSurgery", "orthodontics", "implants", "frequencies",
            "limitations", "waitingPeriods", "procedureCodes"
        ],
    }

    resp = requests.post(
        f"{ZUUB_API_URL}/eligibility",
        headers=_zuub_headers(),
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    raw = resp.json()

    logger.info("Zuub response received for payer=%s", patient.get("payer_name", ""))
    return normalize_zuub_response(raw, patient)


def normalize_zuub_response(zuub: dict, patient: dict) -> dict:
    """
    Map Zuub's JSON response to the Dharma Eligibility Tool's standard
    dental response schema — covering all 71 DB Breakdown form fields.

    NOTE: Field paths below are based on Zuub's documented response structure.
    Validate against actual sandbox responses and adjust paths as needed.
    Zuub's response structure (expected):
    {
      "planName": "...",
      "payerId": "...",
      "payerPhone": "...",
      "benefitPeriod": "calendar|fiscal",
      "network": "...",
      "benefits": {
        "annualMaximum": 2000,
        "annualMaximumUsed": 350,
        "deductibleIndividual": 50,
        "deductibleFamily": 150,
        "deductibleMet": 50,
        "preventive": 1.0,
        "basic": 0.8,
        "major": 0.5,
        "periodontics": 0.8,
        "endodontics": 0.8,
        "oralSurgery": 0.8,
        "fillings": 0.8,
        "crowns": 0.5,
        "dentures": 0.5,
        "implantsCovered": true,
        "implantsCoinsurance": 0.5,
        "implantsSeparateMax": null,
        "abutmentCoinsurance": 0.5,
        "implantCrownCoinsurance": 0.5,
        "orthoCoinsurance": 0.5,
        "orthoLifetimeMax": 1500,
        "orthoLifetimeUsed": 0,
        "orthoDeductible": 0,
        "orthoAgeLimit": 19,
        "orthoPaymentMethod": "lump sum"
      },
      "frequencies": {
        "D1110": "2x per calendar year",
        "D0120": "2x per calendar year",
        "D0150": "1x per 3 years",
        "D0210": "1x per 5 years",
        "D0274": "1x per calendar year",
        "D0220": "As needed",
        "D4341": "1x per 2 years per quadrant",
        "D4910": "3-4x per year"
      },
      "limitations": {
        "missingToothClause": false,
        "fillingsDowngrade": false,
        "crownsPaidOn": "seat",
        "sameDayTreatment": true,
        "deductibleAppliesToPreventive": false,
        "preventiveCountsTowardMax": false,
        "replacementCrowns": "5 years",
        "replacementBridges": "5 years",
        "replacementDentures": "5 years",
        "replacementPartials": "5 years",
        "claimsFilingDeadline": "12 months from date of service",
        "fluorideCovered": true,
        "fluorideAgeLimit": 19,
        "sealantsCovered": true,
        "sealantsAgeLimit": 14,
        "sdfCovered": false,
        "arestinCovered": false,
        "perioSameDayExam": true,
        "perioSharesProphyFrequency": true,
        "srpQuadsPerVisit": 2,
        "cobType": "standard"
      },
      "procedureCodes": {
        "D9310": {"covered": true, "category": "basic", "note": "Consultation"},
        "D9944": {"covered": false, "category": "excluded", "note": "Night guard"},
        ...
      },
      "claimAddress": "...",
      "waitingPeriods": {
        "basic": "None",
        "major": "12 months"
      }
    }
    """
    benefits   = zuub.get("benefits", {})
    frequencies = zuub.get("frequencies", {})
    limitations = zuub.get("limitations", {})
    waiting     = zuub.get("waitingPeriods", {})
    codes       = zuub.get("procedureCodes", {})

    annual_max  = benefits.get("annualMaximum")
    annual_used = benefits.get("annualMaximumUsed")
    annual_rem  = (annual_max - annual_used) if (annual_max is not None and annual_used is not None) else None

    return {
        # ── Active / plan basics ──────────────────────────────────────────
        "active":                       zuub.get("active", True),
        "plan_name":                    zuub.get("planName"),
        "plan_begin_date":              zuub.get("planBeginDate"),
        "plan_type":                    "dental",
        "network":                      zuub.get("network"),
        "benefit_period":               zuub.get("benefitPeriod"),
        "payer_id":                     zuub.get("payerId"),
        "payer_phone":                  zuub.get("payerPhone"),
        "claim_address":                zuub.get("claimAddress"),
        "group_number":                 patient.get("group_number"),
        "member_id":                    patient.get("member_id"),

        # ── Maximums & deductibles ────────────────────────────────────────
        "annual_maximum":               annual_max,
        "annual_maximum_used":          annual_used,
        "annual_maximum_remaining":     annual_rem,
        "deductible":                   benefits.get("deductibleIndividual"),
        "deductible_met":               benefits.get("deductibleMet"),
        "deductible_family":            benefits.get("deductibleFamily"),
        "deductible_applies_preventive": limitations.get("deductibleAppliesToPreventive"),
        "preventive_in_max":            limitations.get("preventiveCountsTowardMax"),

        # ── Coverage percentages ──────────────────────────────────────────
        "preventive_coverage":          benefits.get("preventive"),
        "basic_coverage":               benefits.get("basic"),
        "major_coverage":               benefits.get("major"),
        "perio_coverage":               benefits.get("periodontics"),
        "endo_coverage":                benefits.get("endodontics"),
        "oral_surgery_coverage":        benefits.get("oralSurgery"),
        "fillings_coverage":            benefits.get("fillings"),
        "crowns_coverage":              benefits.get("crowns"),
        "dentures_coverage":            benefits.get("dentures"),

        # ── Waiting periods ───────────────────────────────────────────────
        "waiting_period_basic":         waiting.get("basic"),
        "waiting_period_major":         waiting.get("major"),

        # ── Frequency limits ──────────────────────────────────────────────
        "prophy_frequency":             frequencies.get("D1110"),
        "periodic_exam_frequency":      frequencies.get("D0120"),
        "comp_exam_frequency":          frequencies.get("D0150"),
        "fmx_frequency":                frequencies.get("D0210"),
        "bitewing_frequency":           frequencies.get("D0274"),
        "pa_frequency":                 frequencies.get("D0220"),
        "srp_frequency":                frequencies.get("D4341"),
        "perio_maintenance_frequency":  frequencies.get("D4910"),
        "fmd_frequency":                frequencies.get("D4355"),

        # ── Clauses & exclusions ──────────────────────────────────────────
        "missing_tooth_clause":         limitations.get("missingToothClause"),
        "fillings_downgrade":           limitations.get("fillingsDowngrade"),
        "crowns_paid_on":               limitations.get("crownsPaidOn"),
        "same_day_treatment":           limitations.get("sameDayTreatment"),
        "fluoride_covered":             limitations.get("fluorideCovered"),
        "fluoride_age_limit":           limitations.get("fluorideAgeLimit"),
        "sealants_covered":             limitations.get("sealantsCovered"),
        "sealants_age_limit":           limitations.get("sealantsAgeLimit"),
        "sdf_covered":                  limitations.get("sdfCovered"),
        "arestin_covered":              limitations.get("arestinCovered"),
        "perio_same_day_exam":          limitations.get("perioSameDayExam"),
        "perio_shares_prophy_frequency": limitations.get("perioSharesProphyFrequency"),
        "srp_quads_per_visit":          limitations.get("srpQuadsPerVisit"),
        "cob_type":                     limitations.get("cobType"),

        # ── Replacement clauses ───────────────────────────────────────────
        "replacement_crowns":           limitations.get("replacementCrowns"),
        "replacement_bridges":          limitations.get("replacementBridges"),
        "replacement_dentures":         limitations.get("replacementDentures"),
        "replacement_partials":         limitations.get("replacementPartials"),
        "claims_filing_deadline":       limitations.get("claimsFilingDeadline"),

        # ── Implants ──────────────────────────────────────────────────────
        "implants_covered":             benefits.get("implantsCovered"),
        "implants_coverage":            benefits.get("implantsCoinsurance"),
        "implants_separate_max":        benefits.get("implantsSeparateMax"),
        "abutment_coverage":            benefits.get("abutmentCoinsurance"),
        "implant_crown_coverage":       benefits.get("implantCrownCoinsurance"),

        # ── Orthodontics ──────────────────────────────────────────────────
        "ortho_coverage":               benefits.get("orthoCoinsurance"),
        "ortho_lifetime_max":           benefits.get("orthoLifetimeMax"),
        "ortho_lifetime_used":          benefits.get("orthoLifetimeUsed"),
        "ortho_deductible":             benefits.get("orthoDeductible"),
        "ortho_age_limit":              benefits.get("orthoAgeLimit"),
        "ortho_payment_method":         benefits.get("orthoPaymentMethod"),

        # ── Specific CDT codes ────────────────────────────────────────────
        "specific_codes":               codes,

        # ── Meta ──────────────────────────────────────────────────────────
        "active_medical":               False,
        "active_dental":                True,
        "data_source":                  "zuub",
        "_raw_zuub":                    zuub,  # preserve raw for debugging
    }
