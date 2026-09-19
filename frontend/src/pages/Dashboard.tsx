// Dashboard.tsx — the TrustLedger command shell.
// Data orchestration + composition. All backend contact via src/api.ts
// (no .env — the API base is fixed by CONTRACT.md). Boot overlay
// choreographs first paint; Sidebar + TopBar frame four console views:
// Dashboard, Live Pipeline, Escalation Docket, Audit Logs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ApiError,
  getLedger,
  ingestDispute,
  listDisputes,
  listEscalations,
  reviewDispute,
  seedDemo,
} from "../api";
import type {
  DemoEvent,
  DisputeCategory,
  EscalationPacket,
  LedgerRecord,
  MergedDispute,
} from "../types";
import { TIER_LABEL, inr } from "../format";
import AuditLog from "../components/AuditLog";
import Boot from "../components/Boot";
import DemoTheater from "../components/DemoTheater";
import EscalationQueue, { type EscalationRow } from "../components/EscalationQueue";
import LedgerCard, { type OutcomeDot } from "../components/LedgerCard";
import Pipeline from "../components/Pipeline";
import Reveal from "../components/Reveal";
import Sidebar, { type ViewId } from "../components/Sidebar";
import { LedgerSkeletons } from "../components/Skeletons";
import TopBar, { type TopStats } from "../components/TopBar";
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

