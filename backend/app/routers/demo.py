"""routers/demo.py — DEMO ONLY endpoint for frontend animated replay.

POST /api/demo/seed is for demo purposes only (not part of the core
dispute/ledger/review surface). It scripts the full trust climb-then-fall:
15 confirmed_correct -> draft_for_approval, 15 more confirmed_correct ->
approach auto_execute, 1 final overturned -> live demotion. Frontend replays
the returned "events" array as an animation rather than just showing end state.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..models import DisputeCategory, ReviewOutcome
from ..ledger_service import apply_transition, get_or_create_ledger
from ..orchestrator import run_pipeline
from ..redis_client import get_redis
from ..review_logic import apply_review_transition

router = APIRouter(prefix="/api", tags=["demo"])


class SeedRequest(BaseModel):
    category: DisputeCategory


def _err(status: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": error, "detail": detail})


def _is_stakes_dispute(dispute: dict) -> bool:
    """Same stakes detection as POST /api/review (CONTRACT.md)."""
    try:
        amount = float(dispute.get("amount", 0) or 0)
    except Exception:
        amount = 0
    decision = dispute.get("decision") or {}
    esc = dispute.get("escalation_packet") or {}
    return (
        bool(decision.get("stakes_override"))
        or amount > 50_000
        or esc.get("escalation_reason") == "stakes_override"
    )


async def _review_as(dispute_id: str, outcome: ReviewOutcome, category: DisputeCategory):
    """Mirror of POST /api/review core (no HTTP): apply tier transition.

    Returns (ledger_after_record, was_stakes). Marks dispute reviewed with
    timestamp, updates review_history sidecar for non-stakes, LREMs queue.
    """
    r = await get_redis()
    raw = await r.get(f"dispute:{dispute_id}")
    record = json.loads(raw)

    if _is_stakes_dispute(record):
        ledger_after = await get_or_create_ledger(category)
        record["status"] = "reviewed"
        record["review_outcome"] = outcome.value
        record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
        await r.set(f"dispute:{dispute_id}", json.dumps(record, default=str))
        try:
            await r.lrem("escalation_queue", 0, dispute_id)
        except Exception:
            pass
        return ledger_after, True

    hist_key = f"review_history:{category.value}"
    hist_raw = await r.get(hist_key)
    try:
        recent: list[str] = json.loads(hist_raw) if hist_raw else []
        if not isinstance(recent, list):
            recent = []
        recent = [str(v) for v in recent][-10:]
    except Exception:
        recent = []

    def _fn(current):
        return apply_review_transition(category, current, outcome, recent)

    ledger_after = await apply_transition(category, _fn)
    try:
        await r.set(hist_key, json.dumps((recent + [outcome.value])[-10:]))
    except Exception:
        pass

    record["status"] = "reviewed"
    record["review_outcome"] = outcome.value
    record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    await r.set(f"dispute:{dispute_id}", json.dumps(record, default=str))
    try:
        await r.lrem("escalation_queue", 0, dispute_id)
    except Exception:
        pass
    return ledger_after, False


@router.post("/demo/seed")
async def seed_demo(req: SeedRequest):
    """Scripted 31-step climb-then-fall for the given category.

    Steps 1-15: ingest + confirmed_correct (cross suggest_only -> draft).
    Steps 16-30: ingest + confirmed_correct (approach auto_execute;
    fraud_flag stays draft — hard-capped — by design).
    Step 31: ingest + overturned (live demotion by one level).
    Returns {"events": [{step, tier_after, message}]} — 31 entries in order.
    """
    category = req.category
    events: list[dict] = []

    async def _one_countable_step(step: int, outcome: ReviewOutcome, label: str) -> None:
        """Ingest (retrying stakes draws) then review once; append one event.

        synthetic_data yields ~5% stakes_override amounts which CONTRACT.md
        excludes from stats — retrying keeps the demo's 31 events countable
        so thresholds (15 / 30) are hit deterministically.
        """
        tier_before = (await get_or_create_ledger(category)).current_tier.value
        dispute_id: str | None = None
        for _ in range(10):  # bound retries; stakes are rare
            result = await run_pipeline(category=category, seed_overturn=False)
            dispute = result["dispute"]
            dispute_id = dispute["id"]
            if not _is_stakes_dispute(dispute):
                break
            # Stakes draw: mark reviewed (excluded from stats) and redraw.
            await _review_as(dispute_id, ReviewOutcome.confirmed_correct, category)
            dispute_id = None
        if dispute_id is None:  # degenerate fallback; still emit a valid event
            result = await run_pipeline(category=category, seed_overturn=False)
            dispute_id = result["dispute"]["id"]

        ledger_after, _ = await _review_as(dispute_id, outcome, category)
        tier_after = ledger_after.current_tier.value

        if outcome == ReviewOutcome.overturned:
            if tier_after != tier_before:
                message = f"Case {label}: overturned -> demoted to {tier_after}"
            else:
                message = f"Case {label}: overturned (remains {tier_after})"
        else:
            if tier_after != tier_before:
                message = f"Case {label}: promoted to {tier_after}"
            elif step == 30 and category == DisputeCategory.fraud_flag:
                message = f"Case {label}: confirmed (remains {tier_after}, hard-capped)"
            else:
                message = f"Case {label}: confirmed ({tier_after})"
        events.append({"step": step, "tier_after": tier_after, "message": message})

    try:
        for i in range(1, 16):
            await _one_countable_step(i, ReviewOutcome.confirmed_correct, f"{i}/15")
        for i in range(16, 31):
            await _one_countable_step(i, ReviewOutcome.confirmed_correct, f"{i}/30")
        await _one_countable_step(31, ReviewOutcome.overturned, "31/31")

        if len(events) != 31:
            return _err(500, "SeedFailed", f"expected 31 events, got {len(events)}")
        return {"events": events}
    except Exception as e:
        return _err(500, "SeedFailed", str(e))
