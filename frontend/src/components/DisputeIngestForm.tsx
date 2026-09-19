// DisputeIngestForm.tsx — manual case intake.
// Centered single-column form with clear top labels; a full-width primary
// submit; and a real-time 3-step timeline (Ingested → Investigating →
// Decided) that animates while the governed pipeline runs, then a decision
// card with the evidence trail.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, LoaderCircle, ShieldAlert } from "lucide-react";
import { ingestDispute } from "../api";
import type { DisputeCategory, IngestRequest, IngestResponse } from "../types";
import { CATEGORY_LABEL, TIER_LABEL, inr } from "../format";
import "./components.css";

const CATEGORIES = Object.entries(CATEGORY_LABEL) as [DisputeCategory, string][];
const STEPS = ["Ingested", "Investigating", "Decided"];

interface Props {
  onNotice: (message: string, tone?: "ok" | "error") => void;
}

export default function DisputeIngestForm({ onNotice }: Props) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DisputeCategory>("upi_debited_not_credited");
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [ticket, setTicket] = useState("");
  // step: -1 idle · 1..2 running · 3 done (0 reserved for "started")
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: IngestRequest) => ingestDispute(payload),
    onSuccess: async (data) => {
      setStep(3);
      setResult(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["disputes"] }),
        queryClient.invalidateQueries({ queryKey: ["escalations"] }),
      ]);
      if (data.dispute.llm_fallback) {
        onNotice("AI Brain is offline. Escalating to human review automatically.", "error");
      } else {
        onNotice(`Dispute ${data.dispute.id.slice(0, 8)} processed successfully.`);
      }
    },
    onError: (error) => onNotice(String(error), "error"),
  });

  const running = mutation.isPending;

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setStep((s) => (s < 2 ? 2 : s)), 850);
    return () => window.clearTimeout(t);
  }, [running]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    setEvidenceOpen(false);
    setStep(1);
    mutation.mutate({
      category,
      amount: Number(amount),
      utr: utr.trim(),
      ticket_text: ticket.trim(),
    });
  };

  const dispute = result?.dispute;
  const investigation = dispute?.investigation_result;
  const decision = dispute?.decision;

  return (
    <section className="tl-panel tl-ingest-panel" aria-labelledby="manual-ingest-heading">
      <div className="tl-ingest-wrap">
        <div className="tl-ingest-head">
          <p className="tl-kicker">Manual case intake</p>
          <h2 id="manual-ingest-heading">Investigate a customer dispute</h2>
          <p>
            Submit a live case to the governed pipeline. The entered values are
            persisted exactly as provided.
          </p>
        </div>

        <form className="tl-ingest-form" onSubmit={submit}>
          <label>
            <span>Category</span>
            <select
              className="field"
              value={category}
              onChange={(e) => setCategory(e.target.value as DisputeCategory)}
            >
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Amount (INR)</span>
            <div className="tl-money-field">
              <b aria-hidden="true">₹</b>
              <input
                className="field"
                type="number"
                min="0.01"
                max="10000000"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="12,500.00"
              />
            </div>
          </label>

          <label>
            <span>UTR / transaction reference</span>
            <input
              className="field tl-mono"
              minLength={4}
              maxLength={64}
              required
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="324761908415"
            />
          </label>

          <label className="tl-ingest-ticket">
            <span>Customer ticket</span>
            <textarea
              className="field"
              minLength={10}
              maxLength={4000}
              required
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="Customer claims money was debited but the merchant was not credited…"
            />
          </label>

          <button className="btn btn-primary tl-ingest-submit" disabled={running} type="submit">
            {running ? (
              <>
                <LoaderCircle className="tl-spin-icon" /> Investigating…
              </>
            ) : (
              "Investigate & Decide"
            )}
          </button>
        </form>

        <AnimatePresence>
          {(running || result) && (
            <motion.div
              className="tl-live-workflow"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <ol className="tl-stepper-3" aria-label="Pipeline progress">
                {STEPS.map((label, index) => {
                  const done = result !== null || (running && index < step);
                  const active = running && index === step;
                  return (
                    <li
                      key={label}
                      className={`tl-s3-step${done ? " is-done" : ""}${active ? " is-active" : ""}`}
                    >
                      <span className="tl-s3-dot">
                        {done ? (
                          <Check />
                        ) : active ? (
                          <LoaderCircle className="tl-spin-icon" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="tl-s3-label">{label}</span>
                    </li>
                  );
                })}
              </ol>

              {result && dispute && (
                <div className={`tl-decision-result${dispute.llm_fallback ? " is-warning" : ""}`}>
                  <div className="tl-result-head">
                    <div>
                      <small>
                        Dispute <code>{dispute.id}</code>
                      </small>
                      <h3>{decision?.proposed_action.replaceAll("_", " ") ?? "Escalate"}</h3>
                    </div>
                    <span className={`badge badge-${result.ledger_after.current_tier}`}>
                      {TIER_LABEL[result.ledger_after.current_tier]}
                    </span>
                  </div>

                  {dispute.llm_fallback && (
                    <p className="tl-ai-warning">
                      <ShieldAlert /> AI provider unavailable — safely escalated
                      without execution.
                    </p>
                  )}

                  <dl className="tl-result-grid">
                    <div>
                      <dt>Amount</dt>
                      <dd>{inr(dispute.amount)}</dd>
                    </div>
                    <div>
                      <dt>Final path</dt>
                      <dd>{decision?.final_path.replaceAll("_", " ") ?? "escalate"}</dd>
                    </div>
                    <div>
                      <dt>Investigation</dt>
                      <dd>{investigation?.reasoning_summary ?? "Human investigation required"}</dd>
                    </div>
                  </dl>

                  <button
                    className="tl-evidence-toggle"
                    type="button"
                    onClick={() => setEvidenceOpen((value) => !value)}
                    aria-expanded={evidenceOpen}
                  >
                    Evidence trail
                    <span>{investigation?.evidence.length ?? 0} items</span>
                    <ChevronDown className={evidenceOpen ? "is-open" : ""} />
                  </button>

                  <AnimatePresence initial={false}>
                    {evidenceOpen && (
                      <motion.pre
                        className="tl-evidence-json"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                      >
                        {JSON.stringify(dispute, null, 2)}
                      </motion.pre>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
