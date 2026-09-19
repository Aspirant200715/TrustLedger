// Boot.tsx — "Secure Handshake" intro. A calm, bank-app-style opening:
// the TrustLedger seal draws itself in, two status lines sequence, then the
// whole overlay fades up into the dashboard. Skippable and reduced-motion safe.
import { useEffect, useRef, useState } from "react";
import "./Boot.css";

const DRAW_MS = 720;         // seal finishes drawing
const VERIFY_MS = 760;       // "Verifying Policy Engine…" hold
const EXIT_MS = 320;         // fade-up duration

export default function Boot({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState(0); // 0 = establishing, 1 = verifying
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
      const t = window.setTimeout(finish, 120);
      return () => window.clearTimeout(t);
    }
    const t1 = window.setTimeout(() => setStage(1), DRAW_MS);
    const t2 = window.setTimeout(() => setExiting(true), DRAW_MS + VERIFY_MS);
    const t3 = window.setTimeout(finish, DRAW_MS + VERIFY_MS + EXIT_MS);
    const skip = () => {
      setExiting(true);
      window.setTimeout(finish, EXIT_MS);
    };
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
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
      <div className="tl-boot-core">
        <svg className="tl-seal" viewBox="0 0 96 96" fill="none">
          <circle className="s-draw s-circle" pathLength={1} cx="48" cy="48" r="40" />
          <path className="s-draw s-bars" pathLength={1} d="M34 42h28M34 54h28" />
          <path className="s-draw s-check" pathLength={1} d="M40 66l8 8 12-14" />
        </svg>

        <p className="tl-boot-word">TrustLedger</p>
        <p className="tl-boot-status" key={stage}>
          {stage === 0 ? "Establishing Trust Ledger…" : "Verifying Policy Engine…"}
        </p>
      </div>
    </div>
  );
}
