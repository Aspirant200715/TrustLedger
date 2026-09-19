// LedgerCard.tsx — one autonomy instrument per dispute category, fintech
// stat-card style: uppercase kicker + tier pill, big accuracy figure, a mini
// outcome sparkline, hover "view details" affordance, and a click-to-expand
// tier_history timeline of promotions and demotions.
import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown, Lock } from "lucide-react";
import type { LedgerRecord } from "../types";
import {
  CATEGORY_LABEL,
  TIER_LABEL,
  TIER_RANK,
  clockTime,
} from "../format";
import { lifetimeAccuracy, nextThreshold } from "./ledgerUtils";
import "./components.css";

const SPARK_W = 280;
const SPARK_H = 34;

export type OutcomeDot = "ok" | "overturned" | "pending";

interface Props {
  record: LedgerRecord;
  outcomes: OutcomeDot[];
  flashing: boolean;
  index: number;
}

/** Mini sparkline of the last 10 outcomes (ok = up, overturned = down). */
function Sparkline({ outcomes }: { outcomes: OutcomeDot[] }) {
  const gradId = useId();
  const data = outcomes
    .slice(0, 10)
    .reverse()
    .map((o) => (o === "ok" ? 1 : 0));
  const n = data.length;

  if (n === 0) {
    return (
      <svg
        className="tl-spark-svg"
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          className="tl-spark-empty-line"
          x1="0"
          y1={SPARK_H / 2}
          x2={SPARK_W}
          y2={SPARK_H / 2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const pts = data.map((v, i) => [
    n === 1 ? SPARK_W / 2 : (i / (n - 1)) * SPARK_W,
    SPARK_H - 3 - v * (SPARK_H - 6),
  ]);
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${pts[n - 1][0].toFixed(1)},${SPARK_H} L${pts[0][0].toFixed(1)},${SPARK_H} Z`;
  const last = pts[n - 1];

  return (
    <svg
      className="tl-spark-svg"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="tl-spark-fill" fill={`url(#${gradId})`} d={area} />
      <path className="tl-spark-line" d={line} vectorEffect="non-scaling-stroke" />
      <circle
        className="tl-spark-dot"
        cx={last[0]}
        cy={last[1]}
        r="2.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function LedgerCard({ record, outcomes, flashing, index }: Props) {
  const [open, setOpen] = useState(false);

  // Hard-capped categories never show an "auto" path (CONTRACT.md).
  const capped = record.hard_capped;
  const threshold = capped ? null : nextThreshold(record.current_tier);
  const maxed = record.current_tier === "auto_execute";

  const lastChange = record.tier_history[record.tier_history.length - 1];
  const lastDemoted =
    lastChange !== undefined &&
    TIER_RANK[lastChange.to_tier] < TIER_RANK[lastChange.from_tier];

  const acc = lifetimeAccuracy(record);

  return (
    <article
      className={`tl-stat anim-rise${flashing ? (lastDemoted ? " is-flashing-demote" : " is-flashing") : ""}${open ? " is-open" : ""}`}
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      data-tier={record.current_tier}
      aria-label={`${CATEGORY_LABEL[record.category]}, tier ${TIER_LABEL[record.current_tier]}`}
    >
      <div className="tl-stat-head">
        <p className="tl-stat-kicker">
          <span>{CATEGORY_LABEL[record.category]}</span>
          {capped && (
            <Lock
              className="tl-stat-lock"
              size={13}
              aria-label="Hard-capped: cannot reach auto-execute"
            />
          )}
        </p>
        <span className={`badge badge-${record.current_tier}`}>
          {TIER_LABEL[record.current_tier]}
        </span>
      </div>

      <p className={`tl-stat-value${acc === "—" ? " is-cold" : ""}`}>{acc}</p>
      <p className="tl-stat-sub">
        Lifetime accuracy · {record.lifetime_correct}/{record.lifetime_total}
        {record.lifetime_overturned > 0 &&
          ` · ${record.lifetime_overturned} overturned`}
      </p>

      <div className="tl-stat-spark">
        <div className="tl-spark-label">
          <span>Last 10 outcomes</span>
          <span>
            {record.in_tier_correct}/{record.in_tier_total} in-tier
          </span>
        </div>
        <Sparkline outcomes={outcomes} />
      </div>

      <div className="tl-stat-foot">
        <span>
          {capped
            ? "Capped at draft for approval"
            : maxed
              ? "Maximum tier reached"
              : `${record.in_tier_correct} of ${threshold} in tier`}
        </span>
        <span className="tl-stat-arrow">
          {record.tier_history.length > 0
            ? `${record.tier_history.length} change${record.tier_history.length === 1 ? "" : "s"}`
            : "View details"}
          <ArrowRight aria-hidden="true" />
        </span>
      </div>

      <div className="tl-stat-expand">
        <span className="tl-stat-expand-hint">
          {record.tier_history.length > 0 ? "Tier history" : "No tier changes yet"}
        </span>
        <button
          type="button"
          className="tl-expand-btn"
          aria-expanded={open}
          aria-controls={`tier-history-${record.category}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "History"}
          <ChevronDown aria-hidden="true" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`tier-history-${record.category}`}
            key="timeline"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="tl-timeline">
              {record.tier_history.length === 0 ? (
                <p className="tl-tl-empty">
                  All categories begin at <em>suggest only</em>. Confirmed
                  review outcomes will advance this record toward a higher
                  tier.
                </p>
              ) : (
                record.tier_history.map((h, i) => {
                  const demoted = TIER_RANK[h.to_tier] < TIER_RANK[h.from_tier];
                  return (
                    <div key={`${h.timestamp}-${i}`} className="tl-tl-item">
                      <span className="tl-tl-rail" aria-hidden="true">
                        <span className={`tl-tl-dot ${demoted ? "demote" : "promote"}`} />
                      </span>
                      <div className="tl-tl-body">
                        <p className="tl-tl-route">
                          <span className={demoted ? "demote-fg" : "promote-fg"}>
                            {TIER_LABEL[h.from_tier]}
                          </span>
                          <span className="tl-tl-arrow" aria-hidden="true">→</span>
                          <span>{TIER_LABEL[h.to_tier]}</span>
                        </p>
                        <p className="tl-tl-reason">{h.reason}</p>
                        <p className="tl-tl-ts">{clockTime(h.timestamp)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
