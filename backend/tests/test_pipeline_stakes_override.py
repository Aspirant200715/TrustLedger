"""Stakes-override pipeline test (CONTRACT.md: amount > 50000).

Runs the REAL orchestrator.run_pipeline with the REAL llm_client swapped for
a stub and Redis swapped for an in-memory fake — zero network calls.
Confirms a >50000 dispute always ends escalated with reason stakes_override,
regardless of category tier, and never touches ledger stats or balances.
"""
import asyncio
import json
import uuid
from datetime import datetime, timezone

import app.orchestrator as orchestrator_mod
from app import llm_client as llm_mod
from app.agents import decision as dec_mod
from app.agents import investigator as inv_mod
from app.ledger_service import _fresh_ledger
from app.models import (
    Dispute,
    DisputeCategory,
    DisputeStatus,
    EscalationReason,
    InvestigationResult,
    TierLevel,
)


class FakePipeline:
    def __init__(self, store: dict):
        self.store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def watch(self, key):
        return None

    async def get(self, key):
        return self.store.get(key)

    def multi(self):
        return None

    def set(self, key, value):
        self.store[key] = value

    async def execute(self):
        return [True]


class FakeRedis:
    """Minimal in-memory async Redis covering only what the pipeline uses."""

    def __init__(self):
        self.store: dict = {}
        self.lists: dict[str, list] = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value):
        self.store[key] = value

    async def rpush(self, key, value):
        self.lists.setdefault(key, []).append(value)

    async def lpush(self, key, value):
        self.lists.setdefault(key, []).insert(0, value)

    async def lrange(self, key, start, end):
        return list(self.lists.get(key, []))

    async def lrem(self, key, count, value):
        lst = self.lists.get(key, [])
        self.lists[key] = [v for v in lst if v != value]

    async def delete(self, key):
        self.store.pop(key, None)
        self.lists.pop(key, None)

    async def ping(self):
        return True

    def pipeline(self):
        return FakePipeline(self.store)


async def _stub_completion(system_prompt, user_prompt, response_model):
    name = getattr(response_model, "__name__", "")
    if name == "InvestigationResult":
        return InvestigationResult(
            dispute_id="stub",
            root_cause="stub root cause",
            evidence=[],
            reasoning_summary="stub reasoning",
        )
    if name == "ActionProposal":
        return response_model.model_validate(
            {"proposed_action": "auto_refund", "reasoning": "stub"}
        )
    raise AssertionError(f"unexpected model {name}")


def _patch_all(monkeypatch, fake: FakeRedis):
    async def _fake_redis():
        return fake

    for mod in (llm_mod, inv_mod, dec_mod):
        monkeypatch.setattr(mod, "get_structured_completion", _stub_completion)
    import app.agents.action as agents_action_mod
    import app.agents.decision as agents_decision_mod
    import app.agents.escalation as agents_escalation_mod
    import app.agents.investigator as agents_inv_mod
    import app.ledger_service as ledger_mod
    import app.redis_client as redis_mod
    import app.tools.ledger_tools as tools_mod

    for mod in (
        redis_mod,
        ledger_mod,
        orchestrator_mod,
        agents_inv_mod,
        agents_decision_mod,
        agents_action_mod,
        agents_escalation_mod,
        tools_mod,
    ):
        if hasattr(mod, "get_redis"):
            monkeypatch.setattr(mod, "get_redis", _fake_redis)


def _big_dispute() -> tuple[Dispute, dict]:
    return Dispute(
        id=str(uuid.uuid4()),
        category=DisputeCategory.duplicate_charge,
        amount=75_000.0,  # stakes_override threshold is 50000
        utr="999999999999",
        txn_timestamp=datetime.now(timezone.utc),
        customer_id="CUST_STAKES",
        merchant_id="MER_STAKES",
        raw_ticket_text="stakes test ticket",
        status=DisputeStatus.ingested,
    ), {"amount": 75_000.0}


def test_stakes_override_always_escalates_from_auto_tier(monkeypatch):
    fake = FakeRedis()
    _patch_all(monkeypatch, fake)
    monkeypatch.setattr(orchestrator_mod, "generate_dispute", lambda *a, **k: _big_dispute())

    # Pre-set the category at the HIGHEST tier: stakes must still escalate.
    auto = _fresh_ledger(DisputeCategory.duplicate_charge)
    auto.current_tier = TierLevel.auto_execute
    auto.lifetime_total = 45
    auto.lifetime_correct = 45
    asyncio.run(fake.set("ledger:duplicate_charge", auto.model_dump_json()))

    result = asyncio.run(
        orchestrator_mod.run_pipeline(DisputeCategory.duplicate_charge)
    )
    dispute = result["dispute"]
    decision = dispute["decision"]
    packet = dispute.get("escalation_packet")

    assert dispute["status"] == "escalated"
    assert decision["final_path"] == "escalate"
    assert decision["stakes_override"] is True
    assert packet is not None
    assert packet["escalation_reason"] == EscalationReason.stakes_override.value

    # Ledger stats untouched (stakes never counts either way)…
    stored = asyncio.run(fake.get("ledger:duplicate_charge"))
    assert stored is not None
    import json as _json

    ledger = _json.loads(stored)
    assert ledger["current_tier"] == TierLevel.auto_execute.value
    assert ledger["lifetime_total"] == 45
    assert ledger["in_tier_total"] == 0

    # …and no money moved.
    assert not any(k.startswith("mock_balance:") for k in fake.store)

    # Queued for human review.
    assert dispute["id"] in fake.lists.get("escalation_queue", [])
