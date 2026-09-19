// api.ts — typed client for the TrustLedger backend (CONTRACT.md ## API contract).
//
// One function per endpoint. The backend runs at http://localhost:8000 (CONTRACT.md
// "Backend runs on http://localhost:8000, all routes prefixed with /api").
// No .env file is required — the URL is fixed by contract. Non-2xx responses
// throw ApiError carrying the backend's {error, detail} shape.
import type {
  ApiErrorShape,
  DisputeCategory,
  EscalationsResponse,
  IngestResponse,
  LedgerResponse,
  ListDisputesResponse,
  MergedDispute,
  ReviewOutcome,
  ReviewResponse,
  SeedResponse,
} from "./types";

export const API_BASE_URL = "http://localhost:8000/api";

export class ApiError extends Error {
  error: string;
  detail: string;
  status: number;

  constructor(status: number, shape: ApiErrorShape) {
    super(`${shape.error}: ${shape.detail}`);
    this.name = "ApiError";
    this.status = status;
    this.error = shape.error;
    this.detail = shape.detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const shape = (body ?? {}) as Partial<ApiErrorShape>;
    throw new ApiError(res.status, {
      error: shape.error ?? "RequestFailed",
      detail: shape.detail ?? `HTTP ${res.status} on ${path}`,
    });
  }
  return body as T;
}

/** POST /api/disputes/ingest — run full pipeline, return merged record + ledger. */
export function ingestDispute(
  category?: DisputeCategory | null,
  seedOverturn = false,
): Promise<IngestResponse> {
  return request<IngestResponse>("/disputes/ingest", {
    method: "POST",
    body: JSON.stringify({
      category: category ?? null,
      seed_overturn: seedOverturn,
    }),
  });
}

/** GET /api/disputes — list summaries, newest first. */
export function listDisputes(): Promise<ListDisputesResponse> {
  return request<ListDisputesResponse>("/disputes");
}

/** GET /api/disputes/{id} — full merged record with evidence trail. */
export function getDispute(id: string): Promise<MergedDispute> {
  return request<MergedDispute>(`/disputes/${encodeURIComponent(id)}`);
}

/** GET /api/ledger — all 5 category ledgers. */
export function getLedger(): Promise<LedgerResponse> {
  return request<LedgerResponse>("/ledger");
}

/** POST /api/review/{dispute_id} — apply tier-transition rules. */
export function reviewDispute(
  id: string,
  outcome: ReviewOutcome,
): Promise<ReviewResponse> {
  return request<ReviewResponse>(`/review/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

/** GET /api/escalations — pending human-review packets. */
export function listEscalations(): Promise<EscalationsResponse> {
  return request<EscalationsResponse>("/escalations");
}

/** POST /api/demo/seed — 31-step scripted climb-then-fall for animation replay. */
export function seedDemo(category: DisputeCategory): Promise<SeedResponse> {
  return request<SeedResponse>("/demo/seed", {
    method: "POST",
    body: JSON.stringify({ category }),
  });
}
