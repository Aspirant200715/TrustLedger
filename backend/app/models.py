from pydantic import BaseModel
from datetime import datetime
from typing import Literal
from enum import Enum

class DisputeCategory(str, Enum):
    duplicate_charge = "duplicate_charge"
    upi_debited_not_credited = "upi_debited_not_credited"
    refund_delay = "refund_delay"
    merchant_settlement_mismatch = "merchant_settlement_mismatch"
    fraud_flag = "fraud_flag"

class TierLevel(str, Enum):
    suggest_only = "suggest_only"
    draft_for_approval = "draft_for_approval"
    auto_execute = "auto_execute"

class DisputeStatus(str, Enum):
    ingested = "ingested"
    investigated = "investigated"
    decided = "decided"
    executed = "executed"
    escalated = "escalated"
    reviewed = "reviewed"

class ProposedAction(str, Enum):
    auto_refund = "auto_refund"
    reverse_duplicate = "reverse_duplicate"
    mark_resolved_no_action = "mark_resolved_no_action"
    escalate = "escalate"

class EscalationReason(str, Enum):
    tier_capped = "tier_capped"
    stakes_override = "stakes_override"
    hard_capped_category = "hard_capped_category"

class ReviewOutcome(str, Enum):
    confirmed_correct = "confirmed_correct"
    overturned = "overturned"

class Dispute(BaseModel):
    id: str  # uuid4
    category: DisputeCategory
    amount: float
    utr: str
    txn_timestamp: datetime
    customer_id: str
    merchant_id: str
    raw_ticket_text: str
    status: DisputeStatus

class EvidenceItem(BaseModel):
    source: str          # e.g. "transaction_log", "ledger_state", "customer_history", "merchant_history"
    detail: str

class InvestigationResult(BaseModel):
    dispute_id: str
    root_cause: str
    evidence: list[EvidenceItem]
    reasoning_summary: str

class Decision(BaseModel):
    dispute_id: str
    proposed_action: ProposedAction
    category: DisputeCategory
    ledger_tier_at_decision: TierLevel
    final_path: TierLevel | Literal["escalate"]
    stakes_override: bool

class ExecutionResult(BaseModel):
    dispute_id: str
    executed: bool
    mock_ledger_balance_before: float
    mock_ledger_balance_after: float
    action_taken: ProposedAction

class EscalationPacket(BaseModel):
    dispute_id: str
    intent_summary: str
    evidence_trail: list[EvidenceItem]
    actions_taken: list[str]
    escalation_reason: EscalationReason
    created_at: datetime

class TierHistoryEntry(BaseModel):
    timestamp: datetime
    from_tier: TierLevel
    to_tier: TierLevel
    reason: str

class LedgerRecord(BaseModel):
    category: DisputeCategory
    current_tier: TierLevel
    hard_capped: bool
    lifetime_total: int
    lifetime_correct: int
    lifetime_overturned: int
    in_tier_total: int
    in_tier_correct: int
    tier_history: list[TierHistoryEntry]
