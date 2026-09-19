// EscalationQueue.tsx — the human review docket.
// Filter chips · mono dispute id + bold INR · reason badge · verdict pair:
// "Confirm Correct" (emerald outline) and "Overturn" (solid red).
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
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
  { value: "all", label: "All" },
  { value: "tier_capped", label: "Tier-Capped" },
  { value: "stakes_override", label: "Stakes Override (>₹50k)" },
  { value: "hard_capped_category", label: "Hard-Capped" },
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || r.packet.escalation_reason === filter) &&
        (q === "" || r.packet.dispute_id.toLowerCase().includes(q)),
    );
  }, [rows, filter, query]);

  return (
    <div>
      {rows.length > 0 && (
        <div className="tl-queue-tools">
          <div
            className="tl-chip-row"
            role="group"
            aria-label="Filter dockets by reason"
          >
            {FILTERS.map((f) => {
              const n =
                f.value === "all"
                  ? rows.length
                  : rows.filter((r) => r.packet.escalation_reason === f.value).length;
              return (
                <button
                  key={f.value}
                  type="button"
                  className={`tl-chip${filter === f.value ? " is-active" : ""}`}
                  aria-pressed={filter === f.value}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  <span className="tl-chip-count" aria-hidden="true">{n}</span>
                </button>
              );
            })}
          </div>
          <input
            className="field tl-search"
            type="search"
            placeholder="Filter by dispute id…"
            aria-label="Filter dockets by dispute id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="tl-empty">Loading review queue…</p>
      ) : rows.length === 0 ? (
        <div className="tl-empty-state anim-pop">
          <div className="tl-empty-seal" aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="2" />
              <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth="1" opacity="0.5" />
              <path d="M20 28h24M20 35h24M20 42h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M26 49l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="tl-empty-title">Docket clear</p>
          <p className="tl-empty-sub">
            Nothing awaiting a human verdict. When a dispute escalates — a tier
            cap, a stakes override, or a hard cap — it lands here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="tl-empty">
          No dockets match —{" "}
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
        <ol className="tl-docket">
          {visible.map((r, i) => {
            const busy = busyId === r.packet.dispute_id;
            return (
              <motion.li
                key={r.packet.dispute_id}
                className={`tl-docket-row reason-${r.packet.escalation_reason} anim-pop`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, delay: Math.min(i, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="tl-docket-left">
                  <p className="tl-docket-id">{r.packet.dispute_id.slice(0, 8)}…</p>
                  <p className="tl-docket-amount">
                    {inr(r.amount)}
                    {r.amount > 50_000 && <span className="tl-stake-tag">stakes override</span>}
                  </p>
                </div>

                <div className="tl-docket-main">
                  <span className={`tl-reason reason-${r.packet.escalation_reason}`}>
                    {r.packet.escalation_reason === "stakes_override"
                      ? "Stakes override"
                      : r.packet.escalation_reason.replaceAll("_", " ")}
                  </span>
                  <p className="tl-docket-intent">{r.packet.intent_summary}</p>
                  <p className="tl-docket-sub">
                    <span className="tl-mono">{CATEGORY_SHORT[r.category]}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {r.packet.evidence_trail.length} evidence
                      {r.packet.evidence_trail.length === 1 ? "" : " items"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{r.packet.actions_taken.length} actions</span>
                  </p>
                </div>

                <div className="tl-docket-verdict">
                  <button
                    type="button"
                    className="btn btn-sm btn-success-outline"
                    disabled={busy}
                    onClick={() => onReview(r.packet.dispute_id, "confirmed_correct")}
                  >
                    {busy ? "Recording…" : "Confirm Correct"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => onReview(r.packet.dispute_id, "overturned")}
                  >
                    Overturn
                  </button>
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
