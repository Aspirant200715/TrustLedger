// DemoTheater.tsx — the replay deck: transport rail, tier readout, event stream.
import { useEffect, useRef } from "react";
import type { DemoEvent, DisputeCategory, TierLevel } from "../types";
import "./components.css";

const CATEGORIES: DisputeCategory[] = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];

const TOTAL = 31;

function kindOf(message: string): "promote" | "demote" | "info" {
  if (message.includes("promoted")) return "promote";
  if (message.includes("demoted")) return "demote";
  return "info";
}

const TIER_DOT: Record<TierLevel, string> = {
  suggest_only: "dot-suggest",
  draft_for_approval: "dot-draft",
  auto_execute: "dot-auto",
};

interface Props {
  running: DisputeCategory | null;
  events: DemoEvent[];
  onRun: (category: DisputeCategory) => void;
}

export default function DemoTheater({ running, events, onRun }: Props) {
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const last = events.length > 0 ? events[events.length - 1] : null;
  const finished = running === null && events.length === TOTAL;
  const progress = Math.min(100, (events.length / TOTAL) * 100);

  return (
    <div>
      <div className="tl-deck-actions" role="group" aria-label="Replay a category's 31-case climb">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`btn btn-sm${running === c ? " is-running" : ""}`}
            disabled={running !== null}
            onClick={() => onRun(c)}
            title={`31-case climb-then-fall for ${c}`}
          >
            <span className="tl-btn-dot" aria-hidden="true" />
            {running === c ? "Replaying…" : c}
          </button>
        ))}
      </div>

      {events.length === 0 && running === null ? (
        <div className="tl-deck-idle">
          <p className="tl-deck-idle-rule" aria-hidden="true">15 → 15 → 1</p>
          <p className="tl-empty">
            Fifteen cases to <em>draft</em>, fifteen toward <em>auto</em>, then
            a seeded overturn that demotes on screen. Choose a category to roll
            the tape.
          </p>
        </div>
      ) : (
        <div className="tl-deck anim-pop">
          <div className="tl-deck-transport">
            <div className="tl-transport-left">
              <span className="tl-rec-dot" aria-hidden="true" />
              <span className="tl-transport-count tl-num">
                {String(events.length).padStart(2, "0")}/{TOTAL}
              </span>
            </div>
            <div
              className="tl-transport-rail"
              role="progressbar"
              aria-valuenow={events.length}
              aria-valuemin={0}
              aria-valuemax={TOTAL}
              aria-label="Replay progress"
            >
              <div className="tl-transport-fill" style={{ width: `${progress}%` }} />
            </div>
            {last && (
              <span className={`badge badge-${last.tier_after}`}>
                {last.tier_after.replaceAll("_", " ")}
              </span>
            )}
          </div>
          <div
            className="tl-deck-log tl-scrollable"
            ref={logRef}
            aria-live="polite"
            tabIndex={0}
            aria-label="Replay event log"
          >
            {events.map((e) => (
              <div key={e.step} className={`tl-log-line tl-log-${kindOf(e.message)}`}>
                <span className="tl-log-step">{String(e.step).padStart(2, "0")}</span>
                <span className={`tl-tier-dot ${TIER_DOT[e.tier_after]}`} aria-hidden="true" />
                <span className="tl-log-msg">{e.message}</span>
              </div>
            ))}
            {running !== null && (
              <div className="tl-log-line tl-log-info">
                <span className="tl-log-step">··</span>
                <span className="tl-typing" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="tl-log-msg">clearing the next case…</span>
              </div>
            )}
          </div>
          {finished && last && (
            <p className="tl-deck-finale anim-pop">
              Tape ends — held at{" "}
              <strong>{last.tier_after.replaceAll("_", " ")}</strong> after the
              seeded overturn. The ledger card above agrees.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
