// TrustLedger backend function — single self-contained router (the deploy
// bundler ships one file per function, so shared modules are inlined here).
//
// Routes (by body.action):
//   health      -> { status, redis, llm }
//   ledger      -> { categories: LedgerRecord[] }          (all 5, creates fresh)
//   disputes    -> { disputes: MergedDispute[] }            newest first
//   disputes + id -> MergedDispute                          single record
//   review      -> { dispute_id, ledger_after }             (outcome transition)
//   escalations -> { escalations: EscalationPacket[] }      status = 'escalated'
//   ingest      -> { dispute, ledger_after }                full AI pipeline
//   seed        -> { events: [{step, tier_after, message}]} 31-step demo
//
// Governed-autonomy rules (CONTRACT.md) are enforced in code below:
//   suggest->draft at >=15 & >=90%; draft->auto at >=30 & >=97% & zero
//   overturns in last 10; single overturn demotes one level; fraud_flag
//   hard-capped at draft; stakes (>50000) always escalate, never count.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const STAKE_THRESHOLD = 50000;
const CATEGORIES = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];
const AI_BASE = "https://api.enter.pro/code/api/v1/ai/chat/completions";
const AI_MODEL = "deepseek/deepseek-v4-flash";
const PROJECT_ID = "11a386b24a3478c7cdd6df2fa5820b9d";
const SECRET_KEY = "AI_API_TOKEN_11a386b24a34";
const AI_TIMEOUT_MS = 30000;
const VALID_SOURCES = new Set([
  "transaction_log",
  "ledger_state",
  "customer_history",
  "merchant_history",
]);
const VALID_ACTIONS = [
  "auto_refund",
  "reverse_duplicate",
  "mark_resolved_no_action",
  "escalate",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// ─────────────────────────────────────────────────────────────────────────────
// Pure tier-transition logic (port of review_logic.py)
// ─────────────────────────────────────────────────────────────────────────────
function freshLedger(category) {
  return {
    category,
    current_tier: "suggest_only",
    hard_capped: category === "fraud_flag",
    lifetime_total: 0,
    lifetime_correct: 0,
    lifetime_overturned: 0,
    in_tier_total: 0,
    in_tier_correct: 0,
    tier_history: [],
  };
}

function applyReviewTransition(category, record, outcome, recentHistory = []) {
  const updated = structuredClone(record);
  if (category === "fraud_flag") updated.hard_capped = true;
  const isCapped = Boolean(updated.hard_capped || category === "fraud_flag");
  const window = [...(recentHistory ?? []), outcome].slice(-10);
  const now = new Date().toISOString();

  if (outcome === "confirmed_correct") {
    updated.lifetime_total += 1;
    updated.lifetime_correct += 1;
    updated.in_tier_total += 1;
    updated.in_tier_correct += 1;
    const acc = updated.in_tier_total ? updated.in_tier_correct / updated.in_tier_total : 0;

    if (
      updated.current_tier === "suggest_only" &&
      updated.in_tier_total >= 15 &&
      acc >= 0.9
    ) {
      const old = updated.current_tier;
      updated.current_tier = "draft_for_approval";
      updated.in_tier_total = 0;
      updated.in_tier_correct = 0;
      updated.tier_history.push({
        timestamp: now,
        from_tier: old,
        to_tier: "draft_for_approval",
        reason: "Promoted: >=15 resolved, >=90% accuracy in suggest_only",
      });
    } else if (
      updated.current_tier === "draft_for_approval" &&
      updated.in_tier_total >= 30 &&
      acc >= 0.97 &&
      !isCapped
    ) {
      const zeroOverturns = window.every((v) => v !== "overturned");
      if (zeroOverturns) {
        const old = updated.current_tier;
        updated.current_tier = "auto_execute";
        updated.in_tier_total = 0;
        updated.in_tier_correct = 0;
        updated.tier_history.push({
          timestamp: now,
          from_tier: old,
          to_tier: "auto_execute",
          reason: "Promoted: >=30 resolved, >=97% accuracy, zero overturns in last 10",
        });
      }
    }
  } else {
    updated.lifetime_total += 1;
    updated.lifetime_overturned += 1;
    updated.in_tier_total += 1;

    const old = updated.current_tier;
    const newTier = old === "auto_execute" ? "draft_for_approval" : "suggest_only";
    if (newTier !== old) {
      updated.current_tier = newTier;
      updated.in_tier_total = 0;
      updated.in_tier_correct = 0;
      updated.tier_history.push({
        timestamp: now,
        from_tier: old,
        to_tier: newTier,
        reason: "Demoted: single overturned outcome (-1 level)",
      });
    }
  }

  if (isCapped && updated.current_tier === "auto_execute") {
    updated.current_tier = "draft_for_approval";
  }
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger row persistence
// ─────────────────────────────────────────────────────────────────────────────
function rowToLedger(row) {
  return {
    category: row.category,
    current_tier: row.current_tier,
    hard_capped: row.hard_capped,
    lifetime_total: row.lifetime_total,
    lifetime_correct: row.lifetime_correct,
    lifetime_overturned: row.lifetime_overturned,
    in_tier_total: row.in_tier_total,
    in_tier_correct: row.in_tier_correct,
    tier_history: row.tier_history ?? [],
  };
}

async function getLedgerRow(category) {
  const { data } = await admin
    .from("trustledger_ledgers")
    .select("*")
    .eq("category", category)
    .maybeSingle();
  return data ?? null;
}

async function ensureLedgerRow(category) {
  const existing = await getLedgerRow(category);
  if (existing) return existing;
  const fresh = freshLedger(category);
  const { data, error } = await admin
    .from("trustledger_ledgers")
    .insert({ ...fresh, review_history: [] })
    .select()
    .maybeSingle();
  if (error || !data) {
    const reread = await getLedgerRow(category);
    if (reread) return reread;
    throw new Error(`ledger upsert failed for ${category}: ${error?.message}`);
  }
  return data;
}

async function setLedgerRow(category, ledger, reviewHistory) {
  await admin
    .from("trustledger_ledgers")
    .update({
      current_tier: ledger.current_tier,
      hard_capped: ledger.hard_capped,
      lifetime_total: ledger.lifetime_total,
      lifetime_correct: ledger.lifetime_correct,
      lifetime_overturned: ledger.lifetime_overturned,
      in_tier_total: ledger.in_tier_total,
      in_tier_correct: ledger.in_tier_correct,
      tier_history: ledger.tier_history,
      review_history: reviewHistory,
      updated_at: new Date().toISOString(),
    })
    .eq("category", category);
}

async function applyReviewOutcome(category, outcome) {
  const row = await ensureLedgerRow(category);
  const updated = applyReviewTransition(category, rowToLedger(row), outcome, row.review_history ?? []);
  const nextHistory = [...(row.review_history ?? []), outcome].slice(-10);
  await setLedgerRow(category, updated, nextHistory);
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic dispute generator (port of synthetic_data.py)
// ─────────────────────────────────────────────────────────────────────────────
function generateDispute(category, seedOverturn = false) {
  const cat = category ?? CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const utr = String(Math.floor(Math.random() * 9e11) + 1e11);
  const amount = Math.random() < 0.05
    ? Math.round((50001 + Math.random() * 49999) * 100) / 100
    : Math.round((50 + Math.random() * 4950) * 100) / 100;

  const now = Date.now();
  const txnTimestamp = new Date(
    now -
      (1 + Math.floor(Math.random() * 30)) * 86400000 -
      Math.floor(Math.random() * 24) * 3600000 -
      Math.floor(Math.random() * 60) * 60000,
  ).toISOString();

  const customerId = `CUST_${10000 + Math.floor(Math.random() * 90000)}`;
  const merchantId = `MER_${10000 + Math.floor(Math.random() * 90000)}`;

  const groundTruth = {
    customer_id: customerId,
    merchant_id: merchantId,
    utr,
    amount,
    txn_timestamp: txnTimestamp,
    is_fraud: false,
    seed_overturn_applied: seedOverturn,
  };

  let rawTicketText = "Unknown issue.";
  if (cat === "duplicate_charge") {
    if (seedOverturn) {
      rawTicketText = `I was charged twice for the amount ${amount} at this merchant! UTR: ${utr}.`;
      groundTruth.merchant_settled_credits = 1;
      groundTruth.duplicate_found = false;
    } else {
      rawTicketText = `My account was debited twice for the same transaction of ${amount}. Please reverse one. Ref: ${utr}.`;
      groundTruth.merchant_settled_credits = 2;
      groundTruth.duplicate_found = true;
    }
  } else if (cat === "upi_debited_not_credited") {
    if (seedOverturn) {
      rawTicketText = `Amount ${amount} was debited from my account but the merchant says they never received it, UTR attached: ${utr}.`;
      groundTruth.merchant_received_credit = true;
    } else {
      rawTicketText = `Money ${amount} debited but merchant didn't get it. UTR ${utr}.`;
      groundTruth.merchant_received_credit = false;
    }
  } else if (cat === "refund_delay") {
    if (seedOverturn) {
      rawTicketText = `I cancelled my order and the merchant promised a refund of ${amount}, but it's been a week and nothing! UTR: ${utr}.`;
      groundTruth.refund_processed = true;
    } else {
      rawTicketText = `Still waiting for my ${amount} refund from order cancellation. UTR ${utr}.`;
      groundTruth.refund_processed = false;
    }
  } else if (cat === "merchant_settlement_mismatch") {
    if (seedOverturn) {
      rawTicketText = `Merchant here, I received a settlement of ${amount - 50} instead of ${amount} for UTR ${utr}.`;
      groundTruth.settlement_amount_disbursed = amount;
    } else {
      const shortfall = 10 + Math.floor(Math.random() * 41);
      rawTicketText = `My settlement for UTR ${utr} is short. I got ${amount - shortfall} instead of ${amount}.`;
      groundTruth.settlement_amount_disbursed = amount - shortfall;
    }
  } else if (cat === "fraud_flag") {
    if (seedOverturn) {
      rawTicketText = `I didn't authorize this transaction of ${amount} to this merchant! UTR ${utr}.`;
      groundTruth.customer_login_ip_match = true;
      groundTruth["3ds_verified"] = true;
    } else {
      rawTicketText = `Fraud! Somebody used my account to pay ${amount} for UTR ${utr}.`;
      groundTruth.customer_login_ip_match = false;
      groundTruth["3ds_verified"] = false;
      groundTruth.is_fraud = true;
    }
  }

  return {
    dispute: {
      id: crypto.randomUUID(),
      category: cat,
      amount,
      utr,
      txn_timestamp: txnTimestamp,
      customer_id: customerId,
      merchant_id: merchantId,
      raw_ticket_text: rawTicketText,
      status: "ingested",
    },
    groundTruth,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enter AI structured completion (openai_chat_completions protocol)
// ─────────────────────────────────────────────────────────────────────────────
class LLMUnavailableError extends Error {
  static code = "LLM_UNAVAILABLE";
  constructor(message = "AI provider is unavailable") {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

async function chatCompletion(system, user) {
  const token = Deno.env.get(SECRET_KEY);
  if (!token) throw new LLMUnavailableError("AI provider is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(AI_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Session-ID": crypto.randomUUID(),
        "X-Enter-Project-ID": PROJECT_ID,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[ai] non-ok ${res.status}: ${text.slice(0, 500)}`);
      let message = `AI service error (${res.status})`;
      const m = text.match(/data: (.+)/);
      if (m) {
        try {
          const parsed = JSON.parse(m[1]);
          message = parsed?.error?.message ?? message;
        } catch {
          // use defaults
        }
      }
      if (!text && res.status === 401) {
        throw new LLMUnavailableError("AI provider is not configured");
      }
      throw new LLMUnavailableError(message);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (typeof content !== "string" || !content.trim()) {
      console.error(`[ai] empty content: ${JSON.stringify(data).slice(0, 500)}`);
      throw new LLMUnavailableError("AI provider returned empty output");
    }
    return content;
  } catch (err) {
    if (err instanceof LLMUnavailableError) {
      if (err.message === "AI provider is not configured") {
        console.error("[ai] token secret is missing from function environment");
      }
      throw err;
    }
    console.error(`[ai] fetch error: ${err?.message ?? err}`);
    throw new LLMUnavailableError(`AI provider unavailable: ${err?.message ?? "unknown error"}`);
  } finally {
    clearTimeout(timer);
  }
}

function stripFences(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    const firstLineEnd = t.indexOf("\n");
    if (firstLineEnd !== -1) t = t.slice(firstLineEnd + 1);
    t = t.replace(/```\s*$/, "").trim();
  }
  // Some models wrap JSON in prose; jump to the first { and cut at the last }.
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return t.slice(firstBrace, lastBrace + 1);
  }
  return t;
}

async function llmJson(system, user, validator) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = attempt
      ? "\n\nReturn valid JSON only, matching the requested shape exactly. No prose."
      : "";
    const content = await chatCompletion(system, user + retryNote);
    try {
      const obj = JSON.parse(stripFences(content));
      if (obj && typeof obj === "object") {
        if (!validator) return obj;
        const problem = validator(obj);
        if (problem === null) return obj;
        lastError = new Error(problem);
      } else {
        lastError = new Error("response was not a JSON object");
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw new LLMUnavailableError("AI provider returned invalid structured data");
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence tools (port of tools/ledger_tools.py)
// ─────────────────────────────────────────────────────────────────────────────
function transactionLog(gt) {
  return {
    txn_timestamp: gt?.txn_timestamp ?? null,
    utr: gt?.utr ?? null,
    amount: gt?.amount ?? null,
    duplicate_found: gt?.duplicate_found ?? null,
  };
}

function ledgerState(gt) {
  return {
    merchant_settled_credits: gt?.merchant_settled_credits ?? null,
    merchant_received_credit: gt?.merchant_received_credit ?? null,
    refund_processed: gt?.refund_processed ?? null,
    settlement_amount_disbursed: gt?.settlement_amount_disbursed ?? null,
  };
}

function customerMerchantHistory(gt) {
  return {
    customer_id: gt?.customer_id ?? null,
    merchant_id: gt?.merchant_id ?? null,
    customer_login_ip_match: gt?.customer_login_ip_match ?? null,
    "3ds_verified": gt?.["3ds_verified"] ?? null,
    is_fraud: gt?.is_fraud ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Investigation + Decision in a single AI call (one round trip, lower latency)
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeDispute(dispute, groundTruth) {
  const system = [
    "You are the TrustLedger resolution agent for a payments dispute system.",
    "Investigate the dispute using the provided evidence and determine the root cause.",
    "Then propose the single most appropriate action.",
    'Return a JSON object with keys:',
    '  "root_cause" (string), "reasoning_summary" (string),',
    '  "evidence" (array of { "source", "detail" }),',
    '  "proposed_action" (exactly one of: "auto_refund", "reverse_duplicate",',
    '    "mark_resolved_no_action", "escalate"), and "reasoning" (short string).',
    'Each evidence item source MUST be exactly one of: "transaction_log", "ledger_state",',
    '"customer_history", "merchant_history".',
    "Cite the specific tool output data that supports your finding.",
    "You propose WHAT to do. The system independently determines HOW autonomously to execute it.",
  ].join("\n");

  const user = [
    "Dispute Information:",
    JSON.stringify(dispute, null, 2),
    "",
    "Evidence Gathered:",
    "---",
    "Source: transaction_log",
    JSON.stringify(transactionLog(groundTruth), null, 2),
    "---",
    "Source: ledger_state",
    JSON.stringify(ledgerState(groundTruth), null, 2),
    "---",
    "Source: customer_history (and merchant_history)",
    JSON.stringify(customerMerchantHistory(groundTruth), null, 2),
    "---",
    "",
    "Return JSON only.",
  ].join("\n");

  const raw = await llmJson(system, user, (o) => {
    if (!VALID_ACTIONS.includes(o.proposed_action)) return "proposed_action is invalid";
    if (!Array.isArray(o.evidence)) return "evidence must be an array";
    return null;
  });

  const evidence = raw.evidence
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const source =
        typeof e.source === "string" && VALID_SOURCES.has(e.source)
          ? e.source
          : "transaction_log";
      return { source, detail: String(e.detail ?? "") };
    });

  return {
    investigation: {
      dispute_id: dispute.id,
      root_cause: String(raw.root_cause ?? "Unknown"),
      reasoning_summary: String(raw.reasoning_summary ?? ""),
      evidence,
    },
    proposed_action: raw.proposed_action,
  };
}

function resolveEscalationReason(decision) {
  if (decision.stakes_override) return "stakes_override";
  if (decision.category === "fraud_flag") return "hard_capped_category";
  return "tier_capped";
}

function buildPacket(dispute, investigation, decision, reason) {
  return {
    dispute_id: dispute.id,
    intent_summary: [
      `Dispute ${dispute.id} (${dispute.category}) escalated. Root cause: ${investigation.root_cause}.`,
      `Proposed action: ${decision.proposed_action}.`,
      `Escalation reason: ${reason}.`,
    ].join(" "),
    evidence_trail: investigation.evidence,
    actions_taken: [
      `Investigated: ${investigation.reasoning_summary.slice(0, 120)}...`,
      `Decision proposed: ${decision.proposed_action} (tier at decision: ${decision.ledger_tier_at_decision})`,
      `Escalated due to: ${reason}`,
    ],
    escalation_reason: reason,
    created_at: new Date().toISOString(),
  };
}

function execute(dispute, decision) {
  if (dispute.amount > STAKE_THRESHOLD) {
    throw new Error("amount > 50000 should have been escalated");
  }
  if (dispute.category === "fraud_flag" && decision.final_path === "auto_execute") {
    throw new Error("fraud_flag is hard-capped, cannot auto_execute");
  }
  const before = 100000;
  let after = before;
  if (
    decision.proposed_action === "auto_refund" ||
    decision.proposed_action === "reverse_duplicate"
  ) {
    after = before + dispute.amount;
  }
  return {
    dispute_id: dispute.id,
    executed: true,
    mock_ledger_balance_before: before,
    mock_ledger_balance_after: after,
    action_taken: decision.proposed_action,
  };
}

async function insertDispute(dispute, groundTruth) {
  await admin.from("trustledger_disputes").insert({
    id: dispute.id,
    category: dispute.category,
    amount: dispute.amount,
    utr: dispute.utr,
    txn_timestamp: dispute.txn_timestamp,
    customer_id: dispute.customer_id,
    merchant_id: dispute.merchant_id,
    raw_ticket_text: dispute.raw_ticket_text,
    status: dispute.status,
    ground_truth: groundTruth,
    record: dispute,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingest pipeline (never raises; graceful escalation fallback)
// ─────────────────────────────────────────────────────────────────────────────
async function runIngest(body) {
  let dispute = null;
  let seedOverturn = Boolean(body?.seed_overturn);

  try {
    const { amount, utr, ticket_text, category } = body ?? {};
    const supplied = [amount, utr, ticket_text].filter((v) => v != null);
    let groundTruth;

    if (supplied.length > 0 && supplied.length < 3) {
      return { status: 400, body: { error: "InvalidRequest", detail: "amount, utr and ticket_text must be supplied together" } };
    }
    if (supplied.length === 3) {
      if (typeof category !== "string") {
        return { status: 400, body: { error: "InvalidRequest", detail: "category is required for manual ingestion" } };
      }
      const utrStr = String(utr).trim();
      const text = String(ticket_text).trim();
      if (utrStr.length < 4) {
        return { status: 400, body: { error: "InvalidRequest", detail: "utr must contain at least 4 non-space characters" } };
      }
      if (text.length < 10) {
        return { status: 400, body: { error: "InvalidRequest", detail: "ticket_text must contain at least 10 non-space characters" } };
      }
      const now = new Date();
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
      dispute = {
        id: crypto.randomUUID(),
        category,
        amount: Number(amount),
        utr: utrStr,
        txn_timestamp: now.toISOString(),
        customer_id: `USER_${suffix}`,
        merchant_id: `MANUAL_${suffix}`,
        raw_ticket_text: text,
        status: "ingested",
      };
      groundTruth = {
        customer_id: dispute.customer_id,
        merchant_id: dispute.merchant_id,
        utr: dispute.utr,
        amount: dispute.amount,
        txn_timestamp: now.toISOString(),
        source: "manual_user_input",
      };
    } else {
      const gen = generateDispute(
        typeof category === "string" ? category : null,
        seedOverturn,
      );
      dispute = gen.dispute;
      groundTruth = gen.groundTruth;
    }

    await insertDispute(dispute, groundTruth);
    let record = { ...dispute };

    try {
      const { investigation, proposed_action } = await analyzeDispute(dispute, groundTruth);
      const currentTier = rowToLedger(await ensureLedgerRow(dispute.category)).current_tier;
      const stakesOverride = dispute.amount > STAKE_THRESHOLD;

      let finalPath;
      if (stakesOverride) {
        finalPath = "escalate";
      } else if (dispute.category === "fraud_flag" && currentTier === "auto_execute") {
        finalPath = "draft_for_approval";
      } else {
        finalPath = currentTier;
      }

      const decision = {
        dispute_id: dispute.id,
        proposed_action,
        category: dispute.category,
        ledger_tier_at_decision: currentTier,
        final_path: finalPath,
        stakes_override: stakesOverride,
      };
      record = {
        ...record,
        status: "decided",
        investigation_result: investigation,
        decision,
        decided_at: new Date().toISOString(),
      };

      if (finalPath === "auto_execute") {
        try {
          const exec = execute(dispute, decision);
          record = {
            ...record,
            status: "executed",
            execution_result: exec,
            executed_at: new Date().toISOString(),
          };
        } catch {
          const packet = buildPacket(dispute, investigation, decision, "stakes_override");
          record = {
            ...record,
            status: "escalated",
            escalation_packet: packet,
            escalation_reason: "stakes_override",
            escalated_at: new Date().toISOString(),
          };
        }
      } else {
        const reason = resolveEscalationReason(decision);
        const packet = buildPacket(dispute, investigation, decision, reason);
        record = {
          ...record,
          status: "escalated",
          escalation_packet: packet,
          escalated_at: new Date().toISOString(),
        };
      }

      if (seedOverturn && !decision.stakes_override) {
        await applyReviewOutcome(dispute.category, "overturned");
        record = {
          ...record,
          status: "reviewed",
          review_outcome: "overturned",
          reviewed_at: new Date().toISOString(),
        };
      }
    } catch (err) {
      if (!(err instanceof LLMUnavailableError)) throw err;

      const ledger = rowToLedger(await ensureLedgerRow(dispute.category));
      const investigation = {
        dispute_id: dispute.id,
        root_cause: "Automated investigation unavailable",
        reasoning_summary:
          "The AI provider could not complete the governed workflow; the dispute was routed to human review without execution.",
        evidence: [
          { source: "transaction_log", detail: `UTR ${dispute.utr}` },
          { source: "ledger_state", detail: `Reported amount INR ${dispute.amount.toFixed(2)}` },
        ],
      };
      const decision = {
        dispute_id: dispute.id,
        proposed_action: "escalate",
        category: dispute.category,
        ledger_tier_at_decision: ledger.current_tier,
        final_path: "escalate",
        stakes_override: dispute.amount > STAKE_THRESHOLD,
      };
      const reason = resolveEscalationReason(decision);
      const packet = buildPacket(dispute, investigation, decision, reason);
      record = {
        ...record,
        status: "escalated",
        investigation_result: investigation,
        decision,
        escalation_packet: packet,
        escalation_reason: reason,
        escalated_at: new Date().toISOString(),
        llm_fallback: true,
        fallback_reason: LLMUnavailableError.code,
        fallback_detail: err instanceof Error ? err.message : String(err),
      };
    }

    await admin
      .from("trustledger_disputes")
      .update({ status: String(record.status ?? "escalated"), record })
      .eq("id", dispute.id);

    const ledgerAfter = rowToLedger(await ensureLedgerRow(dispute.category));
    return { body: { dispute: record, ledger_after: ledgerAfter } };
  } catch (err) {
    const cat = dispute?.category ?? "duplicate_charge";
    const ledgerAfter = rowToLedger(await ensureLedgerRow(cat));
    if (dispute) {
      const stakes = dispute.amount > STAKE_THRESHOLD;
      const reason = stakes
        ? "stakes_override"
        : dispute.category === "fraud_flag"
        ? "hard_capped_category"
        : "tier_capped";
      const fallbackRecord = {
        ...dispute,
        status: "escalated",
        escalation_reason: reason,
        escalation_fallback: true,
        escalated_at: new Date().toISOString(),
        fallback_error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
      await admin
        .from("trustledger_disputes")
        .update({ status: "escalated", record: fallbackRecord })
        .eq("id", dispute.id);
      return { body: { dispute: fallbackRecord, ledger_after: ledgerAfter } };
    }
    return {
      status: 500,
      body: {
        dispute: { id: `fallback-${Date.now()}`, category: cat, status: "escalated", escalation_fallback: true },
        ledger_after: ledgerAfter,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo seed (31-step climb-then-fall, no LLM)
// ─────────────────────────────────────────────────────────────────────────────
async function oneDemoStep(step, label, category, outcome) {
  const tierBefore = (await ensureLedgerRow(category)).current_tier;

  let dispute = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const gen = generateDispute(category, false);
    if (gen.dispute.amount <= STAKE_THRESHOLD) {
      dispute = gen.dispute;
      break;
    }
  }
  if (!dispute) dispute = generateDispute(category, false).dispute;

  await admin.from("trustledger_disputes").insert({
    id: dispute.id,
    category: dispute.category,
    amount: dispute.amount,
    utr: dispute.utr,
    txn_timestamp: dispute.txn_timestamp,
    customer_id: dispute.customer_id,
    merchant_id: dispute.merchant_id,
    raw_ticket_text: dispute.raw_ticket_text,
    status: "reviewed",
    record: {
      ...dispute,
      status: "reviewed",
      decision: {
        dispute_id: dispute.id,
        proposed_action: "mark_resolved_no_action",
        category: dispute.category,
        ledger_tier_at_decision: "suggest_only",
        final_path: "escalate",
        stakes_override: false,
      },
      review_outcome: "confirmed_correct",
      reviewed_at: new Date().toISOString(),
    },
  });

  const ledgerAfter = await applyReviewOutcome(category, outcome);
  const tierAfter = ledgerAfter.current_tier;

  let message;
  if (outcome === "overturned") {
    message = tierAfter !== tierBefore
      ? `Case ${label}: overturned -> demoted to ${tierAfter}`
      : `Case ${label}: overturned (remains ${tierAfter})`;
  } else if (tierAfter !== tierBefore) {
    message = `Case ${label}: promoted to ${tierAfter}`;
  } else if (step === 30 && category === "fraud_flag") {
    message = `Case ${label}: confirmed (remains ${tierAfter}, hard-capped)`;
  } else {
    message = `Case ${label}: confirmed (${tierAfter})`;
  }
  return { step, tier_after: tierAfter, message };
}

async function runDemoSeed(body) {
  const category = body?.category;
  if (!CATEGORIES.includes(category)) {
    return { status: 400, body: { error: "InvalidRequest", detail: "invalid category" } };
  }
  const events = [];
  for (let i = 1; i <= 15; i++) events.push(await oneDemoStep(i, `${i}/15`, category, "confirmed_correct"));
  for (let i = 16; i <= 30; i++) events.push(await oneDemoStep(i, `${i}/30`, category, "confirmed_correct"));
  events.push(await oneDemoStep(31, "31/31", category, "overturned"));
  return { body: { events } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "health";

    switch (action) {
      case "health": {
        await admin.from("trustledger_ledgers").select("category", { count: "exact", head: true });
        return json({ status: "ok", redis: "available", llm: "configured" });
      }

      case "ledger": {
        const categories = [];
        for (const cat of CATEGORIES) {
          categories.push(rowToLedger(await ensureLedgerRow(cat)));
        }
        return json({ categories });
      }

      case "disputes": {
        const id = typeof body?.id === "string" ? body.id : null;
        if (id) {
          const { data, error } = await admin
            .from("trustledger_disputes")
            .select("record")
            .eq("id", id)
            .maybeSingle();
          if (error || !data) {
            return json({ error: "NotFound", detail: `dispute ${id} not found` }, 404);
          }
          return json(data.record);
        }
        const { data, error } = await admin
          .from("trustledger_disputes")
          .select("record")
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        return json({ disputes: (data ?? []).map((r) => r.record) });
      }

      case "review": {
        const disputeId = typeof body?.dispute_id === "string" ? body.dispute_id : null;
        const outcome = body?.outcome;
        if (!disputeId) {
          return json({ error: "InvalidRequest", detail: "dispute_id is required" }, 400);
        }
        if (outcome !== "confirmed_correct" && outcome !== "overturned") {
          return json({ error: "InvalidRequest", detail: "outcome must be confirmed_correct or overturned" }, 400);
        }

        const { data: row, error } = await admin
          .from("trustledger_disputes")
          .select("*")
          .eq("id", disputeId)
          .maybeSingle();
        if (error || !row) {
          return json({ error: "NotFound", detail: `dispute ${disputeId} not found` }, 404);
        }

        const record = row.record ?? {};
        if (record?.status === "reviewed" || record?.review_outcome) {
          return json({ error: "AlreadyReviewed", detail: `dispute ${disputeId} already reviewed` }, 400);
        }

        const category = record?.category ?? row.category;
        const amount = Number(record?.amount ?? row.amount ?? 0);
        const decision = record?.decision ?? {};
        const esc = record?.escalation_packet ?? {};
        const isStakes =
          Boolean(decision.stakes_override) ||
          amount > STAKE_THRESHOLD ||
          esc.escalation_reason === "stakes_override";

        const ledgerAfter = isStakes
          ? rowToLedger(await ensureLedgerRow(category))
          : await applyReviewOutcome(category, outcome);

        const updatedRecord = {
          ...record,
          status: "reviewed",
          review_outcome: outcome,
          reviewed_at: new Date().toISOString(),
        };
        await admin
          .from("trustledger_disputes")
          .update({ status: "reviewed", record: updatedRecord })
          .eq("id", disputeId);

        return json({ dispute_id: disputeId, ledger_after: ledgerAfter });
      }

      case "escalations": {
        const { data } = await admin
          .from("trustledger_disputes")
          .select("record")
          .eq("status", "escalated")
          .order("created_at", { ascending: false })
          .limit(200);
        const escalations = (data ?? [])
          .map((r) => r.record?.escalation_packet)
          .filter((p) => p != null);
        return json({ escalations });
      }

      case "ingest": {
        const result = await runIngest(body);
        return json(result.body, result.status ?? 200);
      }

      case "seed": {
        const result = await runDemoSeed(body);
        return json(result.body, result.status ?? 200);
      }

      default:
        return json({ error: "NotFound", detail: `unknown action ${action}` }, 404);
    }
  } catch (err) {
    return json(
      { error: "BackendError", detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
