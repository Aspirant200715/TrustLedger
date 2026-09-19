"""
orchestrator.py — TrustLedger pipeline orchestrator.

Order: generate -> persist+index -> investigate -> decide -> act/escalate
       -> optional seed_overturn review -> return ingest-shaped response.

Rules enforced:
- Decision NEVER touches balances. Only Action.execute() writes
  mock_balance:{id} keys (see agents/action.py).
- Tier writes go through ledger_service.apply_transition (atomic) with the
  pure review_logic.apply_review_transition function — orchestrator never
  mutates ledger:{category} directly.
- stakes_override (amount > 50000) never counts toward ledger stats.
- All state changes carry timestamps (agents set decided_at/executed_at/
  escalated_at; we add reviewed_at here).
- NEVER raises to the caller: global try/except forces graceful escalation
  fallback so the frontend never sees a 500 or raw traceback.
"""
import asyncio
import json
import traceback
from datetime import datetime, timezone

from .models import (
    Dispute,
    DisputeCategory,
    DisputeStatus,
    TierLevel,
    ProposedAction,
    EscalationReason,
    ReviewOutcome,
    Decision,
    EvidenceItem,
    InvestigationResult,
)
from .llm_client import LLMUnavailableError
from .synthetic_data import generate_dispute
from .agents.investigator import investigate
from .agents.decision import decide
from .agents.action import execute
from .agents.escalation import escalate
from .ledger_service import get_or_create_ledger, apply_transition
from .review_logic import apply_review_transition
from .redis_client import get_redis


def _resolve_escalation_reason(decision: Decision) -> EscalationReason:
    """Closest EscalationReason per CONTRACT.md for a non-auto decision."""
    if decision.stakes_override:
        return EscalationReason.stakes_override
    if decision.category == DisputeCategory.fraud_flag:
        return EscalationReason.hard_capped_category
    return EscalationReason.tier_capped


async def _apply_overturned_review(dispute_category: DisputeCategory) -> None:
    """Apply one overturned outcome via atomic transition + history sidecar.

    Caller must have already excluded stakes_override disputes.
    Updates review_history:{category} sidecar alongside (best-effort;
    ledger counters via apply_transition are authoritative).
    """
    r = await get_redis()
    hist_key = f"review_history:{dispute_category.value}"
    hist_raw = await r.get(hist_key)
    try:
        recent: list[str] = json.loads(hist_raw) if hist_raw else []
        if not isinstance(recent, list):
            recent = []
        recent = [str(v) for v in recent][-10:]
    except Exception:
        recent = []

    def _fn(current):  # pure (LedgerRecord -> LedgerRecord), no I/O
        return apply_review_transition(
            dispute_category, current, ReviewOutcome.overturned, recent
        )

    await apply_transition(dispute_category, _fn)

    try:
        await r.set(hist_key, json.dumps((recent + [ReviewOutcome.overturned.value])[-10:]))
    except Exception:
        pass  # history sidecar must not fail the pipeline


