#!/usr/bin/env bash
# One-command TrustLedger demo boot (macOS/Linux): Redis -> backend -> frontend.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "== TrustLedger demo boot =="

# 1. Redis (Docker `redis-server`, port 6379)
echo "[1/3] Redis..."
docker start redis-server >/dev/null 2>&1 \
  || docker run -d --name redis-server -p 6379:6379 redis >/dev/null
sleep 3

# 2. Backend (background, venv if present)
echo "[2/3] Backend on :8000..."
PY="$ROOT/backend/venv/bin/python"
[ -x "$PY" ] || PY="python3"
(cd "$ROOT/backend" && "$PY" -m uvicorn app.main:app --reload --port 8000 &)

# 3. Frontend (background)
echo "[3/3] Frontend on :5173..."
(cd "$ROOT/frontend" && npm run dev &)

sleep 4
echo "Dashboard: http://localhost:5173  |  Ledger JSON: http://localhost:8000/api/ledger"
wait
