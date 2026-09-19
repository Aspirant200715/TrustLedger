// TopBar.tsx — sticky header with the three global stats:
// Total Resolved · Current Avg Accuracy · Active Tiers (per spec).
import "./layout.css";

export interface TopStats {
  resolved: number;
  overturned: number;
  accuracy: string;
  autoCount: number;
  draftCount: number;
  suggestCount: number;
  totalCategories: number;
}

interface Props {
  title: string;
  subtitle: string;
  stats: TopStats | null;
  online: boolean;
  loadError: boolean;
}

export default function TopBar({ title, subtitle, stats, online, loadError }: Props) {
  return (
    <header className="tl-topbar">
      <div className="tl-topbar-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {stats && (
        <dl className="tl-topbar-stats" aria-label="Global stats">
          <div className="tl-gstat">
            <dt>Total resolved</dt>
            <dd>{stats.resolved}</dd>
          </div>
          <div className="tl-gstat">
            <dt>Avg accuracy</dt>
            <dd>
              <span className={`tl-gstat-acc${stats.accuracy === "—" ? " is-cold" : ""}`}>
                {stats.accuracy}
              </span>
            </dd>
          </div>
          <div className="tl-gstat">
            <dt>Active tiers</dt>
            <dd className="tl-tier-tally" aria-label="Tier distribution">
              <i className="t-auto">
                <b aria-hidden="true" /> {stats.autoCount}
              </i>
              <i className="t-draft">
                <b aria-hidden="true" /> {stats.draftCount}
              </i>
              <i className="t-suggest">
                <b aria-hidden="true" /> {stats.suggestCount}
              </i>
            </dd>
          </div>
        </dl>
      )}

      <div className="tl-live" role="status">
        <span className={`tl-live-dot${loadError ? " is-down" : ""}`} aria-hidden="true" />
        {loadError ? "backend unreachable" : online ? "live · 3s sync" : "offline"}
      </div>
    </header>
  );
}
