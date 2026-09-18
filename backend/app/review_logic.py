"""
review_logic.py — Pure tier-transition logic (NO Redis, NO LLM, NO I/O).

Single source of truth for CONTRACT.md "Tier transition rules".
Imported by both routers/disputes.py (POST /api/review) and
orchestrator.py (seed_overturn flow) so both paths behave identically.

Why recent_history is a separate argument:
- LedgerRecord has no field for last-10 outcomes, and changing its shape
  would break the CONTRACT.md Pydantic model.
- "zero overturns in the last 10 cases" therefore needs a sidecar:
  Redis key review_history:{category} -> JSON list of outcome strings
  (oldest -> newest, max 10, stakes_override outcomes NEVER appended).
- This function takes that list as input and stays pure/unit-testable.
  Callers are responsible for reading/writing the sidecar key.
"""
from datetime import datetime, timezone

from .models import (
    DisputeCategory,
    LedgerRecord,
    ReviewOutcome,
    TierHistoryEntry,
    TierLevel,
)


def apply_review_transition(
    category: DisputeCategory,
    record: LedgerRecord,
    outcome: ReviewOutcome,
    recent_history: list[str] | None = None,
) -> LedgerRecord:
    """Apply one review outcome to a ledger record. Pure function.

    Exact CONTRACT.md numbers — do not round or simplify:
    - suggest_only -> draft_for_approval when in_tier_total >= 15 AND acc >= 0.90
    - draft_for_approval -> auto_execute when in_tier_total >= 30 AND acc >= 0.97
      AND zero overturns in last 10 AND not hard-capped (fraud_flag)
    - single overturned demotes exactly one level; suggest_only floor holds
    - accuracy = in_tier_correct / in_tier_total; reset in-tier (not lifetime)
      counters on every actual promotion/demotion
    - append TierHistoryEntry with timestamp on every actual tier change
    - fraud_flag hard-capped: never exceed draft_for_approval
    - CALLER must skip this function entirely for stakes_override
      (amount > 50000) disputes — they never count toward stats either way.

    Args:
        category: dispute category (authoritative for hard-cap check).
        record: current LedgerRecord (never mutated; deep-copied).
        outcome: confirmed_correct | overturned.
        recent_history: prior outcomes for this category, oldest->newest,
            stakes excluded, e.g. ["confirmed_correct", "overturned"].
            None treated as [].
    """
    updated = record.model_copy(deep=True)

    # Hard-cap is a property of the category, not just the stored flag
    # (self-heals fresh/legacy records).
    if category == DisputeCategory.fraud_flag:
        updated.hard_capped = True
    is_capped = bool(updated.hard_capped or category == DisputeCategory.fraud_flag)

    if recent_history is None:
        recent_history = []
    # Sliding window INCLUDING the current outcome (current is correct on the
    # promote path, so this is equivalent to checking prior outcomes).
    window = (list(recent_history) + [outcome.value])[-10:]

    now = datetime.now(timezone.utc)

    if outcome == ReviewOutcome.confirmed_correct:
        updated.lifetime_total += 1
        updated.lifetime_correct += 1
        updated.in_tier_total += 1
        updated.in_tier_correct += 1
        acc = updated.in_tier_correct / updated.in_tier_total if updated.in_tier_total else 0.0

        if (
            updated.current_tier == TierLevel.suggest_only
            and updated.in_tier_total >= 15
            and acc >= 0.90
        ):
            old = updated.current_tier
            updated.current_tier = TierLevel.draft_for_approval
            updated.in_tier_total = 0
            updated.in_tier_correct = 0
            updated.tier_history.append(
                TierHistoryEntry(
                    timestamp=now,
                    from_tier=old,
                    to_tier=TierLevel.draft_for_approval,
                    reason="Promoted: >=15 resolved, >=90% accuracy in suggest_only",
                )
            )
        elif (
            updated.current_tier == TierLevel.draft_for_approval
            and updated.in_tier_total >= 30
            and acc >= 0.97
            and not is_capped
        ):
            zero_overturns = all(v != ReviewOutcome.overturned.value for v in window)
            if zero_overturns:
                old = updated.current_tier
                updated.current_tier = TierLevel.auto_execute
                updated.in_tier_total = 0
                updated.in_tier_correct = 0
                updated.tier_history.append(
                    TierHistoryEntry(
                        timestamp=now,
                        from_tier=old,
                        to_tier=TierLevel.auto_execute,
                        reason="Promoted: >=30 resolved, >=97% accuracy, zero overturns in last 10",
                    )
                )
        # else: no transition — counters keep accumulating, no history entry.
        # (A blocked promotion is NOT a state change; nothing to log per rule #3.)

    else:  # overturned -> demote exactly one level
        updated.lifetime_total += 1
        updated.lifetime_overturned += 1
        updated.in_tier_total += 1
        # in_tier_correct unchanged (incorrect outcome)

        old = updated.current_tier
        if old == TierLevel.auto_execute:
            new = TierLevel.draft_for_approval
        elif old == TierLevel.draft_for_approval:
            new = TierLevel.suggest_only
        else:
            new = TierLevel.suggest_only  # floor: cannot demote further

        if new != old:
            updated.current_tier = new
            updated.in_tier_total = 0
            updated.in_tier_correct = 0
            updated.tier_history.append(
                TierHistoryEntry(
                    timestamp=now,
                    from_tier=old,
                    to_tier=new,
                    reason="Demoted: single overturned outcome (-1 level)",
                )
            )
        # else: suggest_only floor — keep the incremented in_tier_total so the
        # overturn depresses accuracy until overcome; no reset, no history.

    # Defensive clamp: a capped category must never sit at auto_execute
    # (e.g. legacy bad data). Normal path never hits this because promotion
    # is gated above.
    if is_capped and updated.current_tier == TierLevel.auto_execute:
        updated.current_tier = TierLevel.draft_for_approval

    return updated
