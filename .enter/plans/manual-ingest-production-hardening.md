# Context

TrustLedger already has a sound trust ledger, review queue, synthetic pipeline, and institutional dark theme, but the current ingest contract only generates synthetic disputes, dashboard data is managed by custom polling, and LLM failures are visible only as a generic orchestrator fallback. This change will extend the existing pipeline—without bypassing its Redis evidence tools, tier policy, stakes override, or hard-cap rules—so a user can submit a real dispute, observe the governed decision path, and understand when the AI provider is unavailable.

The configured `LLM_API_KEY` will be mandatory at backend startup, per the user’s direction to use the API key only. There will be no mock LLM mode in application code. Invalid/revoked/quota-limited keys discovered at runtime will not hang or crash an in-flight dispute: they will produce an explicit `LLM_UNAVAILABLE` fallback marker and route the dispute to human review.

## Recommended architecture

- Extend `POST /api/disputes/ingest` with optional manual fields (`amount`, `utr`, `ticket_text`) while preserving the existing category-only synthetic request for the simulation and quick-ingest paths.
- Build a `Dispute` and a conservative evidence seed from manual input in the backend, then pass it through the same `investigate → decide → act/escalate` orchestrator and Redis keys as synthetic disputes.
- Keep `llm_client.py` as the only provider boundary. Add a typed `LLMUnavailableError`, a bounded provider timeout, one validation retry, and normalized provider error classification. The orchestrator remains responsible for converting that failure into a persisted human escalation.
- Expose LLM readiness through `/api/health` and non-breaking fallback metadata on the merged dispute so the frontend can show a persistent warning and the required non-blocking toast.
- Replace custom polling with React Query queries/mutations and targeted invalidation for ledger, disputes, escalations, manual ingest, reviews, and refresh.
- Add `DisputeIngestForm.tsx` with staged request feedback driven by the real synchronous response; stages indicate current request progress and then resolve from the returned merged record, not fabricated backend events.
- Keep the current formal institutional layout and strict semantic palette; refine typography, card borders, evidence disclosures, hover states, boot seal/tagline, tier-change pulse, and queue reordering rather than introducing decorative confetti.

## Critical files

- `CONTRACT.md` — document the backwards-compatible manual ingest fields and fallback/status metadata.
- `backend/app/models.py` — add typed manual-ingest/fallback status models or enums where appropriate.
- `backend/app/routers/disputes.py` — validate manual input and forward either a manual dispute seed or the existing synthetic request.
- `backend/app/orchestrator.py` — accept an optional prepared dispute/evidence seed, enforce the hard timeout, and persist explicit LLM fallback metadata while reusing the current routing logic.
- `backend/app/llm_client.py` — mandatory-key validation, bounded requests, retry/validation handling, and typed provider failures.
- `backend/app/main.py` — startup key check and richer health payload.
- `backend/tests/` — manual-ingest, key/timeout/provider-failure, response metadata, and queue-removal coverage.
- `frontend/src/main.tsx` — install `QueryClientProvider`.
- `frontend/src/api.ts`, `frontend/src/types.ts` — extend request/response types and health API.
- `frontend/src/components/DisputeIngestForm.tsx` — new manual workflow, pipeline visualizer, result summary, and evidence accordion.
- `frontend/src/pages/Dashboard.tsx` — React Query orchestration, refresh control, mutation invalidation, warning/toast handling, and ingest-panel placement.
- `frontend/src/components/EscalationQueue.tsx` — animated removal/reordering and evidence-count reveal while preserving the distinct review actions.
- `frontend/src/components/Boot.tsx`, `frontend/src/components/Boot.css` — smooth seal and “Autonomy, Earned.” fade with reduced-motion bypass.
- `frontend/src/theme.css`, `frontend/src/components/components.css`, `frontend/src/pages/Dashboard.css` — premium institutional refinements and form/visualizer/evidence styles.
- `package.json`, `frontend/package.json` and lockfiles — add `@tanstack/react-query` consistently to the root build and frontend workspace.

## Implementation checklist

