// AuditLog.tsx — the immutable state-change trail.
// Reconstructed from live API state (CONTRACT.md rule #3: every
// state-changing action is logged with a timestamp). Each dispute's
// decided / executed / escalated / reviewed stamps plus every ledger
// tier movement appear here, newest first.
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { DisputeCategory, LedgerRecord, MergedDispute } from "../types";
import { CATEGORY_LABEL, CATEGORY_SHORT, clockTime, inr } from "../format";
import "./components.css";

interface AuditEntry {
  id: string;
  ts: string;
  kind:
    | "decided"
    | "executed"
    | "escalated"
    | "reviewed-correct"
    | "reviewed-overturned"
    | "tier-promote"
    | "tier-demote";
  category: DisputeCategory;
  amount?: number;
  detail: string;
}

const CATEGORIES: DisputeCategory[] = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];

const KIND_LABEL: Record<AuditEntry["kind"], string> = {
  decided: "Decided",
  executed: "Executed",
  escalated: "Escalated",
  "reviewed-correct": "Confirmed",
  "reviewed-overturned": "Overturned",
  "tier-promote": "Tier +",
  "tier-demote": "Tier −",
};

const KIND_ORDER: AuditEntry["kind"][] = [
  "decided",
  "executed",
  "escalated",
  "reviewed-correct",
  "reviewed-overturned",
  "tier-promote",
  "tier-demote",
];

type KindFilter = AuditEntry["kind"] | "all";

interface Props {
  disputes: MergedDispute[];
  ledgers: LedgerRecord[];
  loading: boolean;
}

export default function AuditLog({ disputes, ledgers, loading }: Props) {
  const [catFilter, setCatFilter] = useState<DisputeCategory | "all">("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const entries = useMemo<AuditEntry[]>(() => {
    const out: AuditEntry[] = [];

    for (const d of disputes) {
      if (d.decided_at && d.decision) {
        out.push({
          id: `${d.id}-decided`,
          ts: d.decided_at,
          kind: "decided",
          category: d.category,
          amount: d.amount,
          detail: `${d.decision.proposed_action.replaceAll("_", " ")} · final path ${d.decision.final_path}${d.decision.stakes_override ? " · stakes override" : ""}`,
        });
      }
      if (d.executed_at && d.execution_result) {
        out.push({
          id: `${d.id}-executed`,
          ts: d.executed_at,
          kind: "executed",
          category: d.category,
          amount: d.amount,
          detail: `${d.execution_result.action_taken.replaceAll("_", " ")} · balance ${inr(d.execution_result.mock_ledger_balance_after)}`,
        });
      }
      if (d.escalated_at && d.escalation_packet) {
        out.push({
          id: `${d.id}-escalated`,
          ts: d.escalated_at,
          kind: "escalated",
          category: d.category,
          amount: d.amount,
          detail: `routed to human · ${d.escalation_packet.escalation_reason.replaceAll("_", " ")}`,
        });
      }
      if (d.reviewed_at && d.review_outcome) {
        out.push({
          id: `${d.id}-reviewed`,
          ts: d.reviewed_at,
          kind: d.review_outcome === "confirmed_correct" ? "reviewed-correct" : "reviewed-overturned",
          category: d.category,
          amount: d.amount,
          detail: `human verdict on ${d.id.slice(0, 8)}`,
        });
      }
    }

    for (const l of ledgers) {
      for (const h of l.tier_history) {
        const rank = { suggest_only: 0, draft_for_approval: 1, auto_execute: 2 };
        out.push({
          id: `tier-${l.category}-${h.timestamp}`,
          ts: h.timestamp,
          kind: rank[h.to_tier] >= rank[h.from_tier] ? "tier-promote" : "tier-demote",
          category: l.category,
          detail: `${h.from_tier.replaceAll("_", " ")} → ${h.to_tier.replaceAll("_", " ")} · ${h.reason}`,
        });
      }
    }

    return out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }, [disputes, ledgers]);

  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          (catFilter === "all" || e.category === catFilter) &&
          (kindFilter === "all" || e.kind === kindFilter),
      ),
    [entries, catFilter, kindFilter],
  );

  return (
    <section aria-label="Audit logs">
      <div className="tl-audit-tools">
        <div className="tl-chip-row" role="group" aria-label="Filter by category">
          <button
            type="button"
            className={`tl-chip${catFilter === "all" ? " is-active" : ""}`}
            onClick={() => setCatFilter("all")}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`tl-chip${catFilter === c ? " is-active" : ""}`}
              onClick={() => setCatFilter(c)}
            >
              {CATEGORY_SHORT[c]}
            </button>
          ))}
        </div>
        <span className="tl-audit-count">{visible.length} entries</span>
      </div>

      <div className="tl-chip-row" role="group" aria-label="Filter by event type" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tl-chip${kindFilter === "all" ? " is-active" : ""}`}
          onClick={() => setKindFilter("all")}
        >
          All events
        </button>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            className={`tl-chip${kindFilter === k ? " is-active" : ""}`}
            onClick={() => setKindFilter(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {loading && entries.length === 0 ? (
        <p className="tl-empty">Loading audit records…</p>
      ) : visible.length === 0 ? (
        <div className="tl-empty-state anim-pop">
          <div className="tl-empty-seal" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 12h12M10 16h12M10 20h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="tl-empty-title">No entries yet</p>
          <p className="tl-empty-sub">
            Every decided, executed, escalated, reviewed and tier-moving event
            will be recorded here with its timestamp.
          </p>
        </div>
      ) : (
        <div className="tl-audit">
          <div className="tl-audit-head" aria-hidden="true">
            <span>Timestamp</span>
            <span>Event</span>
            <span>Detail</span>
            <span>Amount</span>
          </div>
          {visible.slice(0, 120).map((e, i) => (
            <motion.div
              key={e.id}
              className="tl-audit-row"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: Math.min(i, 20) * 0.012 }}
            >
              <span className="tl-audit-ts">{clockTime(e.ts)}</span>
              <span className={`tl-audit-kind k-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
              <span className="tl-audit-detail">
                <span className="tl-mono">{CATEGORY_LABEL[e.category]}</span>
                {" · "}
                {e.detail}
              </span>
              <span className="tl-audit-amount">{e.amount !== undefined ? inr(e.amount) : ""}</span>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
