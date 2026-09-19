// EscalationQueue.tsx — the review docket: filter chips + id search + verdict pair.
import { useMemo, useState } from "react";
import type { EscalationPacket, EscalationReason } from "../types";
import "./components.css";

type ReasonFilter = EscalationReason | "all";

const FILTERS: { value: ReasonFilter; label: string }[] = [
  { value: "all", label: "All dockets" },
  { value: "tier_capped", label: "Tier-capped" },
  { value: "stakes_override", label: "Stakes" },
  { value: "hard_capped_category", label: "Hard-capped" },
];

interface Props {
  packets: EscalationPacket[];
  busyId: string | null;
  loading: boolean;
  onReview: (disputeId: string, outcome: "confirmed_correct" | "overturned") => void;
}

export default function EscalationQueue({ packets, busyId, loading, onReview }: Props) {
  const [filter, setFilter] = useState<ReasonFilter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packets.filter(
      (p) =>
        (filter === "all" || p.escalation_reason === filter) &&
        (q === "" || p.dispute_id.toLowerCase().includes(q)),
    );
  }, [packets, filter, query]);

  return (
    <div>
      {packets.length > 0 && (
        <div className="tl-queue-tools">
          <div
            className="tl-chip-row"
            role="group"
            aria-label="Filter dockets by reason"
          >
            {FILTERS.map((f) => {
              const n =
                f.value === "all"
                  ? packets.length
                  : packets.filter((p) => p.escalation_reason === f.value).length;
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

      {loading && packets.length === 0 ? (
        <p className="tl-empty">Summoning the docket…</p>
      ) : packets.length === 0 ? (
        <div className="tl-empty-state anim-pop">
          <div className="tl-empty-seal" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 16.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="tl-empty-title">Docket clear</p>
          <p className="tl-empty-sub">
            Nothing awaiting human verdict. Ingest a dispute to open a case.
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
          {visible.map((p, i) => {
            const busy = busyId === p.dispute_id;
            return (
              <li
                key={p.dispute_id}
                className={`tl-docket-row reason-${p.escalation_reason} anim-pop`}
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <span className="tl-docket-no" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="tl-docket-main">
                  <span className={`tl-reason reason-${p.escalation_reason}`}>
                    {p.escalation_reason.replaceAll("_", " ")}
                  </span>
                  <p className="tl-docket-intent">{p.intent_summary}</p>
                  <p className="tl-docket-id">
                    <span className="tl-mono">{p.dispute_id.slice(0, 8)}…</span>
                    <span aria-hidden="true"> · </span>
                    {p.evidence_trail.length} evidence
                    {p.evidence_trail.length === 1 ? "" : " items"}
                  </p>
                </div>
                <div className="tl-docket-verdict">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => onReview(p.dispute_id, "confirmed_correct")}
                  >
                    {busy ? "Recording…" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => onReview(p.dispute_id, "overturned")}
                  >
                    Overturn
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
