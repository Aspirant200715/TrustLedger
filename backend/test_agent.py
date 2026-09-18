import asyncio
import json
from app.agents.investigator import investigate
from app.agents.decision import decide
from app.agents.action import execute
from app.agents.escalation import escalate
from app.ledger_service import get_or_create_ledger
from app.synthetic_data import generate_dispute
from app.models import EscalationReason, TierLevel
from app.redis_client import get_redis

async def main():
    dispute_obj, truth = generate_dispute()
    r = await get_redis()
    await r.set(f"dispute:{dispute_obj.id}", dispute_obj.model_dump_json())
    await r.set(f"ground_truth:{dispute_obj.id}", json.dumps(truth))

    print(f"Category: {dispute_obj.category.value}, Amount: {dispute_obj.amount}")

    print("\n[1] Investigating...")
    investigation = await investigate(dispute_obj)
    print(f"  Root cause: {investigation.root_cause[:80]}...")

    print("\n[2] Deciding...")
    decision = await decide(dispute_obj, investigation)
    print(f"  Proposed action: {decision.proposed_action.value}")
    print(f"  Tier at decision: {decision.ledger_tier_at_decision.value}")
    print(f"  Final path: {decision.final_path}")
    print(f"  Stakes override: {decision.stakes_override}")

    print("\n[3] Routing...")
    if decision.final_path == TierLevel.auto_execute:
        result = await execute(dispute_obj, decision)
        print(f"  EXECUTED: balance {result.mock_ledger_balance_before} -> {result.mock_ledger_balance_after}")
    elif decision.final_path == "escalate":
        reason = EscalationReason.stakes_override if decision.stakes_override else EscalationReason.hard_capped_category
        packet = await escalate(dispute_obj, investigation, decision, reason)
        print(f"  ESCALATED: {packet.escalation_reason.value}")
        print(f"  Queue entry: {dispute_obj.id}")
    else:
        packet = await escalate(dispute_obj, investigation, decision, EscalationReason.tier_capped)
        print(f"  TIER-CAPPED ESCALATION: final_path={decision.final_path}")

    # Verify Redis state
    raw = await r.get(f"dispute:{dispute_obj.id}")
    record = json.loads(raw)
    print(f"\n[4] Final dispute status in Redis: {record['status']}")
    
    # Verify ledger read
    ledger = await get_or_create_ledger(dispute_obj.category)
    print(f"[5] Ledger tier for {dispute_obj.category.value}: {ledger.current_tier.value}")

if __name__ == "__main__":
    asyncio.run(main())
