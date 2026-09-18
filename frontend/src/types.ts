// types.ts — TypeScript mirrors of CONTRACT.md's Pydantic models.
//
// Every interface below uses the EXACT field names the backend sends
// (snake_case, as serialized by Pydantic `mode="json"`). Do NOT camelCase.
// Backend datetimes arrive as ISO-8601 strings, hence `string` below.
// Keep in sync with CONTRACT.md ## Pydantic models and ## API contract.

// ─── Enums (string unions matching backend str-Enum values) ──────────────
export type DisputeCategory =
  | "duplicate_charge"
  | "upi_debited_not_credited"
  | "refund_delay"
  | "merchant_settlement_mismatch"
  | "fraud_flag";

export type TierLevel =
  | "suggest_only"
  | "draft_for_approval"
  | "auto_execute";

export type DisputeStatus =
  | "ingested"
  | "investigated"
  | "decided"
  | "executed"
  | "escalated"
  | "reviewed";

export type ProposedAction =
  | "auto_refund"
  | "reverse_duplicate"
  | "mark_resolved_no_action"
  | "escalate";

export type EscalationReason =
  | "tier_capped"
  | "stakes_override"
  | "hard_capped_category";

export type ReviewOutcome = "confirmed_correct" | "overturned";

// "escalate" is a valid final_path alongside the three TierLevels.
export type FinalPath = TierLevel | "escalate";

// ─── CONTRACT.md Pydantic models (exact field names) ─────────────────────
export interface Dispute {
  id: string;
  category: DisputeCategory;
  amount: number;
  utr: string;
  txn_timestamp: string;
  customer_id: string;
  merchant_id: string;
  raw_ticket_text: string;
  status: DisputeStatus;
}

export interface EvidenceItem {
  source: string;
  detail: string;
}

export interface InvestigationResult {
  dispute_id: string;
  root_cause: string;
  evidence: EvidenceItem[];
  reasoning_summary: string;
}

export interface Decision {
  dispute_id: string;
  proposed_action: ProposedAction;
  category: DisputeCategory;
  ledger_tier_at_decision: TierLevel;
  final_path: FinalPath;
  stakes_override: boolean;
}

export interface ExecutionResult {
  dispute_id: string;
  executed: boolean;
  mock_ledger_balance_before: number;
  mock_ledger_balance_after: number;
  action_taken: ProposedAction;
}

export interface EscalationPacket {
  dispute_id: string;
  intent_summary: string;
  evidence_trail: EvidenceItem[];
  actions_taken: string[];
  escalation_reason: EscalationReason;
  created_at: string;
}

export interface TierHistoryEntry {
  timestamp: string;
  from_tier: TierLevel;
  to_tier: TierLevel;
  reason: string;
}

export interface LedgerRecord {
  category: DisputeCategory;
  current_tier: TierLevel;
  hard_capped: boolean;
  lifetime_total: number;
  lifetime_correct: number;
  lifetime_overturned: number;
  in_tier_total: number;
  in_tier_correct: number;
  tier_history: TierHistoryEntry[];
}

// ─── Merged dispute record (what dispute:{id} in Redis actually holds) ────
// The backend stores Dispute base fields plus whichever pipeline artifacts
// exist so far, plus timestamps per engineering rule #3. All extras optional.
export interface MergedDispute extends Dispute {
  investigation_result?: InvestigationResult;
  decision?: Decision;
  execution_result?: ExecutionResult;
  escalation_packet?: EscalationPacket;
  decided_at?: string;
  executed_at?: string;
  escalated_at?: string;
  review_outcome?: ReviewOutcome;
  reviewed_at?: string;
  escalation_fallback?: boolean;
  escalation_reason?: EscalationReason;
}

// ─── API request / response envelopes (CONTRACT.md ## API contract) ───────
export interface IngestRequest {
  category: DisputeCategory | null;
  seed_overturn?: boolean;
}

export interface IngestResponse {
  dispute: MergedDispute;
  ledger_after: LedgerRecord;
}

export interface ListDisputesResponse {
  disputes: MergedDispute[];
}

export interface LedgerResponse {
  categories: LedgerRecord[];
}

export interface ReviewRequest {
  outcome: ReviewOutcome;
}

export interface ReviewResponse {
  dispute_id: string;
  ledger_after: LedgerRecord;
}

export interface EscalationsResponse {
  escalations: EscalationPacket[];
}

export interface SeedRequest {
  category: DisputeCategory;
}

export interface DemoEvent {
  step: number;
  tier_after: TierLevel;
  message: string;
}

export interface SeedResponse {
  events: DemoEvent[];
}

// Backend error envelope: { "error": str, "detail": str } on all 4xx/5xx.
export interface ApiErrorShape {
  error: string;
  detail: string;
}
