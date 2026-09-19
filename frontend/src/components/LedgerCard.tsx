// LedgerCard.tsx — one autonomy instrument per dispute category.
// Radial gauge + cursor spotlight + tier beam. Data contract unchanged.
import { useCallback } from "react";
import type { LedgerRecord } from "../types";
import { lifetimeAccuracy, nextThreshold } from "./ledgerUtils";
import "./components.css";

const R = 26;
const CIRC = 2 * Math.PI * R;

interface Props {
  record: LedgerRecord;
  flashing: boolean;
  index: number;
}

export default function LedgerCard({ record, flashing, index }: Props) {
  const threshold = nextThreshold(record.current_tier);
  const frac = threshold === null ? 1 : Math.min(1, record.in_tier_correct / threshold);
  const pct = Math.round(frac * 100);

  // Cursor spotlight: sets --mx/--my for a localized light wash on hover.
  const onMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <article
      className={`tl-instrument anim-rise${flashing ? " is-flashing" : ""}`}
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      onMouseMove={onMove}
      aria-label={`${record.category}, tier ${record.current_tier}`}
    >
      <span className="tl-spotlight" aria-hidden="true" />
      <span className={`tl-tier-beam tier-${record.current_tier}`} aria-hidden="true" />

      <div className="tl-instrument-top">
        <h3 className="tl-instrument-name">{record.category}</h3>
        <span className={`badge badge-${record.current_tier}`}>
          {record.current_tier === "auto_execute" ? "● " : ""}
          {record.current_tier.replaceAll("_", " ")}
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
          aria-label={`${record.category} progress to next tier`}
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
            {threshold === null ? "MAX" : `${pct}%`}
          </text>
        </svg>
        <div className="tl-gauge-caption">
          <p className="tl-gauge-title">
            {threshold === null
              ? "Full autonomy"
              : `In-tier ${record.in_tier_correct} / ${threshold}`}
          </p>
          <p className="tl-gauge-sub">
            {threshold === null
              ? "Nothing above this tier"
              : record.current_tier === "suggest_only"
                ? "15 at ≥90% to draft"
                : "30 at ≥97% to auto"}
          </p>
        </div>
      </div>

      <dl className="tl-instrument-meta">
        <div>
          <dt>Lifetime accuracy</dt>
          <dd className="tl-num">
            <strong>{lifetimeAccuracy(record)}</strong>
            <span className="tl-dim">
              {" "}· {record.lifetime_correct}/{record.lifetime_total}
              {record.lifetime_overturned > 0 &&
                ` · ${record.lifetime_overturned} overturned`}
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
            <dd className="tl-num">{record.hard_capped ? "draft max" : "none"}</dd>
          </div>
        </div>
      </dl>
    </article>
  );
}
