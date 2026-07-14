"""
COB (Coordination of Benefits) Rules Engine
Implements: Birthday Rule, Medicare Secondary Payer (MSP), Medicaid last-resort
"""
from datetime import date, datetime
from typing import Optional
from functools import cmp_to_key


def parse_date(val) -> Optional[date]:
    if not val:
        return None
    if isinstance(val, date):
        return val
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(str(val).strip(), fmt).date()
        except ValueError:
            pass
    return None


def birthday_rule(dob1: Optional[date], dob2: Optional[date]) -> int:
    if not dob1:
        return 1
    if not dob2:
        return 0
    md1 = (dob1.month, dob1.day)
    md2 = (dob2.month, dob2.day)
    if md1 < md2:
        return 0
    elif md2 < md1:
        return 1
    else:
        return 0 if dob1.year <= dob2.year else 1


def classify_payer(payer_name: str) -> str:
    name = payer_name.lower()
    if "medicare" in name:
        return "medicare"
    if "medicaid" in name or "medi-cal" in name or "ahcccs" in name:
        return "medicaid"
    if "tricare" in name or "champva" in name:
        return "tricare"
    if "dental" in name:
        return "dental"
    if "vision" in name:
        return "vision"
    return "group"


def apply_msp_rules(patient_age: int, coverages: list) -> list:
    has_medicare = any(classify_payer(c.get("payer_name", "")) == "medicare" for c in coverages)
    if not has_medicare:
        return coverages

    medicare_covs, group_covs, other_covs = [], [], []
    for c in coverages:
        pt = classify_payer(c.get("payer_name", ""))
        if pt == "medicare":
            medicare_covs.append(c)
        elif pt == "group":
            group_covs.append(c)
        else:
            other_covs.append(c)

    esrd = any(c.get("esrd", False) for c in coverages)
    esrd_months = max((c.get("esrd_months", 0) for c in coverages), default=0)
    disability = any(c.get("disability", False) for c in coverages)

    if group_covs:
        if patient_age >= 65 or (disability and patient_age < 65) or (esrd and esrd_months <= 30):
            result = group_covs + medicare_covs + other_covs
        else:
            result = medicare_covs + group_covs + other_covs
    else:
        result = medicare_covs + other_covs

    medicaid = [c for c in result if classify_payer(c.get("payer_name", "")) == "medicaid"]
    non_medicaid = [c for c in result if classify_payer(c.get("payer_name", "")) != "medicaid"]
    return non_medicaid + medicaid


def order_coverages(patient: dict, coverages: list) -> list:
    if not coverages:
        return []

    dob = parse_date(patient.get("dob"))
    age = 0
    if dob:
        today = date.today()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    ordered = apply_msp_rules(age, coverages)

    seen_types: dict = {}
    for cov in ordered:
        pt = classify_payer(cov.get("payer_name", ""))
        seen_types.setdefault(pt, []).append(cov)

    group_plans = seen_types.get("group", [])
    if len(group_plans) > 1:
        def cmp(a, b):
            da = parse_date(a.get("subscriber_dob"))
            db = parse_date(b.get("subscriber_dob"))
            r = birthday_rule(da, db)
            return -1 if r == 0 else 1
        seen_types["group"] = sorted(group_plans, key=cmp_to_key(cmp))

    type_order = ["tricare", "group", "dental", "vision", "individual", "medicare", "other", "medicaid"]
    final = []
    for t in type_order:
        final.extend(seen_types.get(t, []))

    reasons = {
        "tricare": "TRICARE/CHAMPVA — federal program, primary by statute",
        "group": "Employer group plan — primary per MSP/birthday rule",
        "dental": "Dental plan — primary for dental services",
        "vision": "Vision plan — primary for vision services",
        "individual": "Individual/marketplace plan",
        "medicare": "Medicare — secondary per MSP rules",
        "other": "Other coverage",
        "medicaid": "Medicaid — payer of last resort by federal law",
    }
    for i, cov in enumerate(final):
        cov = dict(cov)
        cov["cob_order"] = i + 1
        pt = classify_payer(cov.get("payer_name", ""))
        cov["cob_reason"] = reasons.get(pt, "Standard COB ordering")
        final[i] = cov

    return final
