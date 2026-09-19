"""routers/disputes.py — All CONTRACT.md /api routes.

Wire-up in main.py:
    from .routers.disputes import router
    app.include_router(router)

Router carries prefix="/api" per CONTRACT.md.
Pure tier logic lives in ..review_logic.apply_review_transition (no I/O);
this module handles Redis I/O, request parsing, and error envelopes.
All error responses are {error, detail}, never raw tracebacks.
"""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from ..models import Dispute, DisputeCategory, DisputeStatus, ReviewOutcome
from ..ledger_service import apply_transition, get_or_create_ledger, get_all_ledgers
from ..orchestrator import run_pipeline
from ..redis_client import get_redis
from ..review_logic import apply_review_transition

router = APIRouter(prefix="/api", tags=["disputes"])


# ─── Request models (exact CONTRACT.md shapes) ─────────────────────
class IngestRequest(BaseModel):
    category: DisputeCategory | None = None  # null = random synthetic dispute
    seed_overturn: bool = False
    amount: float | None = Field(default=None, gt=0, le=10_000_000)
    utr: str | None = Field(default=None, min_length=4, max_length=64)
    ticket_text: str | None = Field(default=None, min_length=10, max_length=4000)

    @model_validator(mode="after")
    def validate_manual_payload(self):
        values = (self.amount, self.utr, self.ticket_text)
        supplied = [value is not None for value in values]
        if any(supplied) and not all(supplied):
            raise ValueError("amount, utr and ticket_text must be supplied together")
        if all(supplied) and self.category is None:
            raise ValueError("category is required for manual ingestion")
        if self.utr is not None:
            self.utr = self.utr.strip()
            if len(self.utr) < 4:
                raise ValueError("utr must contain at least 4 non-space characters")
        if self.ticket_text is not None:
            self.ticket_text = self.ticket_text.strip()
            if len(self.ticket_text) < 10:
                raise ValueError("ticket_text must contain at least 10 non-space characters")
        return self

    @property
    def is_manual(self) -> bool:
        return self.amount is not None


class ReviewRequest(BaseModel):
    outcome: ReviewOutcome


