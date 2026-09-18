#Requires -Version 5.1
<#
.SYNOPSIS
  One-command TrustLedger demo boot (Windows): Redis -> backend -> frontend.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

Write-Host "== TrustLedger demo boot ==" -ForegroundColor Green

# 1. Redis (Docker `redis-server`, port 6379)
Write-Host "[1/3] Redis..." -ForegroundColor Cyan
docker start redis-server 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  no existing container; creating redis-server..."
  docker run -d --name redis-server -p 6379:6379 redis | Out-Null
}
Start-Sleep -Seconds 3

# 2. Backend (own window, venv if present)
Write-Host "[2/3] Backend on :8000..." -ForegroundColor Cyan
$BackendPython = Join-Path $Root "backend\venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $BackendPython)) { $BackendPython = "python" }
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location -LiteralPath '$Root\backend'; & '$BackendPython' -m uvicorn app.main:app --reload --port 8000"
) | Out-Null

# 3. Frontend (own window)
Write-Host "[3/3] Frontend on :5173..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location -LiteralPath '$Root\frontend'; npm run dev"
) | Out-Null

Start-Sleep -Seconds 4
Start-Process "http://localhost:5173" | Out-Null
Write-Host "Dashboard: http://localhost:5173  |  Ledger JSON: http://localhost:8000/api/ledger" -ForegroundColor Green
