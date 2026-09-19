// format.ts — INR currency, relative time, and label helpers.
// Financial amounts are always formatted in ₹ (CONTRACT.md amounts are INR),
// IDs are rendered in monospace by the components that consume these helpers.
import type { DisputeCategory, TierLevel } from "./types";

const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹-format an amount, e.g. 50000 -> "₹50,000". */
export function inr(amount: number): string {
  return inrFmt.format(amount);
}

export const CATEGORY_LABEL: Record<DisputeCategory, string> = {
  duplicate_charge: "Duplicate Charge",
  upi_debited_not_credited: "UPI Debited, Not Credited",
  refund_delay: "Refund Delay",
  merchant_settlement_mismatch: "Merchant Settlement Mismatch",
  fraud_flag: "Fraud Flag",
};

/** Short labels for tight UI (chips, steppers). */
export const CATEGORY_SHORT: Record<DisputeCategory, string> = {
  duplicate_charge: "Duplicate",
  upi_debited_not_credited: "UPI No-Credit",
  refund_delay: "Refund Delay",
  merchant_settlement_mismatch: "Settlement",
  fraud_flag: "Fraud Flag",
};

export const TIER_LABEL: Record<TierLevel, string> = {
  suggest_only: "Suggest Only",
  draft_for_approval: "Draft for Approval",
  auto_execute: "Auto-Execute",
};

/** Tier rank for comparisons: higher rank = more autonomy. */
export const TIER_RANK: Record<TierLevel, number> = {
  suggest_only: 0,
  draft_for_approval: 1,
  auto_execute: 2,
};

/** Relative clock, e.g. "2m ago" / "just now". Returns "—" for missing ISO. */
export function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

/** Clock for audit rows: "19 Sep 06:14:02". */
export function clockTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