def _err(status: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": error, "detail": detail})


# ─── POST /api/disputes/ingest ─────────────────────────────────────
@router.post("/disputes/ingest")
async def ingest_dispute(req: IngestRequest):
    """Run full pipeline synchronously; never 500s (orchestrator fallback)."""
    try:
        manual_dispute = None
        manual_evidence = None
        if req.is_manual:
            now = datetime.now(timezone.utc)
            suffix = uuid.uuid4().hex[:10].upper()
            manual_dispute = Dispute(
                id=str(uuid.uuid4()),
                category=req.category,
                amount=req.amount,
                utr=req.utr,
                txn_timestamp=now,
                customer_id=f"USER_{suffix}",
                merchant_id=f"MANUAL_{suffix}",
                raw_ticket_text=req.ticket_text,
                status=DisputeStatus.ingested,
            )
            # Manual reports do not invent investigation facts. These fields
            # seed the existing evidence tools with only user-supplied data.
            manual_evidence = {
                "customer_id": manual_dispute.customer_id,
                "merchant_id": manual_dispute.merchant_id,
                "utr": manual_dispute.utr,
                "amount": manual_dispute.amount,
                "txn_timestamp": now.isoformat(),
                "source": "manual_user_input",
            }

        result = await run_pipeline(
            category=req.category,
            seed_overturn=req.seed_overturn,
            prepared_dispute=manual_dispute,
            prepared_ground_truth=manual_evidence,
        )
        if isinstance(result, dict) and "dispute" in result and "ledger_after" in result:
            return {"dispute": result["dispute"], "ledger_after": result["ledger_after"]}
        return _err(500, "PipelineError", "orchestrator returned unexpected shape")
    except Exception as e:  # last-resort guard; orchestrator itself never raises
        return _err(500, "IngestFailed", str(e))


# ─── GET /api/disputes (newest first) ──────────────────────────────
@router.get("/disputes")
async def list_disputes():
    try:
        r = await get_redis()
        ids = await r.lrange("dispute_index", 0, -1)  # ingestion order (RPUSH)
        out = []
        for did in reversed(ids):  # newest first
            try:
                raw = await r.get(f"dispute:{did}")
                if not raw:
                    continue
                out.append(json.loads(raw))
            except Exception:
                continue  # skip corrupt entries gracefully
        return {"disputes": out}
    except Exception as e:
        return _err(500, "ListFailed", str(e))


# ─── GET /api/disputes/{id} ────────────────────────────────────────
@router.get("/disputes/{dispute_id}")
async def get_dispute(dispute_id: str):
    try:
        r = await get_redis()
        raw = await r.get(f"dispute:{dispute_id}")
        if not raw:
            return _err(404, "NotFound", f"dispute {dispute_id} not found")
        try:
            return json.loads(raw)  # full merged record, returned unwrapped
        except Exception:
            return _err(500, "CorruptRecord", f"dispute {dispute_id} is corrupt")
    except Exception as e:
        return _err(500, "FetchFailed", str(e))


# ─── GET /api/ledger ───────────────────────────────────────────────
@router.get("/ledger")
async def get_ledger():
    try:
        records = await get_all_ledgers()  # all 5 categories, creates missing fresh
        return {"categories": [rec.model_dump(mode="json") for rec in records]}
    except Exception as e:
        return _err(500, "LedgerFailed", str(e))


# ─── GET /api/escalations ──────────────────────────────────────────
@router.get("/escalations")
async def list_escalations():
    try:
        r = await get_redis()
        ids = await r.lrange("escalation_queue", 0, -1)
        out = []
        for did in ids:
            try:
                raw = await r.get(f"dispute:{did}")
                if not raw:
                    continue
                record = json.loads(raw)
                packet = record.get("escalation_packet")
                if packet:
                    out.append(packet)
            except Exception:
                continue
        return {"escalations": out}
    except Exception as e:
        return _err(500, "EscalationsFailed", str(e))


# ─── POST /api/review/{dispute_id} ─────────────────────────────────
@router.post("/review/{dispute_id}")
async def review_dispute(dispute_id: str, req: ReviewRequest):
    """Apply tier-transition rules exactly per CONTRACT.md.

    - Pure function review_logic.apply_review_transition does the math
      (no Redis/I/O inside); applied via ledger_service.apply_transition
      so the Redis write stays atomic (WATCH/MULTI/EXEC).
    - Stakes disputes (amount > 50000) skip ledger counters entirely.
    - Removes the dispute from escalation_queue (LREM) if present.
    - Marks dispute reviewed with timestamp (rule #3).
    """
    try:
        r = await get_redis()
        raw = await r.get(f"dispute:{dispute_id}")
        if not raw:
            return _err(404, "NotFound", f"dispute {dispute_id} not found")
        try:
            record = json.loads(raw)
        except Exception:
            return _err(500, "CorruptRecord", f"dispute {dispute_id} is corrupt")

        if record.get("status") == "reviewed" or "review_outcome" in record:
            return _err(400, "AlreadyReviewed", f"dispute {dispute_id} already reviewed")

        try:
            category = DisputeCategory(record["category"])
        except Exception:
            try:
                category = DisputeCategory(record["decision"]["category"])
            except Exception:
                return _err(500, "CorruptRecord", "dispute has no valid category")

        amount = float(record.get("amount", 0) or 0)
        decision = record.get("decision") or {}
        esc = record.get("escalation_packet") or {}
        is_stakes = (
            bool(decision.get("stakes_override"))
            or amount > 50_000
            or esc.get("escalation_reason") == "stakes_override"
        )

        outcome = req.outcome

        if is_stakes:
            # Stakes override: NO ledger counter/history update at all.
            ledger_after = await get_or_create_ledger(category)
        else:
            hist_key = f"review_history:{category.value}"
            hist_raw = await r.get(hist_key)
            try:
                recent: list[str] = json.loads(hist_raw) if hist_raw else []
                if not isinstance(recent, list):
                    recent = []
                recent = [str(v) for v in recent][-10:]
            except Exception:
                recent = []

            # Closure adapts the pure (record)->record signature that
            # apply_transition expects; Redis write stays atomic inside.
            def _fn(current):
                return apply_review_transition(category, current, outcome, recent)

            try:
                ledger_after = await apply_transition(category, _fn)
            except Exception as e:
                return _err(500, "LedgerUpdateFailed", str(e))

            try:
                await r.set(hist_key, json.dumps((recent + [outcome.value])[-10:]))
            except Exception:
                pass  # sidecar is best-effort; counters authoritative

        record["status"] = "reviewed"
        record["review_outcome"] = outcome.value
        record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
        await r.set(f"dispute:{dispute_id}", json.dumps(record, default=str))
        try:
            await r.lrem("escalation_queue", 0, dispute_id)
        except Exception:
            pass

        return {"dispute_id": dispute_id, "ledger_after": ledger_after.model_dump(mode="json")}
    except Exception as e:
        return _err(500, "ReviewFailed", str(e))
