// EscalationQueue.tsx — the human review docket, rendered as a dense data
// table: mono dispute id with a copy affordance, INR amount + category,
// truncated intent with tooltip, reason pill, and Confirm / Overturn actions.
// Includes a reason filter dropdown and a calm "all caught up" empty state.
import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { DisputeCategory, EscalationPacket, EscalationReason } from "../types";
import { CATEGORY_SHORT, inr } from "../format";
import "./components.css";

export interface EscalationRow {
  packet: EscalationPacket;
  amount: number;
  category: DisputeCategory;
}

type ReasonFilter = EscalationReason | "all";

const FILTERS: { value: ReasonFilter; label: string }[] = [
  { value: "all", label: "All reasons" },
  { value: "tier_capped", label: "Tier-capped" },
  { value: "stakes_override", label: "Stakes override (>₹50k)" },
  { value: "hard_capped_category", label: "Hard-capped" },
];

interface Props {
  rows: EscalationRow[];
  busyId: string | null;
  loading: boolean;
  onReview: (disputeId: string, outcome: "confirmed_correct" | "overturned") => void;
}

export default function EscalationQueue({ rows, busyId, loading, onReview }: Props) {
  const [filter, setFilter] = useState<ReasonFilter>("all");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || r.packet.escalation_reason === filter) &&
        (q === "" || r.packet.dispute_id.toLowerCase().includes(q)),
    );
  }, [rows, filter, query]);

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // Clipboard can be unavailable on some browsers; the visual cue still helps.
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
  };

  return (
    <div className="tl-queue-card">
      <div className="tl-queue-toolbar">
        <h3 className="tl-queue-title">Pending review</h3>
        <div className="tl-queue-tools">
          <select
            className="tl-filter-select"
            aria-label="Filter by escalation reason"
            value={filter}
            onChange={(e) => setFilter(e.target.value as ReasonFilter)}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            className="field tl-search"
            type="search"
            placeholder="Filter by dispute id…"
            aria-label="Filter by dispute id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <p className="tl-empty" style={{ padding: "18px" }}>
          Loading review queue…
        </p>
      ) : rows.length === 0 ? (
        <div className="tl-empty-state">
          <div className="tl-empty-art" aria-hidden="true">
            <svg viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
              <circle cx="40" cy="40" r="21" stroke="currentColor" strokeWidth="1" opacity="0.35" />
              <path d="M28 41l8 8 17-18" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="tl-empty-title">All caught up!</p>
          <p className="tl-empty-sub">
            No disputes pending review. When a dispute escalates — a tier cap,
            a stakes override, or a hard cap — it lands here for a human
            verdict.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="tl-empty" style={{ padding: "18px" }}>
          No disputes match —{" "}
          <button
            type="button"
            className="tl-link-btn"
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
          >
            clear filters
          </button>
          .
        </p>
      ) : (
        <div className="tl-scrollable" style={{ overflowX: "auto" }}>
          <table className="tl-qtable">
            <thead>
              <tr>
                <th>Dispute ID</th>
                <th>Amount</th>
                <th>Intent</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const busy = busyId === r.packet.dispute_id;
                const copied = copiedId === r.packet.dispute_id;
                return (
                  <tr
                    key={r.packet.dispute_id}
                    className={`tl-qrow reason-${r.packet.escalation_reason} anim-pop`}
                  >
                    <td data-label="Dispute ID">
                      <div className="tl-qid">
                        <code className="tl-qid-code">{r.packet.dispute_id}</code>
                        <button
                          type="button"
                          className={`tl-copy-btn${copied ? " is-copied" : ""}`}
                          aria-label="Copy dispute id"
                          onClick={() => void copyId(r.packet.dispute_id)}
                        >
                          {copied ? <Check /> : <Copy />}
                        </button>
                      </div>
                      <p className="tl-qmeta">
                        <span className="tl-mono">{CATEGORY_SHORT[r.category]}</span>
                      </p>
                    </td>

                    <td data-label="Amount">
                      <span className="tl-qamount">{inr(r.amount)}</span>
                      {r.amount > 50_000 && (
                        <span className="tl-qcat">stakes override</span>
                      )}
                    </td>

                    <td data-label="Intent">
                      <p className="tl-qintent" title={r.packet.intent_summary}>
                        {r.packet.intent_summary}
                      </p>
                      <p className="tl-qmeta">
                        <span>
                          {r.packet.evidence_trail.length} evidence
                          {r.packet.evidence_trail.length === 1 ? "" : " items"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{r.packet.actions_taken.length} actions</span>
                      </p>
                    </td>

                    <td data-label="Reason">
                      <span className={`tl-reason-pill reason-${r.packet.escalation_reason}`}>
                        {r.packet.escalation_reason === "stakes_override"
                          ? "Stakes override"
                          : r.packet.escalation_reason.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td data-label="Actions">
                      <div className="tl-qactions">
                        <button
                          type="button"
                          className="btn btn-sm btn-blue-outline"
                          disabled={busy}
                          onClick={() => onReview(r.packet.dispute_id, "confirmed_correct")}
                        >
                          {busy ? "Recording…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost-danger"
                          disabled={busy}
                          onClick={() => onReview(r.packet.dispute_id, "overturned")}
                        >
                          Overturn
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
