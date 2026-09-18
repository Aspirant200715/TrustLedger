# TrustLedger

AI teammate that earns the right to act with real money — one dispute at a time.
Per-category autonomy ledger (`suggest_only` → `draft_for_approval` → `auto_execute`)
with human escalation. Spec: [`CONTRACT.md`](CONTRACT.md) — treat it as append-only;
read it before touching any code.

## Prerequisites

- Python 3.11, Node 18+, Docker Desktop (for Redis), a Groq `LLM_API_KEY`.

## Setup

```powershell
# 1. Redis (Docker container `redis-server`, port 6379)
docker start redis-server 2>$null; if ($LASTEXITCODE -ne 0) { docker run -d --name redis-server -p 6379:6379 redis }

# 2. Backend
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then set LLM_API_KEY (Groq) in .env
uvicorn app.main:app --reload  # serves http://localhost:8000

# 3. Frontend (new terminal, repo root)
cd frontend
npm install
npm run dev                    # serves http://localhost:5173
```

 macOS/Linux: same steps with `python3 -m venv venv`, `source venv/bin/activate`,
`cp .env.example .env`.

## Env vars

| File | Var | Default | Purpose |
|---|---|---|---|
| `backend/.env` | `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `backend/.env` | `LLM_API_KEY` | (required) | Groq API key for investigator/decision agents |
| `frontend/.env` | `VITE_API_BASE_URL` | `http://localhost:8000/api` | Backend base URL (see `frontend/.env.example`) |

## Tests (governance layer, no network)

```powershell
pip install pytest
pytest backend/tests/ -v
```

8 tests, ~1s: exact promotion boundaries (15 / 30), one-level demotion,
`fraud_flag` hard-cap, accuracy gating, history entries, plus a stakes-override
pipeline run with stubbed LLM + in-memory Redis. See `backend/tests/README.md`.

## One-command demo boot

```powershell
.\start-demo.ps1   # Windows: Redis → backend → frontend, opens the dashboard
bash start-demo.sh # macOS/Linux equivalent
```

## Final rehearsal checklist

0. `pytest backend/tests/ -v` — green tests are your evidence if a judge doubts the mechanic.
1. Cold boot from the start script — no manual steps.
2. Run the demo sequence live for `upi_debited_not_credited` and narrate:
   climb → auto-execute → seeded overturn → demotion, on screen.
3. Show one `stakes_override` (>₹50,000 dispute) escalating regardless of tier —
   answers "how do you stop it being reckless with real money."
4. Keep `GET /api/ledger` open in a second tab/Postman as backup — raw JSON proves
   the mechanic even if a render breaks.
5. When re-prompting an agent to fix something, start with
   "Read CONTRACT.md and the current state of [file], then…" — never let it
   regenerate a module fresh. New fields go in CONTRACT.md first, code second.
