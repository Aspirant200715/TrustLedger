"""
action.py — The ONLY module in TrustLedger that is allowed to mutate mock
financial balances (mock_balance:{id} Redis keys). No other module may
write to these keys. (CONTRACT.md Engineering Rule #1)
"""
import json
from datetime import datetime, timezone
from ..models import Dispute, Decision, ExecutionResult, ProposedAction, DisputeStatus, TierLevel, DisputeCategory
from ..redis_client import get_redis

STARTING_BALANCE = 100_000.0  # Default seed balance when first touched


async def _get_or_seed_balance(r, holder_id: str) -> float:
    key = f"mock_balance:{holder_id}"
    raw = await r.get(key)
    if raw is None:
        await r.set(key, str(STARTING_BALANCE))
        return STARTING_BALANCE
    return float(raw)


async def execute(dispute: Dispute, decision: Decision) -> ExecutionResult:
    """
    Execute the proposed action from the Decision Agent.
    Only called when decision.final_path == TierLevel.auto_execute.

    Re-validates policy bounds BEFORE any balance mutation (safety check per CONTRACT.md):
    - amount must be <= 50000 (stakes_override would have routed to escalate)
    - category must not be fraud_flag at auto_execute (hard_capped rule)
    """
    r = await get_redis()

    # ── Safety re-validation (CONTRACT.md rule: action agent re-checks bounds) ──
    if dispute.amount > 50_000:
        raise ValueError("Action Agent: re-validation failed — amount > 50000 should have been escalated")
    if dispute.category == DisputeCategory.fraud_flag and decision.final_path == TierLevel.auto_execute:
        raise ValueError("Action Agent: re-validation failed — fraud_flag is hard-capped, cannot auto_execute")

    # ── Fetch balances before mutation ───────────────────────────────────────
    customer_balance_before = await _get_or_seed_balance(r, dispute.customer_id)
    merchant_balance_before = await _get_or_seed_balance(r, dispute.merchant_id)

    action = decision.proposed_action
    amount = dispute.amount

    # ── Apply the action ─────────────────────────────────────────────────────
    if action == ProposedAction.auto_refund:
        # Credit customer, debit merchant
        new_customer = customer_balance_before + amount
        new_merchant = max(0.0, merchant_balance_before - amount)
        await r.set(f"mock_balance:{dispute.customer_id}", str(new_customer))
        await r.set(f"mock_balance:{dispute.merchant_id}", str(new_merchant))
        balance_after = new_customer  # Report from customer's perspective

    elif action == ProposedAction.reverse_duplicate:
        # Return duplicate charge to customer, debit merchant
        new_customer = customer_balance_before + amount
        new_merchant = max(0.0, merchant_balance_before - amount)
        await r.set(f"mock_balance:{dispute.customer_id}", str(new_customer))
        await r.set(f"mock_balance:{dispute.merchant_id}", str(new_merchant))
        balance_after = new_customer

    elif action == ProposedAction.mark_resolved_no_action:
        # No balance change
        balance_after = customer_balance_before

    else:
        # escalate should never reach here; guard anyway
        balance_after = customer_balance_before

    balance_before = customer_balance_before

    result = ExecutionResult(
        dispute_id=dispute.id,
        executed=True,
        mock_ledger_balance_before=balance_before,
        mock_ledger_balance_after=balance_after,
        action_taken=action,
    )

    # ── Persist to Redis ──────────────────────────────────────────────────────
    raw = await r.get(f"dispute:{dispute.id}")
    record = json.loads(raw) if raw else dispute.model_dump(mode="json")
    record["status"] = DisputeStatus.executed.value
    record["execution_result"] = result.model_dump(mode="json")
    record["executed_at"] = datetime.now(timezone.utc).isoformat()  # CONTRACT.md rule #3
    await r.set(f"dispute:{dispute.id}", json.dumps(record))

    dispute.status = DisputeStatus.executed
    return result
