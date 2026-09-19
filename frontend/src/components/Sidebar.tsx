// Sidebar.tsx — the command rail: brand seal, four console views, contract rules.
import {
  Activity,
  Inbox,
  LayoutDashboard,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import "./layout.css";

export type ViewId = "dashboard" | "pipeline" | "escalations" | "audit";

interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", hint: "Trust ledger", icon: LayoutDashboard },
  { id: "pipeline", label: "Live Pipeline", hint: "Disputes in motion", icon: Activity },
  { id: "escalations", label: "Escalation Docket", hint: "Human review", icon: Inbox },
  { id: "audit", label: "Audit Logs", hint: "Immutable trail", icon: ScrollText },
];

interface Props {
  view: ViewId;
  pendingEscalations: number;
  onNavigate: (view: ViewId) => void;
}

export default function Sidebar({ view, pendingEscalations, onNavigate }: Props) {
  return (
    <aside className="tl-sidebar" aria-label="Console sections">
      <div className="tl-side-brand">
        <svg className="tl-seal-mini" viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <circle cx="48" cy="48" r="42" stroke="currentColor" strokeWidth="4" />
          <path d="M30 42h36M30 52h36M40 68l7 7 13-15" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          <span className="tl-side-name">
            Trust<em>Ledger</em>
          </span>
          <span className="tl-side-tag">Autonomy Console</span>
        </span>
      </div>

      <nav className="tl-side-nav" aria-label="Primary">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`tl-side-link${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={item.hint}
              onClick={() => onNavigate(item.id)}
            >
              <Icon aria-hidden="true" />
              <span className="tl-side-label-text">{item.label}</span>
              {item.id === "escalations" && (
                <span
                  className={`tl-side-badge${pendingEscalations === 0 ? " is-zero" : ""}`}
                  aria-label={`${pendingEscalations} pending reviews`}
                >
                  {pendingEscalations}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="tl-side-foot">
        <strong>Governing rules</strong>
        Suggest only <em>→</em> draft for approval <em>→</em> auto-execute
        <br />
        One overturned outcome demotes by one level
        <br />
        Disputes above ₹50,000 always require human review
      </div>
    </aside>
  );
}
