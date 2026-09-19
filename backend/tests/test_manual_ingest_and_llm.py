"""Manual ingest contract and LLM configuration hardening tests."""
import asyncio

import pytest
from pydantic import ValidationError

import app.routers.disputes as routes
from app.llm_client import validate_api_key
from app.ledger_service import _fresh_ledger
from app.models import DisputeCategory
from app.routers.disputes import IngestRequest, ReviewRequest


def test_manual_ingest_passes_exact_user_fields_to_pipeline(monkeypatch):
    captured = {}

    async def fake_pipeline(**kwargs):
        captured.update(kwargs)
        dispute = kwargs["prepared_dispute"]
        return {
            "dispute": dispute.model_dump(mode="json"),
            "ledger_after": {"category": dispute.category.value},
        }

    monkeypatch.setattr(routes, "run_pipeline", fake_pipeline)
    req = IngestRequest(
        category=DisputeCategory.upi_debited_not_credited,
        amount=12500.75,
        utr="324761908415",
        ticket_text="Customer reports debit without merchant credit.",
    )
    response = asyncio.run(routes.ingest_dispute(req))
    dispute = response["dispute"]

    assert dispute["category"] == "upi_debited_not_credited"
    assert dispute["amount"] == 12500.75
    assert dispute["utr"] == "324761908415"
    assert dispute["raw_ticket_text"] == "Customer reports debit without merchant credit."
    assert captured["prepared_ground_truth"]["source"] == "manual_user_input"


@pytest.mark.parametrize(
    "payload",
    [
        {"category": "refund_delay", "amount": 100},
        {"category": "refund_delay", "amount": 0, "utr": "1234", "ticket_text": "A sufficiently long ticket"},
        {"category": "refund_delay", "amount": 100, "utr": "", "ticket_text": "A sufficiently long ticket"},
        {"category": "refund_delay", "amount": 100, "utr": "1234", "ticket_text": "short"},
    ],
)
def test_manual_ingest_rejects_incomplete_or_invalid_payload(payload):
    with pytest.raises(ValidationError):
        IngestRequest.model_validate(payload)


def test_synthetic_ingest_contract_remains_backwards_compatible():
    request = IngestRequest(category=None, seed_overturn=False)
    assert request.is_manual is False


def test_missing_llm_key_is_rejected(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="LLM_API_KEY is required"):
        validate_api_key()


def test_review_updates_record_and_removes_queue_item(monkeypatch):
    import json

    class FakeRedis:
        def __init__(self):
            self.store = {
                "dispute:d1": json.dumps({
                    "id": "d1", "category": "refund_delay", "amount": 1000,
                    "status": "escalated", "decision": {"stakes_override": False},
                })
            }
            self.queue = ["d1", "d1"]
        async def get(self, key): return self.store.get(key)
        async def set(self, key, value): self.store[key] = value
        async def lrem(self, key, count, value):
            self.queue = [item for item in self.queue if item != value]
        async def ping(self): return True

    fake = FakeRedis()
    async def fake_redis(): return fake
    async def fake_transition(category, fn):
        return fn(_fresh_ledger(category))

    monkeypatch.setattr(routes, "get_redis", fake_redis)
    monkeypatch.setattr(routes, "apply_transition", fake_transition)
    response = asyncio.run(routes.review_dispute("d1", ReviewRequest(outcome="confirmed_correct")))
    stored = json.loads(fake.store["dispute:d1"])

    assert response["dispute_id"] == "d1"
    assert stored["status"] == "reviewed"
    assert stored["review_outcome"] == "confirmed_correct"
    assert stored["reviewed_at"]
    assert fake.queue == []
