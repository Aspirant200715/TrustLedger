// Boot.tsx — cinematic entrance: the Clearing House powers up.
// Fixed overlay, ~2s, skippable (click / any key), reduced-motion safe.
// App content mounts beneath immediately; overlay only choreographs reveal.
import { useEffect, useRef, useState } from "react";
import "./Boot.css";

const WORD = "TRUSTLEDGER";
const ENTER_MS = 3000;
const EXIT_MS = 520;

export default function Boot({ onDone }: { onDone: () => void }) {
  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      const t = window.setTimeout(finish, 320);
      return () => window.clearTimeout(t);
    }
    const exit = window.setTimeout(() => setExiting(true), ENTER_MS);
    const done = window.setTimeout(finish, ENTER_MS + EXIT_MS);
    const skip = () => {
      setExiting(true);
      window.setTimeout(finish, EXIT_MS);
    };
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(exit);
      window.clearTimeout(done);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`tl-boot${exiting ? " is-exiting" : ""}`}
      role="presentation"
      aria-hidden="true"
    >
      <span className="tl-boot-glow" />
      <span className="tl-boot-streak tl-boot-streak-a" />
      <span className="tl-boot-streak tl-boot-streak-b" />
      <span className="tl-boot-grid" />

      <div className="tl-boot-core">
        <svg className="tl-seal" viewBox="0 0 96 96" fill="none">
          <circle
            className="tl-seal-ring"
            cx="48"
            cy="48"
            r="42"
            stroke="#10b981"
            strokeWidth="1.5"
          />
          <circle
            className="tl-seal-ring-inner"
            cx="48"
            cy="48"
            r="34"
            stroke="rgba(16,185,129,0.35)"
            strokeWidth="1"
          />
          <path
            className="tl-seal-ledger"
            d="M30 40h36M30 48h36M30 56h22"
            stroke="#cbd5e1"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            className="tl-seal-check"
            d="M40 62l7 7 13-15"
            stroke="#34d399"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <h1 className="tl-boot-word" aria-label="TrustLedger">
          {WORD.split("").map((ch, i) => (
            <span key={i} style={{ animationDelay: `${620 + i * 72}ms` }}>
              {ch}
            </span>
          ))}
        </h1>
        <div className="tl-boot-rule" />
        <p className="tl-boot-tag">Autonomy, Earned.</p>
      </div>

      <div className="tl-boot-meter">
        <div className="tl-boot-meter-fill" />
      </div>
      <p className="tl-boot-hint">click anywhere to enter</p>
    </div>
  );
}
