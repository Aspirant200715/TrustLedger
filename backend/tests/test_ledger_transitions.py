"""Unit tests for the TrustLedger trust mechanic (CONTRACT.md Tier rules).

Tests the PURE transition function
    apply_review_transition(category, current_record, outcome, recent_history)
directly — no Redis, no LLM, no network. recent_history is the category's
prior review outcomes (oldest->newest, stakes excluded); tests maintain it
exactly like the POST /api/review caller does: append each outcome, keep 10.
"""
from app.ledger_service import _fresh_ledger
from app.models import DisputeCategory, LedgerRecord, ReviewOutcome, TierLevel
from app.review_logic import apply_review_transition

CAT = DisputeCategory.duplicate_charge
CORRECT = ReviewOutcome.confirmed_correct
OVERTURNED = ReviewOutcome.overturned


def _applySequence(record: LedgerRecord, outcomes: list[ReviewOutcome]):
    """Apply outcomes in order, maintaining recent_history like the caller."""
    recent: list[str] = []
    for outcome in outcomes:
        record = apply_review_transition(CAT, record, outcome, recent)
        recent = (recent + [outcome.value])[-10:]
    return record, recent


def test_1_fresh_category_starts_at_suggest_only():
    for cat in DisputeCategory:
        rec = _fresh_ledger(cat)
        assert rec.current_tier == TierLevel.suggest_only
        assert rec.in_tier_total == 0
        assert rec.in_tier_correct == 0
        assert rec.lifetime_total == 0
        assert rec.tier_history == []
    assert _fresh_ledger(DisputeCategory.fraud_flag).hard_capped is True
    assert _fresh_ledger(CAT).hard_capped is False


def test_2_fifteen_promotes_fourteen_does_not():
    rec = _fresh_ledger(CAT)
    rec, _ = _applySequence(rec, [CORRECT] * 14)
    assert rec.current_tier == TierLevel.suggest_only  # boundary: 14 is not enough
    assert rec.in_tier_total == 14
    assert rec.in_tier_correct == 14
    assert rec.tier_history == []

    before = rec.model_copy(deep=True)  # purity: input must not be mutated
    rec, _ = _applySequence(rec, [CORRECT])
    assert before.in_tier_total == 14
    assert rec.current_tier == TierLevel.draft_for_approval  # 15th promotes
    assert rec.in_tier_total == 0  # in-tier counters reset…
    assert rec.in_tier_correct == 0
    assert rec.lifetime_total == 15  # …but lifetime kept
    assert rec.lifetime_correct == 15
    assert len(rec.tier_history) == 1


def test_3_thirty_at_draft_promotes_twentynine_does_not():
    rec = _fresh_ledger(CAT)
    rec, recent = _applySequence(rec, [CORRECT] * 15)
    assert rec.current_tier == TierLevel.draft_for_approval

    rec, recent = _applySequence(rec, [CORRECT] * 29)
    assert rec.current_tier == TierLevel.draft_for_approval  # 29 is not enough
    assert rec.in_tier_total == 29
    assert len(rec.tier_history) == 1

    rec, _ = _applySequence(rec, [CORRECT])
    assert rec.current_tier == TierLevel.auto_execute  # 30th promotes
    assert rec.in_tier_total == 0
    assert rec.in_tier_correct == 0
    assert rec.lifetime_total == 45
    assert len(rec.tier_history) == 2


def test_4_single_overturn_demotes_exactly_one_floor_holds():
    # auto_execute -> draft_for_approval
    rec = _fresh_ledger(CAT)
    rec, _ = _applySequence(rec, [CORRECT] * 45)
    assert rec.current_tier == TierLevel.auto_execute
    rec, _ = _applySequence(rec, [OVERTURNED])
    assert rec.current_tier == TierLevel.draft_for_approval
    assert rec.in_tier_total == 0
    assert rec.lifetime_overturned == 1

    # draft_for_approval -> suggest_only
    rec, _ = _applySequence(rec, [OVERTURNED])
    assert rec.current_tier == TierLevel.suggest_only

    # suggest_only cannot demote further: no crash, no history entry
    hist_len = len(rec.tier_history)
    rec, _ = _applySequence(rec, [OVERTURNED])
    assert rec.current_tier == TierLevel.suggest_only
    assert len(rec.tier_history) == hist_len


def test_5_fraud_flag_never_exceeds_draft():
    rec = _fresh_ledger(DisputeCategory.fraud_flag)
    recent: list[str] = []
    for _ in range(100):
        rec = apply_review_transition(
            DisputeCategory.fraud_flag, rec, CORRECT, recent
        )
        recent = (recent + [CORRECT.value])[-10:]
    assert rec.current_tier == TierLevel.draft_for_approval
    assert rec.hard_capped is True
    assert rec.lifetime_total == 100
    assert rec.lifetime_correct == 100
    # Only the suggest->draft promotion ever happened
    assert len(rec.tier_history) == 1
    assert rec.tier_history[0].to_tier == TierLevel.draft_for_approval


def test_6_accuracy_gates_promotion_not_volume():
    # 40% accuracy over 30 outcomes: well past 15, must NOT promote.
    rec = _fresh_ledger(CAT)
    outcomes = ([CORRECT, CORRECT, OVERTURNED, OVERTURNED, OVERTURNED]) * 6
    rec, _ = _applySequence(rec, outcomes)
    assert rec.in_tier_total >= 15
    assert rec.current_tier == TierLevel.suggest_only
    assert rec.tier_history == []
    acc = rec.in_tier_correct / rec.in_tier_total
    assert acc < 0.90


def test_7_history_appended_only_on_actual_change():
    rec = _fresh_ledger(CAT)
    rec, _ = _applySequence(rec, [CORRECT] * 5)  # no threshold crossed
    assert rec.tier_history == []

    rec, _ = _applySequence(rec, [CORRECT] * 10)  # 15th promotes
    assert len(rec.tier_history) == 1
    entry = rec.tier_history[0]
    assert entry.from_tier == TierLevel.suggest_only
    assert entry.to_tier == TierLevel.draft_for_approval
    assert isinstance(entry.reason, str) and entry.reason
    assert entry.timestamp is not None

    rec, _ = _applySequence(rec, [CORRECT] * 5)  # accumulating, no change
    assert len(rec.tier_history) == 1

    rec, _ = _applySequence(rec, [OVERTURNED])  # demotion appends
    assert len(rec.tier_history) == 2
    entry = rec.tier_history[1]
    assert entry.from_tier == TierLevel.draft_for_approval
    assert entry.to_tier == TierLevel.suggest_only
    assert entry.timestamp is not None
