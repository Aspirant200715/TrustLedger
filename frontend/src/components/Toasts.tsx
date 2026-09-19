// Toasts.tsx — stacked verdict slips, aria-live polite.
import "./components.css";

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

export default function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="tl-toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`tl-toast tl-toast-${t.tone}`} role="status">
          <span
            className={`tl-toast-seal tl-toast-seal-${t.tone}`}
            aria-hidden="true"
          >
            {t.tone === "ok" ? "✓" : "!"}
          </span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
