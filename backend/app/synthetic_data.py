import random
import uuid
from datetime import datetime, timedelta
from .models import Dispute, DisputeCategory, DisputeStatus

def generate_dispute(category: DisputeCategory | None = None, seed_overturn: bool = False) -> tuple[Dispute, dict]:
    if category is None:
        category = random.choice(list(DisputeCategory))
        
    utr = f"{random.randint(100000000000, 999999999999)}"
    
    if random.random() < 0.05:
        # Stakes override (5% chance)
        amount = round(random.uniform(50001, 100000), 2)
    else:
        amount = round(random.uniform(50, 5000), 2)
        
    days_ago = random.randint(1, 30)
    hours_ago = random.randint(0, 23)
    minutes_ago = random.randint(0, 59)
    txn_timestamp = datetime.utcnow() - timedelta(days=days_ago, hours=hours_ago, minutes=minutes_ago)
    
    customer_id = f"CUST_{random.randint(10000, 99999)}"
    merchant_id = f"MER_{random.randint(10000, 99999)}"
    
    mock_ledger_state = {
        "customer_id": customer_id,
        "merchant_id": merchant_id,
        "utr": utr,
        "amount": amount,
        "txn_timestamp": txn_timestamp.isoformat(),
        "is_fraud": False,
        "seed_overturn_applied": seed_overturn
    }

    # Generate category-specific ticket text and ledger state
    if category == DisputeCategory.duplicate_charge:
        if seed_overturn:
            raw_ticket_text = f"I was charged twice for the amount {amount} at this merchant! UTR: {utr}."
            mock_ledger_state["merchant_settled_credits"] = 1 # Ledger says only charged once
            mock_ledger_state["duplicate_found"] = False
        else:
            raw_ticket_text = f"My account was debited twice for the same transaction of {amount}. Please reverse one. Ref: {utr}."
            mock_ledger_state["merchant_settled_credits"] = 2
            mock_ledger_state["duplicate_found"] = True

    elif category == DisputeCategory.upi_debited_not_credited:
        if seed_overturn:
            raw_ticket_text = f"Amount {amount} was debited from my account but the merchant says they never received it, UTR attached: {utr}."
            mock_ledger_state["merchant_received_credit"] = True # Actually merchant got it
        else:
            raw_ticket_text = f"Money {amount} debited but merchant didn't get it. UTR {utr}."
            mock_ledger_state["merchant_received_credit"] = False

    elif category == DisputeCategory.refund_delay:
        if seed_overturn:
            raw_ticket_text = f"I cancelled my order and the merchant promised a refund of {amount}, but it's been a week and nothing! UTR: {utr}."
            mock_ledger_state["refund_processed"] = True # Refund already processed
        else:
            raw_ticket_text = f"Still waiting for my {amount} refund from order cancellation. UTR {utr}."
            mock_ledger_state["refund_processed"] = False

    elif category == DisputeCategory.merchant_settlement_mismatch:
        if seed_overturn:
            raw_ticket_text = f"Merchant here, I received a settlement of {amount - 50} instead of {amount} for UTR {utr}."
            mock_ledger_state["settlement_amount_disbursed"] = amount # Disbursed fully
        else:
            shortfall = random.randint(10, 50)
            raw_ticket_text = f"My settlement for UTR {utr} is short. I got {amount - shortfall} instead of {amount}."
            mock_ledger_state["settlement_amount_disbursed"] = amount - shortfall

    elif category == DisputeCategory.fraud_flag:
        if seed_overturn:
            raw_ticket_text = f"I didn't authorize this transaction of {amount} to this merchant! UTR {utr}."
            mock_ledger_state["customer_login_ip_match"] = True
            mock_ledger_state["3ds_verified"] = True # Customer did it
        else:
            raw_ticket_text = f"Fraud! Somebody used my account to pay {amount} for UTR {utr}."
            mock_ledger_state["customer_login_ip_match"] = False
            mock_ledger_state["3ds_verified"] = False
            mock_ledger_state["is_fraud"] = True

    else:
        raw_ticket_text = "Unknown issue."
        
    dispute = Dispute(
        id=str(uuid.uuid4()),
        category=category,
        amount=amount,
        utr=utr,
        txn_timestamp=txn_timestamp,
        customer_id=customer_id,
        merchant_id=merchant_id,
        raw_ticket_text=raw_ticket_text,
        status=DisputeStatus.ingested
    )
    
    return dispute, mock_ledger_state