- [ ] Extend the ingest request model so category-only calls remain valid and manual calls require positive amount, non-empty UTR, and non-empty ticket text as one complete set.
- [ ] Create manual disputes with backend-generated UUID, timestamp, customer/merchant identifiers, and conservative Redis evidence seed derived only from submitted fields.
- [ ] Refactor `run_pipeline` to accept either the existing synthetic generator result or a prepared manual dispute/evidence pair while preserving indexing, timestamps, stakes override, hard cap, action isolation, and merged response shape.
- [ ] Add a hard pipeline/LLM timeout within the contract’s approximately five-second ingest budget and prevent retries from exceeding that budget.
- [ ] Require `LLM_API_KEY` at startup and report configured provider readiness in `/api/health` without exposing the key.
- [ ] Add `LLMUnavailableError` handling for missing/invalid/revoked/quota/timeout/malformed provider responses; retry validation once, then raise the typed failure to the orchestrator.
- [ ] Persist `llm_fallback: true` and `fallback_reason: "LLM_UNAVAILABLE"` on failed in-flight disputes and route them to the human escalation queue with no money movement.
- [ ] Keep all API error envelopes structured and avoid returning provider exception text, secrets, or tracebacks.
- [ ] Extend TypeScript contracts and `ingestDispute` so the manual form submits the new fields while synthetic calls remain unchanged.
- [ ] Add React Query provider and stable query keys for health, ledger, disputes, and escalations with bounded refetch intervals and no overlapping requests.
- [ ] Use mutations for manual ingest and review; invalidate/refetch ledger, dispute, escalation, and health queries after success.
- [ ] Add `DisputeIngestForm.tsx` with category, INR amount, monospace UTR, ticket textarea, accessible validation, and disabled/loading states.
- [ ] Show staged ingest/investigate/decision/trust/final-path progress, then populate proposed action, investigation reasoning, current tier, execution/escalation result, and collapsible evidence from the real merged response.
- [ ] Show the exact “AI Brain is offline. Escalating to human review automatically.” toast when fallback metadata is returned, without treating the successful escalation response as a page error.
- [ ] Add a visible “Refresh Ledger” action bound to React Query refetch state.
- [ ] Wrap escalation rows in `AnimatePresence`/layout motion so reviewed items leave and remaining rows reorder smoothly; reveal evidence count/detail on hover/focus.
- [ ] Refine Boot seal timing and restore “Autonomy, Earned.” with a subtle fade; skip immediately for reduced motion.
- [ ] Apply Inter and JetBrains Mono/Fira Code fallbacks, 5%-white card borders, modal/overlay blur, button active scale, restrained tier-change glow, and semantic-only emerald/amber/slate/red usage.
- [ ] Preserve the Trust Matrix’s last-10 outcome marks and hard-cap rule: fraud cards must never display auto-execute branding.

## Verification checklist

- [ ] Run `python3 -m pytest backend/tests/ -v` and retain all existing tier-transition and stakes-override passes.
- [ ] Add and pass a manual-ingest test proving submitted category, amount, UTR, and ticket text persist unchanged and pass through investigation/decision/escalation.
- [ ] Add and pass validation tests for partial manual payloads, zero/negative amount, blank UTR, and blank ticket text with structured 422/4xx responses.
- [ ] Add and pass the ₹50,000 boundary tests: exactly ₹50,000 follows tier policy; ₹50,000.01 force-escalates and never changes trust counters.
- [ ] Add and pass a missing-key startup test and invalid/quota/timeout tests proving typed LLM failure, bounded completion, persisted fallback metadata, queue insertion, and no balance write.
- [ ] Add and pass a review integration test proving Redis ledger update, `reviewed_at`, `review_outcome`, and removal of every matching ID from `escalation_queue`.
- [ ] Run `pnpm lint` and `pnpm build` from repository root with no warnings/errors.
- [ ] Verify manual form positive flow against the running frontend/backend and inspect the returned evidence accordion, proposed action, tier, and final path.
- [ ] Verify runtime LLM failure shows the required non-blocking warning toast and a usable escalation packet without crashing or hanging.
- [ ] Verify refresh and review mutations update ledger cards and queue counts without a full page reload.
- [ ] Capture the affected dashboard at `desktop_1280` and `mobile_390`; verify form, Trust Matrix, queue actions, accordion, sticky navigation, contrast, focus states, and no horizontal overflow.
