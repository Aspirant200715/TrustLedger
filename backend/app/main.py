from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .redis_client import get_redis
import redis.asyncio as redis
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Imports ─────────────────────────────────────────────────────────────────
from .models import Dispute, EscalationReason, TierLevel
from .synthetic_data import generate_dispute
from .agents.investigator import investigate
from .agents.decision import decide
from .agents.action import execute
from .agents.escalation import escalate
from .ledger_service import get_or_create_ledger, get_all_ledgers
from .routers.disputes import router as disputes_router
from .routers.demo import router as demo_router

app.include_router(disputes_router)
app.include_router(demo_router)

# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health_check(redis_client: redis.Redis = Depends(get_redis)):
    try:
        await redis_client.ping()
        return {"status": "ok"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": "Service Unavailable", "detail": "Could not connect to Redis"}
        )

# ─── DEV-ONLY endpoints (NOT part of CONTRACT.md surface) ──────────────────
# Kept for Phases 2-4 debugging now that the real pipeline
# (POST /api/disputes/ingest via routers/disputes.py + orchestrator.py)
# covers their purpose. Do not use in prod/demo frontend.
# ─── DEV: Sample generator ────────────────────────────────────────────────────
@app.get("/api/dev/generate-sample")
async def generate_sample():
    """DEV ONLY: Generate 5 sample disputes to test the synthetic data generator."""
    samples = []
    for _ in range(5):
        dispute, mock_ledger = generate_dispute()
        samples.append({
            "dispute": dispute.model_dump(mode="json"),
            "mock_ledger_state": mock_ledger
        })
    return {"samples": samples}

# ─── DEV: Investigate only ────────────────────────────────────────────────────
@app.post("/api/dev/investigate/{dispute_id}")
async def dev_investigate(dispute_id: str, redis_client: redis.Redis = Depends(get_redis)):
    """DEV ONLY: Generate a dispute if missing, run it through the Investigator Agent."""
    dispute_data = await redis_client.get(f"dispute:{dispute_id}")
    if not dispute_data:
        dispute, mock_ledger = generate_dispute()
        dispute.id = dispute_id
        await redis_client.set(f"dispute:{dispute_id}", dispute.model_dump_json())
        await redis_client.set(f"ground_truth:{dispute_id}", json.dumps(mock_ledger))
    else:
        dispute = Dispute.model_validate_json(dispute_data)

    result = await investigate(dispute)
    return {"investigation_result": result.model_dump(mode="json")}

# ─── DEV: Investigate + Decide ───────────────────────────────────────────────
@app.post("/api/dev/decide/{dispute_id}")
async def dev_decide(dispute_id: str, redis_client: redis.Redis = Depends(get_redis)):
    """DEV ONLY: Generate dispute if missing, run investigate + decide, return Decision."""
    dispute_data = await redis_client.get(f"dispute:{dispute_id}")
    if not dispute_data:
        dispute, mock_ledger = generate_dispute()
        dispute.id = dispute_id
        await redis_client.set(f"dispute:{dispute_id}", dispute.model_dump_json())
        await redis_client.set(f"ground_truth:{dispute_id}", json.dumps(mock_ledger))
    else:
        record = json.loads(dispute_data)
        dispute = Dispute.model_validate(record)

    # Run investigate (idempotent if already done)
    investigation = await investigate(dispute)

    # Run decide
    decision = await decide(dispute, investigation)

    # Determine routing and run action or escalation
    if decision.final_path == TierLevel.auto_execute:
        try:
            execution = await execute(dispute, decision)
            return {
                "decision": decision.model_dump(mode="json"),
                "execution_result": execution.model_dump(mode="json"),
                "routing": "auto_execute"
            }
        except ValueError as e:
            # Safety re-validation failed: escalate as fallback
            packet = await escalate(dispute, investigation, decision, EscalationReason.stakes_override)
            return {
                "decision": decision.model_dump(mode="json"),
                "escalation_packet": packet.model_dump(mode="json"),
                "routing": "escalated_after_action_safety_check"
            }
    elif decision.final_path == "escalate":
        reason = EscalationReason.stakes_override if decision.stakes_override else EscalationReason.hard_capped_category
        packet = await escalate(dispute, investigation, decision, reason)
        return {
            "decision": decision.model_dump(mode="json"),
            "escalation_packet": packet.model_dump(mode="json"),
            "routing": "escalated"
        }
    else:
        # draft_for_approval or suggest_only -> escalate for human review
        packet = await escalate(dispute, investigation, decision, EscalationReason.tier_capped)
        return {
            "decision": decision.model_dump(mode="json"),
            "escalation_packet": packet.model_dump(mode="json"),
            "routing": "tier_capped_escalated"
        }