async def run_pipeline(
    category: DisputeCategory | None,
    seed_overturn: bool = False,
    prepared_dispute: Dispute | None = None,
    prepared_ground_truth: dict | None = None,
) -> dict:
    """Run the full dispute pipeline synchronously. NEVER raises.

    Returns {"dispute": <merged record dict>, "ledger_after": <LedgerRecord dict>}
    matching POST /api/disputes/ingest in CONTRACT.md exactly.
    """
    dispute: Dispute | None = None
    requested_category = category

    try:
        # ── 1. Accept a user-entered dispute or generate a synthetic one ─────
        if prepared_dispute is not None:
            dispute = prepared_dispute
            ground_truth = prepared_ground_truth or {}
        else:
            dispute, ground_truth = generate_dispute(requested_category, seed_overturn)

        # ── 2. Persist + index ────────────────────────────────────────
        r = await get_redis()
        await r.set(f"dispute:{dispute.id}", dispute.model_dump_json())
        await r.set(f"ground_truth:{dispute.id}", json.dumps(ground_truth, default=str))
        # RPUSH preserves ingestion order (oldest -> newest);
        # GET /api/disputes reverses for newest-first.
        await r.rpush("dispute_index", dispute.id)

        # ── 3. Investigate + Decide within the ingest latency budget ─────────
        try:
            async with asyncio.timeout(4.8):
                investigation = await investigate(dispute)
                decision = await decide(dispute, investigation)
        except TimeoutError as exc:
            raise LLMUnavailableError("AI workflow exceeded its time budget") from exc

        # ── 4. Route: act OR escalate ─────────────────────────────────
        if decision.final_path == TierLevel.auto_execute:
            try:
                await execute(dispute, decision)
            except ValueError:
                # Safety re-validation failed (amount > 50000 or fraud_flag
                # at auto_execute): fall back to escalation.
                traceback.print_exc()
                await escalate(
                    dispute, investigation, decision, EscalationReason.stakes_override
                )
        elif decision.final_path == "escalate":
            reason = _resolve_escalation_reason(decision)
            await escalate(dispute, investigation, decision, reason)
        else:
            # suggest_only / draft_for_approval -> human review
            reason = _resolve_escalation_reason(decision)
            await escalate(dispute, investigation, decision, reason)

        # ── 5. Optional seed_overturn review (same call, demo flow) ───
        # Used only by the demo seeding flow: immediately marks this dispute
        # overturned so promotion/demotion can be demonstrated in one call.
        # Stakes disputes are excluded from stats per CONTRACT.md.
        if seed_overturn and not decision.stakes_override:
            await _apply_overturned_review(dispute.category)

        if seed_overturn:
            raw = await r.get(f"dispute:{dispute.id}")
            record = json.loads(raw) if raw else dispute.model_dump(mode="json")
            record["status"] = DisputeStatus.reviewed.value
            record["review_outcome"] = ReviewOutcome.overturned.value
            record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
            await r.set(f"dispute:{dispute.id}", json.dumps(record, default=str))
            try:
                await r.lrem("escalation_queue", 0, dispute.id)
            except Exception:
                pass
            dispute.status = DisputeStatus.reviewed

        # ── 6. Return ingest-shaped response ──────────────────────────
        raw_final = await r.get(f"dispute:{dispute.id}")
        merged = json.loads(raw_final)
        ledger_after = await get_or_create_ledger(dispute.category)
        return {
            "dispute": merged,
            "ledger_after": ledger_after.model_dump(mode="json"),
        }

    except Exception as exc:
        # ── 7. Global failure fallback: NEVER raise ───────────────────
        # Provider errors receive a complete, reviewable escalation packet and
        # explicit metadata so the UI can warn without treating the response as
        # a failed request.
        print(f"[orchestrator] pipeline failed: {type(exc).__name__}")
        try:
            r = await get_redis()
            if isinstance(exc, LLMUnavailableError) and dispute is not None:
                ledger = await get_or_create_ledger(dispute.category)
                investigation = InvestigationResult(
                    dispute_id=dispute.id,
                    root_cause="Automated investigation unavailable",
                    reasoning_summary=(
                        "The AI provider could not complete the governed workflow; "
                        "the dispute was routed to human review without execution."
                    ),
                    evidence=[
                        EvidenceItem(source="transaction_log", detail=f"UTR {dispute.utr}"),
                        EvidenceItem(source="ledger_state", detail=f"Reported amount INR {dispute.amount:.2f}"),
                    ],
                )
                decision = Decision(
                    dispute_id=dispute.id,
                    proposed_action=ProposedAction.escalate,
                    category=dispute.category,
                    ledger_tier_at_decision=ledger.current_tier,
                    final_path="escalate",
                    stakes_override=dispute.amount > 50_000,
                )
                reason = _resolve_escalation_reason(decision)
                packet = await escalate(dispute, investigation, decision, reason)
                raw = await r.get(f"dispute:{dispute.id}")
                record = json.loads(raw) if raw else dispute.model_dump(mode="json")
                record["investigation_result"] = investigation.model_dump(mode="json")
                record["decision"] = decision.model_dump(mode="json")
                record["escalation_packet"] = packet.model_dump(mode="json")
                record["llm_fallback"] = True
                record["fallback_reason"] = LLMUnavailableError.code
                await r.set(f"dispute:{dispute.id}", json.dumps(record, default=str))
                return {
                    "dispute": record,
                    "ledger_after": ledger.model_dump(mode="json"),
                }

            traceback.print_exc()

            if dispute is None:
                fallback_cat = requested_category or DisputeCategory.duplicate_charge
                dispute = Dispute(
                    id="fallback-" + datetime.now(timezone.utc).isoformat(),
                    category=fallback_cat,
                    amount=0.0,
                    utr="0",
                    txn_timestamp=datetime.now(timezone.utc),
                    customer_id="unknown",
                    merchant_id="unknown",
                    raw_ticket_text="orchestrator fallback after generation failure",
                    status=DisputeStatus.ingested,
                )
                await r.set(f"dispute:{dispute.id}", dispute.model_dump_json())
                await r.rpush("dispute_index", dispute.id)

            try:
                raw = await r.get(f"dispute:{dispute.id}")
                rec = json.loads(raw) if raw else dispute.model_dump(mode="json")
            except Exception:
                rec = dispute.model_dump(mode="json")

            stakes = False
            try:
                stakes = float(rec.get("amount", 0) or 0) > 50_000
                if isinstance(rec.get("decision"), dict):
                    stakes = stakes or bool(rec["decision"].get("stakes_override", False))
            except Exception:
                pass

            if stakes:
                reason = EscalationReason.stakes_override
            elif rec.get("category") == DisputeCategory.fraud_flag.value:
                reason = EscalationReason.hard_capped_category
            else:
                reason = EscalationReason.tier_capped

            if rec.get("status") not in (
                DisputeStatus.escalated.value,
                DisputeStatus.executed.value,
                DisputeStatus.reviewed.value,
            ):
                rec["status"] = DisputeStatus.escalated.value
                rec["escalated_at"] = datetime.now(timezone.utc).isoformat()
                rec["escalation_fallback"] = True
                rec["escalation_reason"] = reason.value
                if "decision" not in rec:
                    synth = Decision(
                        dispute_id=dispute.id,
                        proposed_action=ProposedAction.escalate,
                        category=dispute.category,
                        ledger_tier_at_decision=TierLevel.suggest_only,
                        final_path="escalate",
                        stakes_override=stakes,
                    )
                    rec["decision"] = synth.model_dump(mode="json")
                await r.set(f"dispute:{dispute.id}", json.dumps(rec, default=str))
                try:
                    await r.lpush("escalation_queue", dispute.id)
                except Exception:
                    pass

            ledger_after = await get_or_create_ledger(dispute.category)
            raw_final = await r.get(f"dispute:{dispute.id}")
            merged = json.loads(raw_final) if raw_final else rec
            return {
                "dispute": json.loads(json.dumps(merged, default=str)),
                "ledger_after": ledger_after.model_dump(mode="json"),
            }
        except Exception:
            traceback.print_exc()
            cat = requested_category or DisputeCategory.duplicate_charge
            try:
                ledger_after = await get_or_create_ledger(cat)
                ledger_json = ledger_after.model_dump(mode="json")
            except Exception:
                ledger_json = {"category": cat.value, "current_tier": "suggest_only"}
            did = dispute.id if dispute is not None else "fallback-error"
            return {
                "dispute": {
                    "id": did,
                    "category": cat.value,
                    "status": DisputeStatus.escalated.value,
                    "escalation_fallback": True,
                },
                "ledger_after": ledger_json,
            }
