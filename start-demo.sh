#!/usr/bin/env bash
# One-command TrustLedger demo boot (macOS/Linux): Redis -> backend -> frontend.
# Reads REDIS_URL and LLM_API_KEY from the repo-root .env (loaded by the backend).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "== TrustLedger demo boot =="

if [ ! -f "$ROOT/.env" ]; then
  echo "  WARNING: no .env at repo root. Backend needs REDIS_URL and LLM_API_KEY."
fi

# 1. Redis on :6379 — prefer Docker, fall back to a local redis-server binary.
echo "[1/3] Redis..."
if command -v docker >/dev/null 2>&1; then
  docker start redis-server >/dev/null 2>&1 \
    || docker run -d --name redis-server -p 6379:6379 redis >/dev/null
elif command -v redis-server >/dev/null 2>&1; then
  redis-server --daemonize yes >/dev/null 2>&1 || true
else
  echo "  Neither Docker nor redis-server found. Start Redis on :6379 manually."
fi
sleep 2

# 2. Backend (background, venv if present)
echo "[2/3] Backend on :8000..."
PY="$ROOT/backend/venv/bin/python"
[ -x "$PY" ] || PY="python3"
(cd "$ROOT/backend" && "$PY" -m uvicorn app.main:app --reload --port 8000 &)

# 3. Frontend (background) — install deps on first run, prefer pnpm.
# Vite serves on :3000 and proxies /api to the backend on :8000.
echo "[3/3] Frontend on :3000..."
if command -v pnpm >/dev/null 2>&1; then
  PKG="pnpm"
else
  PKG="npm"
fi
(cd "$ROOT/frontend" && { [ -d node_modules ] || "$PKG" install; } && "$PKG" run dev &)

sleep 4
echo "Dashboard: http://localhost:3000  |  Ledger JSON: http://localhost:8000/api/ledger"
wait
