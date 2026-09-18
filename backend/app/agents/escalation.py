"""
escalation.py — Escalation Agent.
Builds EscalationPackets, pushes to escalation_queue, marks disputes escalated.
"""
import json
from datetime import datetime, timezone
from ..models import (
    Dispute, InvestigationResult, Decision,
    EscalationPacket, EscalationReason, DisputeStatus, EvidenceItem
)
from ..redis_client import get_redis


async def escalate(
    dispute: Dispute,
    investigation: InvestigationResult,
    decision: Decision,
    reason: EscalationReason,
) -> EscalationPacket:
    """
    Build and persist an EscalationPacket, push the dispute onto escalation_queue,
    and mark the dispute status as 'escalated'.

    reason must be the correct EscalationReason per CONTRACT.md:
    - stakes_override     → amount > 50000
    - hard_capped_category → fraud_flag category blocked from auto_execute
    - tier_capped          → current tier is below auto_execute (draft_for_approval)
    """
    r = await get_redis()

    # Build intent summary from investigation
    intent_summary = (
        f"Dispute {dispute.id} ({dispute.category.value}) escalated. "
        f"Root cause: {investigation.root_cause}. "
        f"Proposed action: {decision.proposed_action.value}. "
        f"Escalation reason: {reason.value}."
    )

    actions_taken: list[str] = [
        f"Investigated: {investigation.reasoning_summary[:120]}...",
        f"Decision proposed: {decision.proposed_action.value} (tier at decision: {decision.ledger_tier_at_decision.value})",
        f"Escalated due to: {reason.value}",
    ]

    packet = EscalationPacket(
        dispute_id=dispute.id,
        intent_summary=intent_summary,
        evidence_trail=investigation.evidence,
        actions_taken=actions_taken,
        escalation_reason=reason,
        created_at=datetime.now(timezone.utc),
    )

    # Persist packet into dispute record
    raw = await r.get(f"dispute:{dispute.id}")
    record = json.loads(raw) if raw else dispute.model_dump(mode="json")
    record["status"] = DisputeStatus.escalated.value
    record["escalation_packet"] = packet.model_dump(mode="json")
    record["escalated_at"] = datetime.now(timezone.utc).isoformat()
    await r.set(f"dispute:{dispute.id}", json.dumps(record))

    # Push onto escalation_queue (Redis LIST)
    await r.lpush("escalation_queue", dispute.id)

    dispute.status = DisputeStatus.escalated
    return packet
