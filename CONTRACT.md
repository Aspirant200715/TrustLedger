# TrustLedger Contract

## Tech stack
- Backend: Enter Cloud (managed Postgres + Deno backend function `trustledger-api`, single self-contained router)
- Tables: `trustledger_ledgers` (one row per category) and `trustledger_disputes` (one row per merged record); both RLS-enabled with public read, all writes flow through the backend function using the service role
- Frontend: React + Vite + TypeScript; all API contact via `frontend/src/api.ts` → `supabase.functions.invoke("trustledger-api", { action, ... })`; no local server, no CORS
- LLM: Enter AI capability, model `deepseek/deepseek-v4-flash` (openai_chat_completions protocol, `stream: false`, `response_format: json_object`), called only inside the backend function; token from the managed secret
- The AI call performs investigation + decision in ONE round trip; the LLM proposes `proposed_action`, policy code determines `final_path`

## Enums
DisputeCategory = ["duplicate_charge", "upi_debited_not_credited", "refund_delay", "merchant_settlement_mismatch", "fraud_flag"]
TierLevel = ["suggest_only", "draft_for_approval", "auto_execute"]
DisputeStatus = ["ingested", "investigated", "decided", "executed", "escalated", "reviewed"]
ProposedAction = ["auto_refund", "reverse_duplicate", "mark_resolved_no_action", "escalate"]
EscalationReason = ["tier_capped", "stakes_override", "hard_capped_category"]
ReviewOutcome = ["confirmed_correct", "overturned"]

## Tier transition rules (implement exactly these numbers, do not round or simplify)
- Every new category starts at "suggest_only".
- Promote suggest_only -> draft_for_approval when: total_resolved_in_tier >= 15 AND accuracy_in_tier >= 0.90
- Promote draft_for_approval -> auto_execute when: total_resolved_in_tier >= 30 AND accuracy_in_tier >= 0.97 AND zero overturns in the last 10 cases of that category
- A single overturned_outcome immediately demotes current_tier by exactly one level (auto_execute -> draft_for_approval -> suggest_only). suggest_only cannot demote further.
- "fraud_flag" category is hard-capped: current_tier can never exceed "draft_for_approval" regardless of accuracy. Track this as hard_capped: true on its ledger record.
- Any dispute with amount > 50000 (INR) is treated as stakes_override: it is force-routed to escalate regardless of category tier, and does not count toward that category's accuracy stats either way.
- accuracy_in_tier = correct_outcomes_in_current_tier / total_resolved_in_current_tier (reset the in-tier counters, not the lifetime counters, whenever a promotion or demotion happens — keep lifetime totals separately for the dashboard).

## Pydantic models (exact field names and types)

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

## Storage layout (Enter Cloud Postgres)
- `trustledger_ledgers.category` (pk) -> LedgerRecord fields + `review_history jsonb` (sliding last-10 outcomes, stakes excluded)
- `trustledger_disputes.id` (pk) -> queryable Dispute columns + `record jsonb` (full merged Dispute + InvestigationResult + Decision + ExecutionResult|EscalationPacket) + `ground_truth jsonb` (evidence seed, never exposed)
- Escalation queue is derived: disputes with `status = 'escalated'`; reviewing sets status to `reviewed`

## API contract (backend function `trustledger-api`, exact request/response shapes)
All requests: `{ "action": "...", ... }`; all responses are JSON; errors are `{ "error": str, "detail": str }`.

action "ingest"
  body: { "category": DisputeCategory | null (null = random), "seed_overturn": bool (optional, default false), "amount": float (optional), "utr": str (optional), "ticket_text": str (optional) }
  -> amount + utr + ticket_text must be supplied together with a category for manual ingestion; omitting all three preserves synthetic generation
  -> runs the full pipeline synchronously (investigate + decide -> act/escalate), returns the merged dispute record as JSON
  -> response: { "dispute": <merged dispute object>, "ledger_after": LedgerRecord }

action "disputes"
  -> response: { "disputes": [ <merged dispute summary objects, newest first> ] }
  body with "id" -> response: <full merged dispute record with evidence trail>

action "ledger"
  -> response: { "categories": [ LedgerRecord, ... ] }  (one entry per category, all 5 categories always present even if total_resolved is 0)

action "review"
  body: { "dispute_id": str, "outcome": ReviewOutcome }
  -> applies the tier-transition rules in CONTRACT.md, updates ledger, marks the dispute reviewed (drops it from the escalation queue)
  -> response: { "dispute_id": str, "ledger_after": LedgerRecord }

action "escalations"
  -> response: { "escalations": [ EscalationPacket, ... ] }

action "seed"
  body: { "category": DisputeCategory }
  -> runs a scripted sequence: 15 disputes (marked correct) to trigger promotion to draft_for_approval, 15 more (marked
     correct) to approach auto_execute, then one final overturned dispute to demonstrate a live demotion. No LLM calls.
  -> response: { "events": [ list of {step, tier_after, message} in order, for the frontend to replay/animate ] }

action "health"
  -> response: { "status": "ok", "redis": "available", "llm": "configured" }

All error responses: { "error": str, "detail": str }, appropriate 4xx/5xx status codes. No endpoint should ever
return a raw traceback to the client. AI provider failures return a successful, persisted human escalation
with `llm_fallback: true` and `fallback_reason: "LLM_UNAVAILABLE"` on the merged dispute; no action is executed.

## Non-negotiable engineering rules
1. The Decision Agent NEVER calls the mock ledger API directly. Only the Action Agent has write access to mock
   ledger state. This separation must be visible in the code (different modules/classes).
2. Every LLM call must request structured JSON output matching the expected shape, and the response must be
   validated before use. If validation fails, retry once, then fall back to escalation
   (never crash the pipeline on a malformed LLM response).
3. Every state-changing action (execute a refund, promote/demote a tier) must be logged with a timestamp.
4. The AI call has a hard timeout with graceful escalation fallback: a slow/failed provider routes the dispute to
   human review (`llm_fallback: true`) instead of erroring; the frontend budgets 45s for ingestion.
