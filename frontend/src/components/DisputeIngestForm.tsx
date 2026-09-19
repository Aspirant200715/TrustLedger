import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, LoaderCircle, ShieldAlert } from "lucide-react";
import { ingestDispute } from "../api";
import type { DisputeCategory, IngestRequest, IngestResponse } from "../types";
import { CATEGORY_LABEL, TIER_LABEL, inr } from "../format";
import "./components.css";

const CATEGORIES = Object.entries(CATEGORY_LABEL) as [DisputeCategory, string][];
const STEPS = ["Ingesting", "Investigating", "Decision", "Trust check", "Final path"];

interface Props {
  onNotice: (message: string, tone?: "ok" | "error") => void;
}

export default function DisputeIngestForm({ onNotice }: Props) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DisputeCategory>("upi_debited_not_credited");
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [ticket, setTicket] = useState("");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: IngestRequest) => ingestDispute(payload),
    onSuccess: async (data) => {
      setResult(data);
      setStep(4);
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

  useEffect(() => {
    if (!mutation.isPending) return;
    const timer = window.setInterval(() => setStep((value) => Math.min(3, value + 1)), 750);
    return () => window.clearInterval(timer);
  }, [mutation.isPending]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    setEvidenceOpen(false);
    setStep(0);
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
      <div className="tl-section-head">
        <p className="tl-kicker">Manual case intake</p>
        <h2 id="manual-ingest-heading">Investigate a customer dispute</h2>
        <p>Submit a live case to the governed pipeline. The entered values are persisted exactly as provided.</p>
      </div>

      <form className="tl-ingest-form" onSubmit={submit}>
        <label>
          <span>Category</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory)}>
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Amount (INR)</span>
          <div className="tl-money-field"><b>₹</b><input className="field" type="number" min="0.01" max="10000000" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,500.00" /></div>
        </label>
        <label>
          <span>UTR / transaction reference</span>
          <input className="field tl-mono" minLength={4} maxLength={64} required value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="324761908415" />
        </label>
        <label className="tl-ingest-ticket">
          <span>Customer ticket</span>
          <textarea className="field" minLength={10} maxLength={4000} required value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Customer claims money was debited but the merchant was not credited…" />
        </label>
        <button className="btn btn-primary tl-ingest-submit" disabled={mutation.isPending} type="submit">
          {mutation.isPending ? <><LoaderCircle className="tl-spin-icon" /> Investigating…</> : "Investigate & Decide"}
        </button>
      </form>

      <AnimatePresence>
        {(mutation.isPending || result) && (
          <motion.div className="tl-live-workflow" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ol className="tl-workflow-steps" aria-label="Pipeline progress">
              {STEPS.map((label, index) => (
                <li key={label} className={`${index < step || result ? "is-done" : ""} ${index === step && mutation.isPending ? "is-active" : ""}`}>
                  <span>{index < step || result ? <Check /> : index === step && mutation.isPending ? <LoaderCircle className="tl-spin-icon" /> : index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>

            {result && dispute && (
              <div className={`tl-decision-result${dispute.llm_fallback ? " is-warning" : ""}`}>
                <div className="tl-result-head">
                  <div>
                    <small>Dispute <code>{dispute.id}</code></small>
                    <h3>{decision?.proposed_action.replaceAll("_", " ") ?? "Escalate"}</h3>
                  </div>
                  <span className={`badge badge-${result.ledger_after.current_tier}`}>{TIER_LABEL[result.ledger_after.current_tier]}</span>
                </div>
                {dispute.llm_fallback && <p className="tl-ai-warning"><ShieldAlert /> AI provider unavailable — safely escalated without execution.</p>}
                <dl className="tl-result-grid">
                  <div><dt>Amount</dt><dd>{inr(dispute.amount)}</dd></div>
                  <div><dt>Final path</dt><dd>{decision?.final_path.replaceAll("_", " ") ?? "escalate"}</dd></div>
                  <div><dt>Investigation</dt><dd>{investigation?.reasoning_summary ?? "Human investigation required"}</dd></div>
                </dl>
                <button className="tl-evidence-toggle" type="button" onClick={() => setEvidenceOpen((value) => !value)} aria-expanded={evidenceOpen}>
                  Evidence trail <span>{investigation?.evidence.length ?? 0} items</span><ChevronDown className={evidenceOpen ? "is-open" : ""} />
                </button>
                <AnimatePresence initial={false}>
                  {evidenceOpen && <motion.pre className="tl-evidence-json" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{JSON.stringify(dispute, null, 2)}</motion.pre>}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