const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Autonomy Ledger",
    subtitle: "Category trust records, review queue and tier simulation",
  },
  pipeline: {
    title: "Live Pipeline",
    subtitle: "Ingestion, investigation, decision and settlement status",
  },
  escalations: {
    title: "Escalation Queue",
    subtitle: "Disputes awaiting human review and final determination",
  },
  audit: {
    title: "Audit Log",
    subtitle: "Timestamped record of every state-changing action",
  },
};

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
  const [view, setView] = useState<ViewId>("dashboard");
  const [ledgers, setLedgers] = useState<LedgerRecord[] | null>(null);
  const [disputes, setDisputes] = useState<MergedDispute[]>([]);
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
    const [ledgerRes, escRes, discRes] = await Promise.all([
      getLedger(),
      listEscalations(),
      listDisputes(),
    ]);
    setLedgers(ledgerRes.categories);
    setEscalations(escRes.escalations);
    setDisputes(discRes.disputes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    // Sequential polling: wait for each cycle to finish before scheduling the
    // next. Prevents request stacking when the backend is slow/unreachable and
    // lets the page reach network-idle between cycles.
    const tick = async () => {
      try {
        await refetch();
        if (!cancelled) setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err));
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refetch]);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      if (ingestTimer.current !== null) window.clearTimeout(ingestTimer.current);
    };
  }, []);

  const topStats = useMemo<TopStats | null>(() => {
    if (!ledgers) return null;
    const resolved = ledgers.reduce((n, l) => n + l.lifetime_total, 0);
    const correct = ledgers.reduce((n, l) => n + l.lifetime_correct, 0);
    return {
      resolved,
      overturned: ledgers.reduce((n, l) => n + l.lifetime_overturned, 0),
      accuracy: resolved === 0 ? "—" : `${((correct / resolved) * 100).toFixed(1)}%`,
      autoCount: ledgers.filter((l) => l.current_tier === "auto_execute").length,
      draftCount: ledgers.filter((l) => l.current_tier === "draft_for_approval").length,
      suggestCount: ledgers.filter((l) => l.current_tier === "suggest_only").length,
      totalCategories: ledgers.length,
    };
  }, [ledgers]);

  // Join escalation packets with dispute records so rows can show real
  // INR amounts + categories without a second backend call.
  const escRows = useMemo<EscalationRow[]>(() => {
    const byId = new Map(disputes.map((d) => [d.id, d]));
    return escalations.flatMap((p) => {
      const d = byId.get(p.dispute_id);
      if (!d) return [];
      return [{ packet: p, amount: d.amount, category: d.category }];
    });
  }, [escalations, disputes]);

  // Per-category micro-trend: the last 10 reviewed outcomes, newest first.
  const outcomesByCat = useMemo(() => {
    const map = new Map<DisputeCategory, OutcomeDot[]>();
    for (const cat of CATEGORIES) {
      const arr: OutcomeDot[] = [];
      for (const d of disputes) {
        if (d.category !== cat || !d.review_outcome) continue;
        arr.push(d.review_outcome === "confirmed_correct" ? "ok" : "overturned");
        if (arr.length >= 10) break;
      }
      map.set(cat, arr);
    }
    return map;
  }, [disputes]);

  const handleIngest = useCallback(async () => {
    setIngestPhase("working");
    try {
      const res = await ingestDispute(ingestCat === "random" ? null : ingestCat);
      const d = res.dispute.decision;
      setIngestPhase("done");
      ingestTimer.current = window.setTimeout(() => setIngestPhase("idle"), 1400);
      pushToast(
        `${res.dispute.category} · ${inr(res.dispute.amount)} → ${d?.final_path ?? "escalated"}${d?.stakes_override ? " · stakes override" : ""}`,
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
          `${outcome === "overturned" ? "Overturned" : "Confirmed"} ${disputeId.slice(0, 8)} → ${res.ledger_after.category} now ${TIER_LABEL[res.ledger_after.current_tier]}`,
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
      pushToast(`Simulation started for ${category} — processing 31 cases.`);
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
        pushToast(`Simulation complete for ${category}.`);
      } catch (err) {
        pushToast(errorText(err), "error");
      } finally {
        setDemoCat(null);
      }
    },
    [demoCat, refetch, pushToast],
  );

  const meta = VIEW_META[view];

  return (
    <div className="tl-app">
      {!booted && <Boot onDone={() => setBooted(true)} />}

      <div className="tl-shell">
        <Sidebar
          view={view}
          pendingEscalations={escalations.length}
          onNavigate={setView}
        />

        <div className="tl-main-col">
          <TopBar
            title={meta.title}
            subtitle={meta.subtitle}
            stats={topStats}
            online={online}
            loadError={Boolean(loadError)}
          />

          <main className="tl-main">
            {!online && (
              <div className="tl-offline" role="alert">
                <span>
                  <strong>No network connection.</strong> Displaying the last
                  synchronised state. Actions will fail until connectivity is
                  restored.
                </span>
              </div>
            )}
            {loadError && (
              <div className="tl-error" role="alert">
                <div>
                  <strong>Backend unavailable.</strong> {loadError}
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

            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                className="tl-dash-section"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                {view === "dashboard" && (
                  <>
                    <section className="tl-dash-hero">
                      <p className="tl-kicker">Dispute resolution governance</p>
                      <h1 className="tl-display">Autonomy ledger overview</h1>
                      <p className="tl-lede">
                        Each dispute category holds an independent autonomy
                        record. Confirmed outcomes advance a category toward
                        auto-execution; a single overturned outcome demotes it
                        by one level. Disputes above ₹50,000 are routed to human
                        review without exception.
                      </p>
                    </section>

                    {topStats && (
                      <dl className="tl-summary" aria-label="Portfolio summary">
                        <div className="tl-summary-cell">
                          <dt>Pending review</dt>
                          <dd>
                            {escalations.length}
                            <span className="tl-summary-sub">
                              awaiting a human decision
                            </span>
                          </dd>
                        </div>
                        <div className="tl-summary-cell">
                          <dt>Categories at auto</dt>
                          <dd>
                            {topStats.autoCount}/{topStats.totalCategories}
                            <span className="tl-summary-sub">
                              {topStats.draftCount} draft · {topStats.suggestCount} suggest only
                            </span>
                          </dd>
                        </div>
                        <div className="tl-summary-cell">
                          <dt>Overturned</dt>
                          <dd>
                            {topStats.overturned}
                            <span className="tl-summary-sub">
                              decisions reversed on review
                            </span>
                          </dd>
                        </div>
                        <div className="tl-summary-cell">
                          <dt>Disputes on record</dt>
                          <dd>
                            {disputes.length}
                            <span className="tl-summary-sub">
                              persisted pipeline records
                            </span>
                          </dd>
                        </div>
                      </dl>
                    )}

                    <section id="ledger" aria-labelledby="ledger-h" className="tl-anchor">
                      <Reveal>
                        <div className="tl-section-head">
                          <h2 id="ledger-h">Category autonomy records</h2>
                          <p>
                            Current tier, progress to the next threshold, and
                            recent outcomes for each of the five dispute
                            categories. Select a record to view its full tier
                            history.
                          </p>
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
                                outcomes={outcomesByCat.get(cat) ?? []}
                                index={i}
                                flashing={flashCat === cat}
                              />
                            );
                          })}
                        </div>
                      )}
                    </section>

                    <Reveal>
                      <section className="tl-panel" aria-labelledby="queue-h">
                        <div className="tl-section-head tl-section-head-split">
                          <div>
                            <h2 id="queue-h">Pending review</h2>
                            <p>
                              Each decision updates the category's autonomy
                              record immediately.
                            </p>
                          </div>
                          <span className="tl-count-badge" aria-label={`${escalations.length} pending`}>
                            {escalations.length} pending
                          </span>
                        </div>
                        <EscalationQueue
                          rows={escRows}
                          busyId={busyReviewId}
                          loading={ledgers === null}
                          onReview={handleReview}
                        />
                      </section>
                    </Reveal>

                    <Reveal>
                      <section className="tl-panel" id="simulation" aria-labelledby="demo-h">
                        <div className="tl-section-head">
                          <h2 id="demo-h">Tier progression simulation</h2>
                          <p>
                            Generates and processes 31 synthetic disputes
                            through the live pipeline to demonstrate promotion
                            and demotion behaviour. Results are written to the
                            backend and reflected in the records above.
                          </p>
                        </div>
                        <DemoTheater running={demoCat} events={demoLog} onRun={handleDemo} />
                      </section>
                    </Reveal>
                  </>
                )}

                {view === "pipeline" && (
                  <Reveal>
                    <section aria-labelledby="pipeline-h">
                      <div className="tl-section-head">
                        <h2 id="pipeline-h">Live pipeline</h2>
                        <p>
                          Disputes currently progressing through ingestion,
                          investigation, decision and settlement. Rows marked in
                          amber are awaiting human review.
                        </p>
                      </div>
                      <Pipeline
                        disputes={disputes}
                        loading={ledgers === null}
                        ingestCat={ingestCat}
                        ingestPhase={ingestPhase}
                        onIngestCat={setIngestCat}
                        onIngest={handleIngest}
                      />
                    </section>
                  </Reveal>
                )}

                {view === "escalations" && (
                  <Reveal>
                    <section aria-labelledby="esc-h">
                      <div className="tl-section-head tl-section-head-split">
                        <div>
                          <h2 id="esc-h">Escalation docket</h2>
                          <p>
                            Anything the agent is not yet trusted to do alone.
                            Tier caps, hard caps, and ₹50k+ stakes all land here.
                          </p>
                        </div>
                        <span className="tl-count-badge" aria-label={`${escalations.length} pending`}>
                          {escalations.length} pending
                        </span>
                      </div>
                      <EscalationQueue
                        rows={escRows}
                        busyId={busyReviewId}
                        loading={ledgers === null}
                        onReview={handleReview}
                      />
                    </section>
                  </Reveal>
                )}

                {view === "audit" && (
                  <Reveal>
                    <AuditLog disputes={disputes} ledgers={ledgers ?? []} loading={ledgers === null} />
                  </Reveal>
                )}
              </motion.div>
            </AnimatePresence>

            <footer className="tl-footer">
              <span>
                TrustLedger — tier progression: suggest only <em>→</em> draft for
                approval <em>→</em> auto-execute. A single overturned outcome
                demotes by one level.
              </span>
              <a
                className="tl-footer-link"
                href="/api/ledger"
                target="_blank"
                rel="noreferrer"
              >
                Ledger API
              </a>
            </footer>
          </main>
        </div>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}
