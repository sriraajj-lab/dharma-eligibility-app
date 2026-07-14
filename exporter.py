"""
Multi-format exporter: JSON, CSV, Excel, PDF report
"""
import io
import json
import csv
from datetime import datetime
from typing import List, Dict, Any


def to_json(results: List[Dict]) -> bytes:
    return json.dumps(results, indent=2, default=str).encode("utf-8")


def flatten_result(r: Dict) -> Dict:
    p = r.get("patient", {})
    active_med = r.get("active_medical", [])
    active_den = r.get("active_dental", [])
    flags = r.get("denial_prevention", [])
    return {
        "first_name": p.get("first_name", ""),
        "last_name": p.get("last_name", ""),
        "dob": p.get("dob", ""),
        "gender": p.get("gender", ""),
        "status": r.get("status", ""),
        "primary_medical_payer": r.get("primary_payer", ""),
        "secondary_medical_payer": r.get("secondary_payer", ""),
        "primary_dental_payer": r.get("primary_dental", ""),
        "active_medical_count": len(active_med),
        "active_dental_count": len(active_den),
        "denial_flags": "; ".join(f"{f['code']}: {f['description']}" for f in flags),
        "cob_order": " → ".join(c.get("payer_name", "") for c in active_med),
    }


def to_csv(results: List[Dict]) -> bytes:
    if not results:
        return b""
    rows = [flatten_result(r) for r in results]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def to_excel(results: List[Dict]) -> bytes:
    import pandas as pd
    rows = [flatten_result(r) for r in results]
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        # Summary sheet
        df_summary = pd.DataFrame(rows)
        df_summary.to_excel(writer, sheet_name="Summary", index=False)

        # Detail sheet — one row per coverage
        detail_rows = []
        for r in results:
            p = r.get("patient", {})
            name = f"{p.get('first_name','')} {p.get('last_name','')}".strip()
            for cov in r.get("active_medical", []) + r.get("active_dental", []):
                detail_rows.append({
                    "patient": name,
                    "dob": p.get("dob", ""),
                    "payer_name": cov.get("payer_name", ""),
                    "member_id": cov.get("member_id", ""),
                    "group_number": cov.get("group_number", ""),
                    "plan_type": cov.get("plan_type", ""),
                    "cob_order": cov.get("cob_order", ""),
                    "cob_reason": cov.get("cob_reason", ""),
                    "source": cov.get("source", "on_file"),
                })
        if detail_rows:
            pd.DataFrame(detail_rows).to_excel(writer, sheet_name="Coverage Detail", index=False)

        # Denial flags sheet
        flag_rows = []
        for r in results:
            p = r.get("patient", {})
            name = f"{p.get('first_name','')} {p.get('last_name','')}".strip()
            for f in r.get("denial_prevention", []):
                flag_rows.append({"patient": name, "denial_code": f["code"], "description": f["description"]})
        if flag_rows:
            pd.DataFrame(flag_rows).to_excel(writer, sheet_name="Denial Flags", index=False)

    return buf.getvalue()


def to_pdf_report(results: List[Dict]) -> bytes:
    """Generate a clean PDF report using reportlab."""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.75*inch, rightMargin=0.75*inch,
                            topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story = []

    # Title
    title_style = ParagraphStyle("Title", parent=styles["Title"], fontSize=18, textColor=colors.HexColor("#1a56db"), spaceAfter=4)
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=10, textColor=colors.grey, spaceAfter=12)
    story.append(Paragraph("Insurance Eligibility & COB Report", title_style))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%B %d, %Y %I:%M %p')} | Patients: {len(results)}", sub_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1a56db")))
    story.append(Spacer(1, 12))

    # Summary table
    header = ["Patient", "Primary Medical", "Secondary Medical", "Primary Dental", "Denial Flags"]
    data = [header]
    for r in results:
        p = r.get("patient", {})
        name = f"{p.get('first_name','')} {p.get('last_name','')}".strip()
        flags = "; ".join(f["code"] for f in r.get("denial_prevention", []))
        data.append([
            name or "—",
            r.get("primary_payer") or "None found",
            r.get("secondary_payer") or "—",
            r.get("primary_dental") or "—",
            flags or "✓ None",
        ])

    tbl = Table(data, colWidths=[1.4*inch, 1.8*inch, 1.8*inch, 1.4*inch, 1.4*inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1a56db")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 8),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f0f4ff")]),
        ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#d1d5db")),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("PADDING", (0,0), (-1,-1), 4),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 16))

    # Per-patient detail
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#1e3a5f"), spaceBefore=12, spaceAfter=4)
    h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=10, textColor=colors.HexColor("#374151"), spaceBefore=6, spaceAfter=2)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9, spaceAfter=2)
    flag_style = ParagraphStyle("Flag", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#b91c1c"), spaceAfter=2)
    ok_style = ParagraphStyle("OK", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#15803d"), spaceAfter=2)

    for r in results:
        p = r.get("patient", {})
        name = f"{p.get('first_name','')} {p.get('last_name','')}".strip() or "Unknown Patient"
        story.append(Paragraph(f"Patient: {name}", h2))
        story.append(Paragraph(f"DOB: {p.get('dob','—')}  |  Gender: {p.get('gender','—')}  |  State: {p.get('state','—')}", body))

        # Medical coverages
        if r.get("active_medical"):
            story.append(Paragraph("Medical Coverage (COB Order)", h3))
            for cov in r["active_medical"]:
                story.append(Paragraph(
                    f"<b>#{cov['cob_order']} {cov.get('payer_name','')}</b> — Member: {cov.get('member_id','—')} | Group: {cov.get('group_number','—')} | {cov.get('cob_reason','')}",
                    body))

        # Dental coverages
        if r.get("active_dental"):
            story.append(Paragraph("Dental Coverage", h3))
            for cov in r["active_dental"]:
                elig = cov.get("eligibility", {})
                story.append(Paragraph(
                    f"<b>{cov.get('payer_name','')}</b> — Annual Max: ${elig.get('annual_maximum','—')} | Preventive: {elig.get('preventive_coverage','—')} | Basic: {elig.get('basic_coverage','—')} | Major: {elig.get('major_coverage','—')}",
                    body))

        # Denial flags
        flags = r.get("denial_prevention", [])
        if flags:
            story.append(Paragraph("⚠ Denial Prevention Alerts", h3))
            for f in flags:
                story.append(Paragraph(f"<b>{f['code']}</b>: {f['description']}", flag_style))
        else:
            story.append(Paragraph("✓ No denial flags", ok_style))

        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e5e7eb")))
        story.append(Spacer(1, 8))

    doc.build(story)
    return buf.getvalue()
