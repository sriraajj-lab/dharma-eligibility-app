# Insurance Eligibility & COB Tool — v2.2

AI-powered real-time eligibility verification and Coordination of Benefits (COB) engine for cardiology and cardiac surgery practices.

---

## What It Does

- **Real-time eligibility** via Stedi 270/271 (33 payers supported)
- **Coverage discovery** via pVerify (finds all active plans for a patient)
- **COB ordering** — applies Medicare Secondary Payer rules, birthday rule, and Medicaid-last rule
- **Dental eligibility stub** — returns active/plan name only (no fabricated dollar amounts)
- **Async job queue** — submit batch jobs, poll for results, export to CSV/Excel
- **Multi-tenant isolation** — per-job API key hash stored in SQLite

---

## Quick Start

```bash
# 1. Copy and fill environment variables
cp .env.example .env

# 2. Build and run
docker compose up --build

# 3. Verify health
curl http://localhost:8000/health
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `API_KEYS` | ✅ | Comma-separated list of valid API keys |
| `STEDI_API_KEY` | ✅ | Stedi Healthcare API key |
| `PROVIDER_NPI` | ✅ | Your practice NPI (10-digit) |
| `PROVIDER_ORG` | optional | Organization name sent to Stedi (default: "Aria Agency") |
| `PVERIFY_CLIENT_ID` | optional | pVerify OAuth2 client ID |
| `PVERIFY_CLIENT_SECRET` | optional | pVerify OAuth2 client secret |
| `MASK_PHI_LOGS` | optional | Set to `false` to disable PHI masking in logs (default: `true`) |
| `ALLOWED_ORIGINS` | optional | Comma-separated CORS origins (default: `*`) |
| `DATABASE_URL` | optional | SQLite path (default: `eligibility.db`) |

---

## API Endpoints

### `POST /api/resolve`
Real-time single-patient eligibility check.

**Headers:** `X-API-Key: <your-key>`

**Request:**
```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "dob": "1980-01-15",
  "member_id": "ABC123456",
  "payer_name": "aetna"
}
```

**Response:**
```json
{
  "active": true,
  "plan_name": "Aetna Choice POS II",
  "deductible": 1500.00,
  "deductible_met": 450.00,
  "oop_max": 5000.00,
  "oop_met": 900.00,
  "copay": 30.00,
  "coinsurance": 0.20
}
```

### `POST /api/batch`
Submit a batch of patients (JSON array or CSV upload).

### `GET /api/jobs/{job_id}`
Poll job status.

### `GET /api/jobs/{job_id}/results`
Retrieve completed results.

### `GET /api/export/{job_id}`
Export results as CSV or Excel.

---

## Supported Payers

33 payers including: Aetna, Anthem, BCBS (10 state plans), Cigna, Humana, UnitedHealthcare, Molina, Oscar, Centene, WellCare, Kaiser, Highmark, CareFirst, Independence BCBS, Premera, Regence, Tufts, Harvard Pilgrim, Medicare, Medicaid, TRICARE, CHAMPVA, VA, Delta Dental, MetLife Dental, VSP.

To add a payer, add its entry to `PAYER_ID_MAP` in `eligibility_engine.py`.

---

## Running Tests

```bash
pip install pytest
pytest test_cob_engine.py -v
# 27/27 tests pass
```

---

## Architecture

```
main.py              FastAPI app, auth, rate limiting, job queue
eligibility_engine.py  Stedi + pVerify + dental stub
cob_engine.py        COB ordering (MSP rules, birthday rule)
intake.py            CSV/JSON intake and validation
exporter.py          CSV/Excel export
```

---

## Security Notes

- API keys compared with `secrets.compare_digest()` (constant-time, timing-safe)
- API keys read from environment on every request (no module-level caching)
- PHI masked in all log output by default (`MASK_PHI_LOGS=true`)
- Per-job `api_key_hash` (SHA-256 prefix) stored for multi-tenant isolation
- Unknown payer IDs raise `ValueError` — no garbage sent to Stedi
- Dental stub returns no dollar amounts (avoids fabricated financial data)

---

## Changelog

### v2.2 (current)
- Security hardening: constant-time key comparison, fresh env reads, PHI masking
- Payer map expanded from 13 → 33 payers
- Unknown payer IDs raise `ValueError` instead of sending bad data to Stedi
- Dental stub no longer returns fabricated dollar amounts
- Per-job `api_key_hash` column for multi-tenant isolation
- Duplicate `import time` removed
- CORS explicit allowlist via `ALLOWED_ORIGINS` env var

### v2.1
- Stedi 270/271 integration wired (replaces TODO stub)
- pVerify coverage discovery added
- COB engine with MSP rules and birthday rule
- Async job queue with SQLite persistence
- CSV/Excel export

### v2.0
- Initial release

---

## License

MIT. See [LICENSE](LICENSE).
