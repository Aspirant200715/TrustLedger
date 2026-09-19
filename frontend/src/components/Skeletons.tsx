// Skeletons.tsx — instrument placeholders while the ledger loads.
import "./components.css";

export function LedgerSkeletons({ count = 5 }: { count?: number }) {
  return (
    <div className="tl-grid" aria-label="Loading ledger">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tl-card tl-skeleton-card" aria-hidden="true">
          <div className="tl-shimmer-row tl-shimmer-w60" />
          <div className="tl-shimmer-dial" />
          <div className="tl-shimmer-row tl-shimmer-w90" />
          <div className="tl-shimmer-row tl-shimmer-w75" />
        </div>
      ))}
    </div>
  );
}

export function QueueSkeleton() {
  return (
    <div className="tl-card tl-skeleton-card" aria-label="Loading docket" aria-hidden="true">
      <div className="tl-shimmer-row tl-shimmer-w40" />
      <div className="tl-shimmer-row tl-shimmer-w90" />
      <div className="tl-shimmer-row tl-shimmer-w75" />
    </div>
  );
}
