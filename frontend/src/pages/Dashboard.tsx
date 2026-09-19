// Dashboard.tsx — the TrustLedger command shell.
// Data orchestration + composition. All backend contact via src/api.ts.
// Boot overlay choreographs first paint; Sidebar + TopBar frame four console
// views: Dashboard, Live Pipeline, Escalation Docket, Audit Logs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Inbox, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import {
  ApiError,
  getHealth,
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
} from "../types";
import { TIER_LABEL, inr } from "../format";
import AuditLog from "../components/AuditLog";
import Boot from "../components/Boot";
import DemoTheater from "../components/DemoTheater";
import DisputeIngestForm from "../components/DisputeIngestForm";
import EscalationQueue, { type EscalationRow } from "../components/EscalationQueue";
import LedgerCard, { type OutcomeDot } from "../components/LedgerCard";
import Pipeline from "../components/Pipeline";
import Reveal from "../components/Reveal";
import Sidebar, { type ViewId } from "../components/Sidebar";
import { LedgerSkeletons } from "../components/Skeletons";
import TopBar from "../components/TopBar";
import Toasts, { type Toast } from "../components/Toasts";
import "./Dashboard.css";

const CATEGORIES: DisputeCategory[] = [
  "duplicate_charge",
  "upi_debited_not_credited",
  "refund_delay",
  "merchant_settlement_mismatch",
  "fraud_flag",
];

const DEMO_STEP_DELAY_MS = 320;

type IngestPhase = "idle" | "working" | "done";

const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Category trust records, review queue and tier simulation",
  },
  pipeline: {
    title: "Live Pipeline",
    subtitle: "Ingestion, investigation, decision and settlement status",
  },
  escalations: {
    title: "Escalation Docket",
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
  const [ingestCat, setIngestCat] = useState<DisputeCategory | "random">("random");
  const [ingestPhase, setIngestPhase] = useState<IngestPhase>("idle");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);
  const [demoCat, setDemoCat] = useState<DisputeCategory | null>(null);
  const [demoLog, setDemoLog] = useState<DemoEvent[]>([]);
  const [flashCat, setFlashCat] = useState<DisputeCategory | null>(null);
  const online = useOnline();
  const queryClient = useQueryClient();
  const ledgerQuery = useQuery({ queryKey: ["ledger"], queryFn: getLedger, refetchInterval: 3_000 });
  const disputesQuery = useQuery({ queryKey: ["disputes"], queryFn: listDisputes, refetchInterval: 3_000 });
  const escalationsQuery = useQuery({ queryKey: ["escalations"], queryFn: listEscalations, refetchInterval: 3_000 });
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 15_000 });
  const ledgers = ledgerQuery.data?.categories ?? null;
  const disputes = useMemo(() => disputesQuery.data?.disputes ?? [], [disputesQuery.data]);
  const escalations = useMemo(() => escalationsQuery.data?.escalations ?? [], [escalationsQuery.data]);
  const firstQueryError = ledgerQuery.error ?? disputesQuery.error ?? escalationsQuery.error ?? healthQuery.error;
  const loadError = firstQueryError ? errorText(firstQueryError) : null;

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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["escalations"] }),
      queryClient.invalidateQueries({ queryKey: ["disputes"] }),
      queryClient.invalidateQueries({ queryKey: ["health"] }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      if (ingestTimer.current !== null) window.clearTimeout(ingestTimer.current);
    };
  }, []);

  const topStats = useMemo(() => {
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
            online={online}
            loadError={Boolean(loadError)}
            pending={escalations.length}
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
                  onClick={() => void refetch()}
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
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
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
                      <div className="tl-kpis" aria-label="Portfolio summary">
                        <div className="tl-kpi">
                          <span className="tl-kpi-icon blue" aria-hidden="true"><Inbox /></span>
                          <div>
                            <p className="tl-kpi-num">{escalations.length}</p>
                            <p className="tl-kpi-label">Pending review · awaiting a human decision</p>
                          </div>
                        </div>
                        <div className="tl-kpi">
                          <span className="tl-kpi-icon emerald" aria-hidden="true"><ShieldCheck /></span>
                          <div>
                            <p className="tl-kpi-num">{topStats.autoCount}/{topStats.totalCategories}</p>
                            <p className="tl-kpi-label">Categories at auto · {topStats.draftCount} draft · {topStats.suggestCount} suggest only</p>
                          </div>
                        </div>
                        <div className="tl-kpi">
                          <span className="tl-kpi-icon red" aria-hidden="true"><RotateCcw /></span>
                          <div>
                            <p className="tl-kpi-num">{topStats.overturned}</p>
                            <p className="tl-kpi-label">Overturned · decisions reversed on review</p>
                          </div>
                        </div>
                        <div className="tl-kpi">
                          <span className="tl-kpi-icon amber" aria-hidden="true"><FileText /></span>
                          <div>
                            <p className="tl-kpi-num">{disputes.length}</p>
                            <p className="tl-kpi-label">Disputes on record · persisted pipeline records</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <Reveal>
                      <DisputeIngestForm onNotice={pushToast} />
                    </Reveal>

                    <section id="ledger" aria-labelledby="ledger-h" className="tl-anchor">
                      <Reveal>
                        <div className="tl-section-head tl-section-head-split">
                          <div>
                            <h2 id="ledger-h">Trust Matrix</h2>
                            <p>
                              Current tier, accuracy and last-ten outcomes for
                              each governed dispute category.
                            </p>
                          </div>
                          <button className="btn btn-sm" type="button" onClick={() => void refetch()} disabled={ledgerQuery.isFetching}>
                            <RefreshCw className={ledgerQuery.isFetching ? "tl-spin-icon" : ""} /> Refresh ledger
                          </button>
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
                    <section className="tl-panel" aria-labelledby="pipeline-h">
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
                    <section className="tl-panel" aria-labelledby="esc-h">
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
              <span className="tl-footer-link">Live data via Enter Cloud backend</span>
            </footer>
          </main>
        </div>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}
