// Boot.tsx — brief initialization overlay shown while the console connects.
// Deliberately restrained: a short fade, the mark, and a determinate bar.
// Skippable (click / any key) and reduced-motion safe.
import { useEffect, useRef, useState } from "react";
import "./Boot.css";

const ENTER_MS = 1100;
const EXIT_MS = 280;

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
      const t = window.setTimeout(finish, 150);
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
      <div className="tl-boot-core">
        <svg className="tl-seal" viewBox="0 0 96 96" fill="none">
          <circle cx="48" cy="48" r="42" stroke="#10b981" strokeWidth="3" />
          <path
            d="M30 40h36M30 50h36"
            stroke="#cbd5e1"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M38 62l8 8 14-16"
            stroke="#34d399"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <p className="tl-boot-word">TrustLedger</p>
        <p className="tl-boot-tag">Autonomy, Earned.</p>

        <div className="tl-boot-meter">
          <div className="tl-boot-meter-fill" />
        </div>
      </div>
    </div>
  );
}
