// TopBar.tsx — global navigation bar.
// Left: seal wordmark + breadcrumbs (Autonomy Console / <section>).
// Right: system status pill, notification bell (dot when pending review),
// and the operator avatar.
import { Bell } from "lucide-react";
import "./layout.css";

interface Props {
  title: string;
  online: boolean;
  loadError: boolean;
  pending: number;
}

export default function TopBar({ title, online, loadError, pending }: Props) {
  const degraded = loadError || !online;
  return (
    <header className="tl-topbar">
      <div className="tl-topbar-left">
        <svg className="tl-topbar-seal" viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="7" />
          <path d="M34 42h28M34 54h28" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <path d="M40 66l8 8 12-14" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <nav className="tl-topbar-crumbs" aria-label="Breadcrumb">
          <span className="tl-crumb-root">Autonomy Console</span>
          <span className="tl-crumb-sep" aria-hidden="true">/</span>
          <span className="tl-crumb-here">{title}</span>
        </nav>
      </div>

      <div className="tl-topbar-right">
        <span className={`tl-live-pill${degraded ? " is-down" : ""}`} role="status">
          <span className="tl-live-dot" aria-hidden="true" />
          {degraded ? (loadError ? "Backend degraded" : "Offline") : "System Operational"}
        </span>

        <button
          type="button"
          className="tl-icon-btn"
          aria-label={pending > 0 ? `${pending} disputes pending review` : "No notifications"}
        >
          <Bell aria-hidden="true" />
          {pending > 0 && <span className="tl-bell-dot" aria-hidden="true" />}
        </button>

        <span className="tl-avatar" aria-hidden="true">
          TL
        </span>
      </div>
    </header>
  );
}
