"""
Intake parser: CSV, Excel, PDF → list of patient dicts with coverages
"""
import io
import re
import json
from typing import List, Dict, Any


REQUIRED_COLS = ["first_name", "last_name", "dob", "gender"]
COVERAGE_COLS = ["payer_name", "member_id", "group_number", "plan_type", "subscriber_dob"]

COL_ALIASES = {
    "firstname": "first_name", "first": "first_name", "fname": "first_name",
    "lastname": "last_name", "last": "last_name", "lname": "last_name",
    "dateofbirth": "dob", "date_of_birth": "dob", "birthdate": "dob", "birth_date": "dob",
    "sex": "gender",
    "payername": "payer_name", "payer": "payer_name", "insurance": "payer_name", "insurer": "payer_name",
    "memberid": "member_id", "member": "member_id", "subscriber_id": "member_id", "subscriberId": "member_id",
    "groupnumber": "group_number", "group": "group_number", "groupid": "group_number",
    "plantype": "plan_type", "type": "plan_type",
    "subscriberdob": "subscriber_dob",
}


def normalize_col(col: str) -> str:
    return COL_ALIASES.get(col.lower().replace(" ", "_").replace("-", "_"), col.lower().replace(" ", "_").replace("-", "_"))


def rows_to_patients(rows: List[Dict]) -> List[Dict]:
    """Group rows by patient (first_name+last_name+dob), collect coverages."""
    patients: Dict[str, Dict] = {}
    for row in rows:
        norm = {normalize_col(k): v for k, v in row.items() if v not in (None, "", "nan")}
        key = f"{norm.get('first_name','').lower()}|{norm.get('last_name','').lower()}|{norm.get('dob','')}"
        if key not in patients:
            patients[key] = {
                "first_name": norm.get("first_name", ""),
                "last_name": norm.get("last_name", ""),
                "dob": norm.get("dob", ""),
                "gender": norm.get("gender", ""),
                "state": norm.get("state", ""),
                "employer": norm.get("employer", ""),
                "spouse_dob": norm.get("spouse_dob", ""),
                "coverages": [],
            }
        cov = {k: norm.get(k, "") for k in COVERAGE_COLS if norm.get(k)}
        if cov.get("payer_name"):
            patients[key]["coverages"].append(cov)
    return list(patients.values())


def parse_csv(content: bytes) -> List[Dict]:
    import csv
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return rows_to_patients(list(reader))


def parse_excel(content: bytes) -> List[Dict]:
    import pandas as pd
    df = pd.read_excel(io.BytesIO(content), dtype=str)
    df = df.where(df.notna(), None)
    return rows_to_patients(df.to_dict("records"))


def parse_pdf(content: bytes) -> List[Dict]:
    """Heuristic PDF extraction — works on structured EOB/eligibility PDFs."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        return [{"_error": f"PDF parse failed: {e}", "coverages": []}]

    patients = []
    # Try to find patient blocks
    blocks = re.split(r"(?i)(patient|member|subscriber)\s*:", text)
    if len(blocks) < 2:
        blocks = [text]

    for block in blocks:
        patient: Dict[str, Any] = {"coverages": []}
        # Name
        m = re.search(r"(?i)(?:name|patient|member)[:\s]+([A-Z][a-z]+)[,\s]+([A-Z][a-z]+)", block)
        if m:
            patient["last_name"] = m.group(1)
            patient["first_name"] = m.group(2)
        # DOB
        m = re.search(r"(?i)(?:dob|date of birth|birth)[:\s]*([\d/\-]+)", block)
        if m:
            patient["dob"] = m.group(1)
        # Member ID
        m = re.search(r"(?i)(?:member id|member #|subscriber id)[:\s]*([A-Z0-9\-]+)", block)
        if m:
            patient.setdefault("coverages", [])
            if not patient["coverages"]:
                patient["coverages"].append({})
            patient["coverages"][0]["member_id"] = m.group(1)
        # Payer
        m = re.search(r"(?i)(?:payer|insurance|plan)[:\s]+([^\n]+)", block)
        if m:
            if not patient.get("coverages"):
                patient["coverages"].append({})
            patient["coverages"][0]["payer_name"] = m.group(1).strip()
        # Group
        m = re.search(r"(?i)(?:group|group #|group number)[:\s]*([A-Z0-9\-]+)", block)
        if m:
            if not patient.get("coverages"):
                patient["coverages"].append({})
            patient["coverages"][0]["group_number"] = m.group(1)

        if patient.get("first_name") or patient.get("coverages"):
            patients.append(patient)

    return patients if patients else [{"_raw_text": text[:500], "coverages": [], "_note": "Could not parse structured data from PDF"}]


def parse_json(content: bytes) -> List[Dict]:
    data = json.loads(content.decode("utf-8"))
    if isinstance(data, list):
        return rows_to_patients(data) if data and "payer_name" in str(data[0]) else data
    if isinstance(data, dict):
        return [data]
    return []


def parse_file(filename: str, content: bytes) -> List[Dict]:
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext == "csv":
        return parse_csv(content)
    elif ext in ("xlsx", "xls"):
        return parse_excel(content)
    elif ext == "pdf":
        return parse_pdf(content)
    elif ext == "json":
        return parse_json(content)
    else:
        # Try CSV as fallback
        try:
            return parse_csv(content)
        except Exception:
            return [{"_error": f"Unsupported file type: {ext}", "coverages": []}]
