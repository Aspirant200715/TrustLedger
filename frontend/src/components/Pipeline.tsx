// Pipeline.tsx — the live feed of disputes moving through the agent pipeline.
// Each row is a horizontal stepper: Ingested → Investigated → Decided →
// [Executed | Escalated]. Escalated rows glow amber; executed rows, emerald.
import { motion } from "framer-motion";
import { Check, Dot } from "lucide-react";
import type { DisputeCategory, MergedDispute } from "../types";
import { CATEGORY_SHORT, TIER_LABEL, inr, timeAgo } from "../format";
import "./components.css";

const CATEGORIES: DisputeCategory[] = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];

type IngestPhase = "idle" | "working" | "done";

interface Props {
  disputes: MergedDispute[];
  loading: boolean;
  ingestCat: DisputeCategory | "random";
  ingestPhase: IngestPhase;
  onIngestCat: (c: DisputeCategory | "random") => void;
  onIngest: () => void;
}

function stepsFor(d: MergedDispute) {
  const escalated =
    Boolean(d.escalation_packet) || d.decision?.final_path === "escalate";
  const labels: string[] = ["Ingested", "Investigated", "Decided", escalated ? "Escalated" : "Executed"];
  const terminal = ["executed", "escalated", "reviewed"].includes(d.status);
  const idx = { ingested: 0, investigated: 1, decided: 2, executed: 3, escalated: 3, reviewed: 3 }[d.status] ?? 0;
  return {
    labels,
    doneCount: terminal ? 4 : idx,
    activeIdx: terminal ? -1 : idx,
    escalated,
  };
}

export default function Pipeline({ disputes, loading, ingestCat, ingestPhase, onIngestCat, onIngest }: Props) {
  return (
    <section aria-label="Live pipeline">
      <div className="tl-pipeline-tools">
        <div className="tl-ingest-row">
          <select
            className="field"
            value={ingestCat}
            onChange={(e) => onIngestCat(e.target.value as DisputeCategory | "random")}
            aria-label="Dispute category"
          >
            <option value="random">Random category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn btn-primary${ingestPhase === "done" ? " is-done" : ""}`}
            onClick={onIngest}
            disabled={ingestPhase !== "idle"}
          >
            {ingestPhase === "working" ? (
              <>
                <span className="tl-spinner" aria-hidden="true" /> Clearing…
              </>
            ) : ingestPhase === "done" ? (
              "Filed"
            ) : (
              "File dispute"
            )}
          </button>
        </div>
        <p className="tl-pipeline-note">
          <Dot aria-hidden="true" />
          newest first · auto-refresh 3s · {disputes.length} on record
        </p>
      </div>

      {loading && disputes.length === 0 ? (
        <p className="tl-empty">Summoning the pipeline…</p>
      ) : disputes.length === 0 ? (
        <div className="tl-empty-state anim-pop">
          <div className="tl-empty-seal" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 20h16M12 14l-4 4 4 4M20 14l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="tl-empty-title">Pipeline empty</p>
          <p className="tl-empty-sub">
            No disputes yet. File one above and watch it flow through
            investigate → decide → execute (or escalate).
          </p>
        </div>
      ) : (
        <div className="tl-pipeline">
          {disputes.slice(0, 24).map((d, i) => {
            const s = stepsFor(d);
            const reviewedOk = d.review_outcome === "confirmed_correct";
            const reviewedBad = d.review_outcome === "overturned";
            return (
              <motion.div
                key={d.id}
                className={`tl-prow${s.escalated ? " is-escalated" : ""}${d.status === "executed" || reviewedOk ? " is-executed" : ""}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.03, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="tl-prow-main">
                  <div className="tl-prow-head">
                    <span className="tl-prow-id">{d.id.slice(0, 8)}</span>
                    <span className={`tl-cat-chip cat-${d.category}`}>{CATEGORY_SHORT[d.category]}</span>
                    <span className="tl-prow-time">{timeAgo(d.decided_at ?? d.escalated_at ?? d.executed_at ?? d.txn_timestamp)}</span>
                    {d.decision?.stakes_override && (
                      <span className="tl-reason reason-stakes_override" style={{ marginLeft: "auto" }}>
                        &gt;₹50k stake
                      </span>
                    )}
                  </div>
                  <div className="tl-stepper" aria-label={`Status: ${s.labels.join(" → ")}`}>
                    {s.labels.map((label, i) => {
                      const done = i < s.doneCount;
                      const active = i === s.activeIdx;
                      const isEsc = s.escalated && i === 3;
                      return (
                        <span key={label} style={{ display: "contents" }}>
                          <span
                            className={`tl-step${done ? " is-done" : ""}${active ? " is-active" : ""}${isEsc ? " is-escalated" : ""}`}
                          >
                            <span className="tl-step-dot" aria-hidden="true">
                              {done ? <Check /> : <Dot />}
                            </span>
                            <span className="tl-step-label">{label}</span>
                          </span>
                          {i < s.labels.length - 1 && (
                            <span className={`tl-step-connector${done ? " is-done" : ""}${isEsc ? " is-escalated" : ""}`} aria-hidden="true" />
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <span className="tl-prow-amount">{inr(d.amount)}</span>

                <div className="tl-prow-final">
                  {reviewedOk ? (
                    <span className="badge badge-auto_execute">Confirmed</span>
                  ) : reviewedBad ? (
                    <span className="badge" style={{ color: "var(--danger-hi)", background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.5)" }}>
                      Overturned
                    </span>
                  ) : d.status === "executed" ? (
                    <span className="badge badge-auto_execute">
                      {d.execution_result?.action_taken?.replaceAll("_", " ") ?? "executed"}
                    </span>
                  ) : d.status === "escalated" ? (
                    <span className="badge badge-draft_for_approval">Escalated</span>
                  ) : d.decision ? (
                    <span className="badge badge-suggest_only">
                      {d.decision.final_path === "escalate" ? "escalating" : `→ ${TIER_LABEL[d.decision.final_path as keyof typeof TIER_LABEL] ?? d.decision.final_path}`}
                    </span>
                  ) : (
                    <span className="badge badge-suggest_only">in flight</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}
