// Dashboard.tsx — TrustLedger main demo screen (Phase 9).
//
// Reads CONTRACT.md + src/types.ts + src/api.ts before modifying.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getLedger,
  ingestDispute,
  listEscalations,
  reviewDispute,
  seedDemo,
} from "../api";
import type {
  DemoEvent,
  DisputeCategory,
  EscalationPacket,
  LedgerRecord,
  TierLevel,
} from "../types";
import "./Dashboard.css";

const CATEGORIES: DisputeCategory[] = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];

const POLL_MS = 3000;
const DEMO_STEP_DELAY_MS = 300;

function nextThreshold(tier: TierLevel): number | null {
  if (tier === "suggest_only") return 15;
  if (tier === "draft_for_approval") return 30;
  return null; // auto_execute: nothing above
}

function lifetimeAccuracy(rec: LedgerRecord): string {
  if (rec.lifetime_total === 0) return "—";
  return `${((rec.lifetime_correct / rec.lifetime_total) * 100).toFixed(1)}%`;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? `${err.error}: ${err.detail}` : String(err);
}

interface Toast {
  text: string;
  tone: "ok" | "error";
}

export default function Dashboard() {
  const [ledgers, setLedgers] = useState<LedgerRecord[] | null>(null);
  const [escalations, setEscalations] = useState<EscalationPacket[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ingestCat, setIngestCat] = useState<DisputeCategory | "random">("random");
  const [ingesting, setIngesting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);
  const [demoCat, setDemoCat] = useState<DisputeCategory | null>(null); // running demo
  const [demoLog, setDemoLog] = useState<DemoEvent[]>([]);
  const [flashCat, setFlashCat] = useState<DisputeCategory | null>(null);

  const toastTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    setToast({ text, tone });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const refetch = useCallback(async () => {
    const [ledgerRes, escRes] = await Promise.all([getLedger(), listEscalations()]);
    setLedgers(ledgerRes.categories);
    setEscalations(escRes.escalations);
  }, []);

  // Initial load + live polling every 3s (cleanup on unmount).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await refetch();
        if (!cancelled) setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err));
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refetch]);

  // Cleanup pending toast/flash timers on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  // Auto-scroll the demo log feed as events append.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [demoLog]);

  const ledgerByCat = useCallback(
    (cat: DisputeCategory): LedgerRecord | undefined =>
      ledgers?.find((l) => l.category === cat),
    [ledgers],
  );

  const handleIngest = useCallback(async () => {
    setIngesting(true);
    try {
      const res = await ingestDispute(ingestCat === "random" ? null : ingestCat);
      const d = res.dispute.decision;
      showToast(
        `Ingested ${res.dispute.id.slice(0, 8)} (${res.dispute.category}, ₹${res.dispute.amount}) → final_path=${d?.final_path ?? "?"}${d?.stakes_override ? " · STAKES OVERRIDE" : ""}`,
      );
      await refetch();
    } catch (err) {
      showToast(errorText(err), "error");
    } finally {
      setIngesting(false);
    }
  }, [ingestCat, refetch, showToast]);

  const handleReview = useCallback(
    async (disputeId: string, outcome: "confirmed_correct" | "overturned") => {
      setBusyReviewId(disputeId);
      try {
        const res = await reviewDispute(disputeId, outcome);
        showToast(
          `Reviewed ${disputeId.slice(0, 8)} as ${outcome} → ${res.ledger_after.category} now ${res.ledger_after.current_tier}`,
        );
        await refetch();
      } catch (err) {
        showToast(errorText(err), "error");
      } finally {
        setBusyReviewId(null);
      }
    },
    [refetch, showToast],
  );

  const handleDemo = useCallback(
    async (category: DisputeCategory) => {
      if (demoCat !== null) return; // one demo at a time
      setDemoCat(category);
      setDemoLog([]);
      showToast(`Demo sequence started for ${category} (31 steps)…`);
      try {
        const { events } = await seedDemo(category);
        let prevTier: TierLevel | null = null;
        for (const e of events) {
          await new Promise((r) => setTimeout(r, DEMO_STEP_DELAY_MS));
          setDemoLog((prev) => [...prev, e]);
          if (prevTier !== null && e.tier_after !== prevTier) {
            setFlashCat(category);
            if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
            flashTimer.current = window.setTimeout(() => setFlashCat(null), 2500);
          }
          prevTier = e.tier_after;
        }
        await refetch();
        showToast(`Demo finished for ${category} — watch the card above.`);
      } catch (err) {
        showToast(errorText(err), "error");
      } finally {
        setDemoCat(null);
      }
    },
    [demoCat, refetch, showToast],
  );

  return (
    <div className="tl-root">
      <header className="tl-header">
        <div>
          <h1>
            Trust<span className="accent">Ledger</span>
          </h1>
          <p>AI teammate that earns the right to act with real money.</p>
        </div>
        <div className="tl-live">
          <span className="tl-dot" />
          live · polling ledger every 3s
        </div>
      </header>

      {loadError && (
        <div className="tl-error-banner">
          Backend unreachable: {loadError} — is uvicorn running on :8000?
        </div>
      )}

      <h2 className="tl-section-title">Trust ledger — autonomy per category</h2>
      {!ledgers ? (
        <p className="tl-empty">Loading ledger…</p>
      ) : (
        <div className="tl-grid">
          {CATEGORIES.map((cat) => {
            const rec = ledgerByCat(cat);
            if (!rec) return null; // backend guarantees all 5; skip defensively
            const threshold = nextThreshold(rec.current_tier);
            const pct =
              threshold === null
                ? 100
                : Math.min(100, (rec.in_tier_correct / threshold) * 100);
            return (
              <div
                key={cat}
                className={`tl-card${flashCat === cat ? " tl-flash" : ""}`}
              >
                <div className="tl-card-top">
                  <span className="tl-cat">{cat}</span>
                  <span className={`tl-badge ${rec.current_tier}`}>
                    {rec.current_tier}
                  </span>
                </div>
                <div className="tl-progress-label">
                  <span>
                    in-tier {rec.in_tier_correct}
                    {threshold === null ? " (max tier)" : ` / ${threshold}`}
                  </span>
                  <span>{threshold === null ? "MAX" : `${Math.round(pct)}%`}</span>
                </div>
                <div className="tl-bar">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="tl-meta">
                  <span>
                    lifetime accuracy: <strong>{lifetimeAccuracy(rec)}</strong> (
                    {rec.lifetime_correct}/{rec.lifetime_total}
                    {rec.lifetime_overturned > 0 &&
                      `, ${rec.lifetime_overturned} overturned`}
                    )
                  </span>
                  {rec.hard_capped && <span>hard-capped: max draft_for_approval</span>}
                  <span>
                    tier changes: <strong>{rec.tier_history.length}</strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="tl-section-title">Ingest test dispute</h2>
      <div className="tl-row">
        <select
          className="tl-select"
          value={ingestCat}
          onChange={(e) => setIngestCat(e.target.value as DisputeCategory | "random")}
          aria-label="Dispute category"
        >
          <option value="random">random</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="tl-btn solid" onClick={handleIngest} disabled={ingesting}>
          {ingesting ? "Ingesting…" : "Ingest test dispute"}
        </button>
      </div>
      {toast && <div className={`tl-toast${toast.tone === "error" ? " error" : ""}`}>{toast.text}</div>}

      <h2 className="tl-section-title">
        Escalation queue ({escalations.length} pending)
      </h2>
      {escalations.length === 0 ? (
        <p className="tl-empty">Queue empty — nothing awaiting human review.</p>
      ) : (
        <div className="tl-esc-list">
          {escalations.map((p) => (
            <div key={p.dispute_id} className={`tl-esc ${p.escalation_reason}`}>
              <span className="reason">{p.escalation_reason}</span>
              <p>{p.intent_summary}</p>
              <p className="tl-meta">id {p.dispute_id.slice(0, 8)}…</p>
              <div className="tl-esc-actions">
                <button
                  className="tl-btn"
                  disabled={busyReviewId === p.dispute_id}
                  onClick={() => handleReview(p.dispute_id, "confirmed_correct")}
                >
                  Confirm correct
                </button>
                <button
                  className="tl-btn danger"
                  disabled={busyReviewId === p.dispute_id}
                  onClick={() => handleReview(p.dispute_id, "overturned")}
                >
                  Mark overturned
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="tl-section-title">Run demo sequence (centerpiece)</h2>
      <div className="tl-row">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className="tl-btn"
            disabled={demoCat !== null}
            onClick={() => handleDemo(c)}
            title={`31-step climb-then-fall for ${c}`}
          >
            {demoCat === c ? "Running…" : `Demo: ${c}`}
          </button>
        ))}
      </div>
      {demoLog.length > 0 && (
        <div className="tl-demo-log" ref={logRef} aria-live="polite">
          {demoLog.map((e) => {
            const cls = e.message.includes("promoted")
              ? "promote"
              : e.message.includes("demoted")
                ? "demote"
                : "info";
            return (
              <span key={e.step} className={cls}>
                [{e.step}/31] {e.message}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
