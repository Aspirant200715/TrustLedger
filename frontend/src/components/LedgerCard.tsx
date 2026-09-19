// LedgerCard.tsx — one autonomy instrument per dispute category.
// Tier pill · accuracy gauge · hard-cap lock · 10-outcome micro-trend ·
// click-to-expand tier_history timeline of promotions and demotions.
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Lock } from "lucide-react";
import type { LedgerRecord } from "../types";
import {
  CATEGORY_LABEL,
  TIER_LABEL,
  TIER_RANK,
  clockTime,
} from "../format";
import { lifetimeAccuracy, nextThreshold } from "./ledgerUtils";
import "./components.css";

const R = 26;
const CIRC = 2 * Math.PI * R;

export type OutcomeDot = "ok" | "overturned" | "pending";


/** Promotion entry — brief, neutral. */
const promoteVariant = {
  initial: { opacity: 0, y: 4 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.2, 0, 0, 1] as const },
  },
};

/** Demotion entry — same timing; meaning is carried by colour, not motion. */
const demoteVariant = promoteVariant;

interface Props {
  record: LedgerRecord;
  outcomes: OutcomeDot[];
  flashing: boolean;
  index: number;
}

export default function LedgerCard({ record, outcomes, flashing, index }: Props) {
  const [open, setOpen] = useState(false);

  // Hard-capped categories never show an "auto" path (CONTRACT.md).
  const capped = record.hard_capped;
  const threshold = capped ? null : nextThreshold(record.current_tier);
  const frac = threshold === null ? 1 : Math.min(1, record.in_tier_correct / threshold);
  const pct = Math.round(frac * 100);

  const lastChange = record.tier_history[record.tier_history.length - 1];
  const lastDemoted =
    lastChange !== undefined &&
    TIER_RANK[lastChange.to_tier] < TIER_RANK[lastChange.from_tier];

  const onMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <article
      className={`tl-instrument anim-rise${flashing ? (lastDemoted ? " is-flashing-demote" : " is-flashing") : ""}${open ? " is-open" : ""}`}
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      onMouseMove={onMove}
      aria-label={`${CATEGORY_LABEL[record.category]}, tier ${TIER_LABEL[record.current_tier]}`}
    >
      <span className="tl-spotlight" aria-hidden="true" />
      <span className={`tl-tier-beam tier-${record.current_tier}`} aria-hidden="true" />

      <div className="tl-instrument-top">
        <div className="tl-instrument-name-row">
          <h3 className="tl-instrument-name">{CATEGORY_LABEL[record.category]}</h3>
          {capped && (
            <Lock
              className="tl-lock is-capped"
              size={15}
              aria-label="Hard-capped: cannot reach auto-execute"
            />
          )}
        </div>
        <span className={`badge badge-${record.current_tier}`}>
          {record.current_tier === "auto_execute" && <span aria-hidden="true">●</span>}
          {TIER_LABEL[record.current_tier]}
        </span>
      </div>

      <div className="tl-gauge-row">
        <svg
          className="tl-gauge"
          viewBox="0 0 64 64"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${CATEGORY_LABEL[record.category]} progress to next tier`}
        >
          <circle className="tl-gauge-track" cx="32" cy="32" r={R} />
          <circle
            className={`tl-gauge-arc tier-${record.current_tier}`}
            cx="32"
            cy="32"
            r={R}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - frac)}
          />
          <text x="32" y="32" className="tl-gauge-num">
            {threshold === null ? (capped ? "LOCK" : "MAX") : `${pct}%`}
          </text>
        </svg>
        <div className="tl-gauge-caption">
          <p className="tl-gauge-title">
            {capped
              ? "Capped at draft for approval"
              : threshold === null
                ? "Maximum tier reached"
                : `${record.in_tier_correct} of ${threshold} in tier`}
          </p>
          <p className="tl-gauge-sub">
            {capped
              ? "Auto-execute is not permitted for this category"
              : threshold === null
                ? "No higher tier available"
                : record.current_tier === "suggest_only"
                  ? "Requires 15 outcomes at 90% accuracy"
                  : "Requires 30 outcomes at 97% accuracy"}
          </p>
        </div>
      </div>

      <div className="tl-trend" aria-label="Last outcomes">
        <dl className="tl-trend-head">
          <dt>Last 10 outcomes</dt>
          <dd>
            {record.in_tier_correct}/{record.in_tier_total} in-tier
          </dd>
        </dl>
        <div className="tl-trend-dots" aria-hidden="true">
          {outcomes.slice(0, 10).map((o, i) => (
            <span key={`${o}-${i}`} className={`tl-trend-dot ${o}`} />
          ))}
        </div>
        <div className="tl-trend-rule" aria-hidden="true" />
      </div>

      <dl className="tl-instrument-meta">
        <div>
          <dt>Lifetime accuracy</dt>
          <dd className="tl-num">
            <strong>{lifetimeAccuracy(record)}</strong>
            <span className="tl-dim">
              {" "}· {record.lifetime_correct}/{record.lifetime_total}
              {record.lifetime_overturned > 0 && ` · ${record.lifetime_overturned} overturned`}
            </span>
          </dd>
        </div>
        <div className="tl-meta-split">
          <div>
            <dt>Tier changes</dt>
            <dd className="tl-num">{record.tier_history.length}</dd>
          </div>
          <div>
            <dt>Cap</dt>
            <dd className="tl-num">{capped ? "draft max" : "none"}</dd>
          </div>
        </div>
      </dl>

      <div className="tl-instrument-expand">
        <span className="tl-instrument-expand-hint">
          {record.tier_history.length > 0
            ? `${record.tier_history.length} tier change${record.tier_history.length === 1 ? "" : "s"} recorded`
            : "No tier changes recorded"}
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
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
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
                    <motion.div
                      key={`${h.timestamp}-${i}`}
                      className="tl-tl-item"
                      variants={demoted ? demoteVariant : promoteVariant}
                      initial="initial"
                      animate="animate"
                      custom={demoted}
                    >
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
                    </motion.div>
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
