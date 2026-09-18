# Backend tests — governance/policy layer, no LLM, no network.

These tests validate the governance/policy layer independent of any LLM call —
the trust mechanic works whether the model is Claude, GPT, or a stub, because
autonomy decisions are pure Python reading Redis state against fixed thresholds,
not model output.

- `test_ledger_transitions.py` calls `apply_review_transition` directly.
  No Redis server, no LLM, no event loop needed.
- `test_pipeline_stakes_override.py` runs the real `orchestrator.run_pipeline`
  with `llm_client.get_structured_completion` stubbed and Redis replaced by an
  in-memory fake. No `groq` traffic, no Redis server.

Run from repo root:  pytest backend/tests/ -v
