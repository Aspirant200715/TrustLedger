"""
decision.py — Decision Agent.

The LLM proposes WHAT action to take.
Policy code (not the LLM) determines HOW autonomous (final_path) the action is.
"""
import json
from datetime import datetime, timezone
from pydantic import BaseModel
from ..models import (
    Dispute, InvestigationResult, Decision,
    DisputeCategory, DisputeStatus, TierLevel, ProposedAction
)
from ..llm_client import get_structured_completion
from ..ledger_service import get_or_create_ledger
from ..redis_client import get_redis


class ActionProposal(BaseModel):
    """Minimal schema sent to the LLM — only asks for proposed_action."""
    proposed_action: ProposedAction
    reasoning: str


async def decide(dispute: Dispute, investigation: InvestigationResult) -> Decision:
    """
    1. Read current ledger tier (read-only — writing happens only in Phase 6 review).
    2. Determine stakes_override purely from policy (amount > 50000).
    3. Call LLM to propose an action (ActionProposal — minimal schema).
    4. Determine final_path from policy code, not the LLM.
    5. Persist Decision to Redis, update dispute status to 'decided'.
    """
    r = await get_redis()

    # ── 1. Read current ledger tier ───────────────────────────────────────────
    ledger = await get_or_create_ledger(dispute.category)
    current_tier = ledger.current_tier

    # ── 2. Policy: stakes_override ────────────────────────────────────────────
    stakes_override = dispute.amount > 50_000

    # ── 3. LLM proposes action ────────────────────────────────────────────────
    system_prompt = """You are a Decision Agent for TrustLedger, a payments dispute resolution system.
Given the investigation result for a dispute, propose the most appropriate action.
Choose EXACTLY one of these string values for proposed_action:
  - "auto_refund"              : customer was wrongly charged or didn't receive credit
  - "reverse_duplicate"        : a duplicate transaction was confirmed
  - "mark_resolved_no_action"  : the transaction was legitimate, no action needed
  - "escalate"                 : fraud confirmed, high complexity, or insufficient evidence

Also provide a short reasoning for your choice.
You propose WHAT to do. The system will independently determine HOW autonomously to execute it."""

    user_prompt = f"""
Dispute:
  ID: {dispute.id}
  Category: {dispute.category.value}
  Amount: {dispute.amount} INR
  Customer: {dispute.customer_id} | Merchant: {dispute.merchant_id}
  Ticket: {dispute.raw_ticket_text}

Investigation Result:
  Root Cause: {investigation.root_cause}
  Reasoning: {investigation.reasoning_summary}
  Evidence:
{chr(10).join(f"    [{e.source}] {e.detail}" for e in investigation.evidence)}
"""

    proposal = await get_structured_completion(system_prompt, user_prompt, ActionProposal)

    # ── 4. Policy determines final_path (code, not LLM) ──────────────────────
    if stakes_override:
        final_path = "escalate"
    elif dispute.category == DisputeCategory.fraud_flag and current_tier == TierLevel.auto_execute:
        # hard_capped: fraud_flag can never be auto_execute
        final_path = TierLevel.draft_for_approval
    else:
        final_path = current_tier

    # Build the canonical Decision object
    decision = Decision(
        dispute_id=dispute.id,
        proposed_action=proposal.proposed_action,
        category=dispute.category,
        ledger_tier_at_decision=current_tier,
        final_path=final_path,
        stakes_override=stakes_override,
    )

    # ── 5. Persist to Redis ───────────────────────────────────────────────────
    raw = await r.get(f"dispute:{dispute.id}")
    record = json.loads(raw) if raw else dispute.model_dump(mode="json")
    record["status"] = DisputeStatus.decided.value
    record["decision"] = decision.model_dump(mode="json")
    record["decided_at"] = datetime.now(timezone.utc).isoformat()
    await r.set(f"dispute:{dispute.id}", json.dumps(record))

    dispute.status = DisputeStatus.decided
    return decision
