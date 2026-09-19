// Dashboard.tsx — the Clearing House floor.
// Data orchestration + composition. All backend contact via src/api.ts;
// contracts unchanged. Boot overlay choreographs first paint.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "../types";
import Boot from "../components/Boot";
import DemoTheater from "../components/DemoTheater";
import EscalationQueue from "../components/EscalationQueue";
import LedgerCard from "../components/LedgerCard";
import Reveal from "../components/Reveal";
import { LedgerSkeletons } from "../components/Skeletons";
import Toasts, { type Toast } from "../components/Toasts";
import "./Dashboard.css";

const CATEGORIES: DisputeCategory[] = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];

const POLL_MS = 3000;
const DEMO_STEP_DELAY_MS = 320;

type IngestPhase = "idle" | "working" | "done";

function errorText(err: unknown): string {
  return err instanceof ApiError ? `${err.error}: ${err.detail}` : String(err);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export default function Dashboard() {
  const [booted, setBooted] = useState(false);
  const [ledgers, setLedgers] = useState<LedgerRecord[] | null>(null);
  const [escalations, setEscalations] = useState<EscalationPacket[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ingestCat, setIngestCat] = useState<DisputeCategory | "random">("random");
  const [ingestPhase, setIngestPhase] = useState<IngestPhase>("idle");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);
  const [demoCat, setDemoCat] = useState<DisputeCategory | null>(null);
  const [demoLog, setDemoLog] = useState<DemoEvent[]>([]);
  const [flashCat, setFlashCat] = useState<DisputeCategory | null>(null);
  const online = useOnline();

  const toastId = useRef(0);
  const flashTimer = useRef<number | null>(null);
  const ingestTimer = useRef<number | null>(null);

  const pushToast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  const refetch = useCallback(async () => {
    const [ledgerRes, escRes] = await Promise.all([getLedger(), listEscalations()]);
    setLedgers(ledgerRes.categories);
    setEscalations(escRes.escalations);
  }, []);

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

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      if (ingestTimer.current !== null) window.clearTimeout(ingestTimer.current);
    };
  }, []);

  const stats = useMemo(() => {
    if (!ledgers) return null;
    const reviews = ledgers.reduce((n, l) => n + l.lifetime_total, 0);
    const auto = ledgers.filter((l) => l.current_tier === "auto_execute").length;
    const correct = ledgers.reduce((n, l) => n + l.lifetime_correct, 0);
    return {
      reviews,
      auto,
      pending: escalations.length,
      accuracy: reviews === 0 ? "—" : `${((correct / reviews) * 100).toFixed(1)}%`,
    };
  }, [ledgers, escalations.length]);

  const handleIngest = useCallback(async () => {
    setIngestPhase("working");
    try {
      const res = await ingestDispute(ingestCat === "random" ? null : ingestCat);
      const d = res.dispute.decision;
      setIngestPhase("done");
      ingestTimer.current = window.setTimeout(() => setIngestPhase("idle"), 1400);
      pushToast(
        `${res.dispute.category} · ₹${res.dispute.amount} → ${d?.final_path ?? "escalated"}${d?.stakes_override ? " · stakes override" : ""}`,
      );
      await refetch();
    } catch (err) {
      setIngestPhase("idle");
      pushToast(errorText(err), "error");
    }
  }, [ingestCat, refetch, pushToast]);

  const handleReview = useCallback(
    async (disputeId: string, outcome: "confirmed_correct" | "overturned") => {
      setBusyReviewId(disputeId);
      try {
        const res = await reviewDispute(disputeId, outcome);
        pushToast(
          `${outcome === "overturned" ? "Overturned" : "Confirmed"} ${disputeId.slice(0, 8)} → ${res.ledger_after.category} now ${res.ledger_after.current_tier.replaceAll("_", " ")}`,
        );
        await refetch();
      } catch (err) {
        pushToast(errorText(err), "error");
      } finally {
        setBusyReviewId(null);
      }
    },
    [refetch, pushToast],
  );

  const handleDemo = useCallback(
    async (category: DisputeCategory) => {
      if (demoCat !== null) return;
      setDemoCat(category);
      setDemoLog([]);
      pushToast(`Replaying ${category} — 31 cases, watch its instrument.`);
      try {
        const { events } = await seedDemo(category);
        let prev: string | null = null;
        for (const e of events) {
          await new Promise((r) => setTimeout(r, DEMO_STEP_DELAY_MS));
          setDemoLog((log) => [...log, e]);
          if (prev !== null && e.tier_after !== prev) {
            setFlashCat(category);
            if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
            flashTimer.current = window.setTimeout(() => setFlashCat(null), 2600);
          }
          prev = e.tier_after;
        }
        await refetch();
        pushToast(`Replay complete — ${category} held its final tier.`);
      } catch (err) {
        pushToast(errorText(err), "error");
      } finally {
        setDemoCat(null);
      }
    },
    [demoCat, refetch, pushToast],
  );

  return (
    <div className="tl-app">
      {!booted && <Boot onDone={() => setBooted(true)} />}

      <div className="tl-backdrop" aria-hidden="true">
        <span className="tl-aurora tl-aurora-a" />
        <span className="tl-aurora tl-aurora-b" />
        <span className="tl-grid-overlay" />
        <span className="tl-grain" />
      </div>

      <header className="tl-topbar">
        <div className="tl-brand">
          <span className="tl-mark" aria-hidden="true">
            <i />
          </span>
          <span className="tl-brand-name">
            Trust<em>Ledger</em>
          </span>
          <span className="tl-env-badge">clearing house</span>
        </div>
        <nav className="tl-nav" aria-label="Console sections">
          <a href="#ledger">Ledger</a>
          <a href="#desk">Desk</a>
          <a href="#theater">Replay</a>
        </nav>
        <div className="tl-live" role="status">
          <span className="tl-live-dot" aria-hidden="true" />
          {loadError ? "backend unreachable" : "live · 3s sync"}
        </div>
      </header>

      {booted && (
      <main className="tl-main">
        {!online && (
          <div className="tl-offline anim-pop" role="alert">
            <strong>You're offline.</strong> Showing the last synced state —
            actions will fail until the connection returns.
          </div>
        )}

        <section className="tl-hero anim-rise">
          <p className="tl-kicker">Earned autonomy · real money · human override</p>
          <h1 className="tl-display">
            Every credit of trust,
            <br />
            <span className="tl-display-accent">settled in public.</span>
          </h1>
          <p className="tl-lede">
            Each dispute category keeps its own ledger of autonomy. Correct
            verdicts promote it toward auto-execution; one overturn demotes it.
            Anything over ₹50,000 goes to a human — always.
          </p>
          {stats && (
            <dl className="tl-stats">
              <div className="tl-stat">
                <dt>Cases settled</dt>
                <dd className="tl-num">{stats.reviews}</dd>
              </div>
              <div className="tl-stat">
                <dt>On auto-execute</dt>
                <dd className="tl-num">
                  {stats.auto}
                  <span className="tl-dim">/5</span>
                </dd>
              </div>
              <div className="tl-stat">
                <dt>Awaiting humans</dt>
                <dd className="tl-num">{stats.pending}</dd>
              </div>
              <div className="tl-stat">
                <dt>Fleet accuracy</dt>
                <dd className="tl-num">{stats.accuracy}</dd>
              </div>
            </dl>
          )}
        </section>

        {loadError && (
          <div className="tl-error anim-pop" role="alert">
            <div>
              <strong>Backend unreachable.</strong> {loadError}
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setLoadError(null);
                refetch().catch((e: unknown) => setLoadError(errorText(e)));
              }}
            >
              Retry
            </button>
          </div>
        )}

        <section id="ledger" aria-labelledby="ledger-h" className="tl-anchor">
          <Reveal>
            <div className="tl-section-head">
              <h2 id="ledger-h">The autonomy ledger</h2>
              <p>Five categories, five balances of trust. Accuracy promotes; overturns demote.</p>
            </div>
          </Reveal>
          {!ledgers ? (
            <LedgerSkeletons />
          ) : (
            <div className="tl-grid">
              {CATEGORIES.map((cat, i) => {
                const rec = ledgers.find((l) => l.category === cat);
                if (!rec) return null;
                return (
                  <LedgerCard
                    key={cat}
                    record={rec}
                    index={i}
                    flashing={flashCat === cat}
                  />
                );
              })}
            </div>
          )}
        </section>

        <div className="tl-ops" id="desk">
          <Reveal>
            <section className="tl-panel" aria-labelledby="ingest-h">
              <div className="tl-section-head">
                <h2 id="ingest-h">Intake desk</h2>
                <p>File a synthetic dispute through the full pipeline.</p>
              </div>
              <div className="tl-ingest-row">
                <select
                  className="field"
                  value={ingestCat}
                  onChange={(e) => setIngestCat(e.target.value as DisputeCategory | "random")}
                  aria-label="Dispute category"
                >
                  <option value="random">Random category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`btn btn-primary${ingestPhase === "done" ? " is-done" : ""}`}
                  onClick={handleIngest}
                  disabled={ingestPhase !== "idle"}
                >
                  {ingestPhase === "working" ? (
                    <>
                      <span className="tl-spinner" aria-hidden="true" /> Clearing…
                    </>
                  ) : ingestPhase === "done" ? (
                    "✓ Filed"
                  ) : (
                    "File dispute"
                  )}
                </button>
              </div>
              <p className="tl-hint">
                Roughly one draw in twenty exceeds ₹50,000 and trips the{" "}
                <em>stakes override</em> — file until one lands to watch the
                safety rail fire.
              </p>
            </section>
          </Reveal>

          <Reveal delay={90}>
            <section className="tl-panel" aria-labelledby="queue-h">
              <div className="tl-section-head tl-section-head-split">
                <div>
                  <h2 id="queue-h">Review docket</h2>
                  <p>Confirm or overturn — every verdict moves a tier.</p>
                </div>
                <span className="tl-count-badge" aria-label={`${escalations.length} pending`}>
                  {escalations.length}
                </span>
              </div>
              <EscalationQueue
                packets={escalations}
                busyId={busyReviewId}
                loading={ledgers === null}
                onReview={handleReview}
              />
            </section>
          </Reveal>
        </div>

        <Reveal>
          <section className="tl-panel tl-theater-panel" id="theater" aria-labelledby="demo-h">
            <div className="tl-section-head">
              <h2 id="demo-h">Replay deck</h2>
              <p>
                The centerpiece: a 31-case climb — 15 to <em>draft</em>, 15
                toward <em>auto</em> — then a seeded overturn that demotes live.
              </p>
            </div>
            <DemoTheater running={demoCat} events={demoLog} onRun={handleDemo} />
          </section>
        </Reveal>

        <footer className="tl-footer">
          <span>
            TrustLedger · suggest <em>→</em> draft <em>→</em> auto · overturns
            demote exactly one level
          </span>
          <a
            className="tl-footer-link"
            href="http://localhost:8000/api/ledger"
            target="_blank"
            rel="noreferrer"
          >
            Raw ledger JSON ↗
          </a>
        </footer>
      </main>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
