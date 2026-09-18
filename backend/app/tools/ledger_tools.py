import json
from ..redis_client import get_redis

async def get_transaction_log(dispute_id: str) -> dict:
    redis = await get_redis()
    data = await redis.get(f"ground_truth:{dispute_id}")
    if not data: return {}
    truth = json.loads(data)
    return {
        "txn_timestamp": truth.get("txn_timestamp"),
        "utr": truth.get("utr"),
        "amount": truth.get("amount"),
        "duplicate_found": truth.get("duplicate_found"),
    }

async def get_ledger_state(dispute_id: str) -> dict:
    redis = await get_redis()
    data = await redis.get(f"ground_truth:{dispute_id}")
    if not data: return {}
    truth = json.loads(data)
    return {
        "merchant_settled_credits": truth.get("merchant_settled_credits"),
        "merchant_received_credit": truth.get("merchant_received_credit"),
        "refund_processed": truth.get("refund_processed"),
        "settlement_amount_disbursed": truth.get("settlement_amount_disbursed"),
    }

async def get_customer_merchant_history(dispute_id: str) -> dict:
    redis = await get_redis()
    data = await redis.get(f"ground_truth:{dispute_id}")
    if not data: return {}
    truth = json.loads(data)
    return {
        "customer_id": truth.get("customer_id"),
        "merchant_id": truth.get("merchant_id"),
        "customer_login_ip_match": truth.get("customer_login_ip_match"),
        "3ds_verified": truth.get("3ds_verified"),
        "is_fraud": truth.get("is_fraud"),
    }
