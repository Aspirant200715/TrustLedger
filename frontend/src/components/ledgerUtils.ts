// ledgerUtils.ts — shared, non-component helpers for ledger rendering.
import type { LedgerRecord } from "../types";

export function nextThreshold(tier: LedgerRecord["current_tier"]): number | null {
  if (tier === "suggest_only") return 15;
  if (tier === "draft_for_approval") return 30;
  return null;
}

export function lifetimeAccuracy(rec: LedgerRecord): string {
  if (rec.lifetime_total === 0) return "—";
  return `${((rec.lifetime_correct / rec.lifetime_total) * 100).toFixed(1)}%`;
}
