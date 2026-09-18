import json
from ..models import Dispute, InvestigationResult, DisputeStatus
from ..tools.ledger_tools import get_transaction_log, get_ledger_state, get_customer_merchant_history
from ..llm_client import get_structured_completion
from ..redis_client import get_redis

async def investigate(dispute: Dispute) -> InvestigationResult:
    # 1. Gather evidence
    txn_log = await get_transaction_log(dispute.id)
    ledger_state = await get_ledger_state(dispute.id)
    history = await get_customer_merchant_history(dispute.id)
    
    # 2. Call LLM
    system_prompt = """You are an Investigator Agent for TrustLedger. 
Your job is to investigate a dispute using the provided evidence and determine the root cause.
Return an InvestigationResult with the root cause, a reasoning summary, and a list of evidence items.
Each evidence item MUST have a source from exactly one of these: "transaction_log", "ledger_state", "customer_history", "merchant_history".
Make sure to cite the specific tool output data that supports your finding."""

    user_prompt = f"""
Dispute Information:
{dispute.model_dump_json(indent=2)}

Evidence Gathered:
---
Source: transaction_log
{json.dumps(txn_log, indent=2)}
---
Source: ledger_state
{json.dumps(ledger_state, indent=2)}
---
Source: customer_history (and merchant_history)
{json.dumps(history, indent=2)}
---
"""
    
    # We must validate and retry if needed
    for _ in range(2):
        result = await get_structured_completion(system_prompt, user_prompt, InvestigationResult)
        
        valid_sources = {"transaction_log", "ledger_state", "customer_history", "merchant_history"}
        all_valid = all(e.source in valid_sources for e in result.evidence)
        if all_valid:
            break
        
        # If invalid, we retry once
        user_prompt += "\n\nNote: In your previous attempt, you used an invalid source string. Please ensure source is strictly one of: transaction_log, ledger_state, customer_history, merchant_history."
        
    if not all_valid:
        # Fallback if still invalid (we shouldn't crash pipeline)
        # Just coerce them
        for e in result.evidence:
            if e.source not in valid_sources:
                e.source = "transaction_log" # Arbitrary fallback
                
    # 3. Update Redis
    redis = await get_redis()
    
    existing_dispute_data = await redis.get(f"dispute:{dispute.id}")
    if existing_dispute_data:
        record = json.loads(existing_dispute_data)
    else:
        record = dispute.model_dump(mode="json")
        
    record["status"] = DisputeStatus.investigated.value
    record["investigation_result"] = result.model_dump(mode="json")
    
    await redis.set(f"dispute:{dispute.id}", json.dumps(record))
    
    # Also update the passed dispute object
    dispute.status = DisputeStatus.investigated
    
    return result
