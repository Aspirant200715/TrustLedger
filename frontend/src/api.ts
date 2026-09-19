// api.ts — typed client for the TrustLedger backend (CONTRACT.md ## API contract).
//
// All calls go through the single Enter Cloud backend function
// (trustledger-api) which routes by { action }. This keeps the published
// static site live with no local server and no CORS. Failures are normalized
// to ApiError carrying the backend's {error, detail} shape.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./lib/backendConfig";
import type {
  ApiErrorShape,
  DisputeCategory,
  EscalationsResponse,
  HealthResponse,
  IngestRequest,
  IngestResponse,
  LedgerResponse,
  ListDisputesResponse,
  MergedDispute,
  ReviewOutcome,
  ReviewResponse,
  SeedResponse,
} from "./types";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

const BACKEND_FUNCTION = "trustledger-api";

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

// Requests can't hang forever: if the backend is slow or unreachable, abort
// after this budget so the UI settles and the caller sees a clean ApiError.
const REQUEST_TIMEOUT_MS = 12_000;
// Ingestion runs the AI pipeline (investigate + decide) — allow headroom for
// cold-start latency on the managed AI gateway.
const INGEST_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ApiError(0, {
          error: "Timeout",
          detail: `Backend did not respond within ${ms / 1000}s on ${path}`,
        }),
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function invoke<T>(body: object, ms: number, path: string): Promise<T> {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke(BACKEND_FUNCTION, {
        body,
        headers: { "Content-Type": "application/json" },
      }),
      ms,
      path,
    );
    if (error) throw error;
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const anyErr = err as {
      name?: string;
      message?: string;
      status?: number;
      context?: unknown;
    };
    // Backend functions reply with {error, detail} on non-2xx; the client
    // exposes that body on FunctionsHttpError.context.
    if (anyErr.context && typeof anyErr.context === "object") {
      const shape = anyErr.context as Partial<ApiErrorShape>;
      if (shape.error) {
        throw new ApiError(anyErr.status ?? 0, {
          error: shape.error,
          detail: shape.detail ?? "Backend error",
        });
      }
    }
    throw new ApiError(anyErr.status ?? 0, {
      error: anyErr.name ?? "RequestFailed",
      detail: anyErr.message ?? "Cannot reach the backend",
    });
  }
}

/** POST /disputes/ingest — run full pipeline, return merged record + ledger. */
export function ingestDispute(
  categoryOrRequest?: DisputeCategory | IngestRequest | null,
  seedOverturn = false,
): Promise<IngestResponse> {
  const request: IngestRequest =
    typeof categoryOrRequest === "object" && categoryOrRequest !== null
      ? categoryOrRequest
      : { category: categoryOrRequest ?? null, seed_overturn: seedOverturn };
  return invoke<IngestResponse>({ action: "ingest", ...request }, INGEST_TIMEOUT_MS, "ingest");
}

export function getHealth(): Promise<HealthResponse> {
  return invoke<HealthResponse>({ action: "health" }, REQUEST_TIMEOUT_MS, "health");
}

/** GET /disputes — list summaries, newest first. */
export function listDisputes(): Promise<ListDisputesResponse> {
  return invoke<ListDisputesResponse>({ action: "disputes" }, REQUEST_TIMEOUT_MS, "disputes");
}

/** GET /disputes/{id} — full merged record with evidence trail. */
export function getDispute(id: string): Promise<MergedDispute> {
  return invoke<MergedDispute>({ action: "disputes", id }, REQUEST_TIMEOUT_MS, `disputes/${id}`);
}

/** GET /ledger — all 5 category ledgers. */
export function getLedger(): Promise<LedgerResponse> {
  return invoke<LedgerResponse>({ action: "ledger" }, REQUEST_TIMEOUT_MS, "ledger");
}

/** POST /review/{dispute_id} — apply tier-transition rules. */
export function reviewDispute(
  id: string,
  outcome: ReviewOutcome,
): Promise<ReviewResponse> {
  return invoke<ReviewResponse>(
    { action: "review", dispute_id: id, outcome },
    REQUEST_TIMEOUT_MS,
    `review/${id}`,
  );
}

/** GET /escalations — pending human-review packets. */
export function listEscalations(): Promise<EscalationsResponse> {
  return invoke<EscalationsResponse>({ action: "escalations" }, REQUEST_TIMEOUT_MS, "escalations");
}

/** POST /demo/seed — 31-step scripted climb-then-fall for animation replay. */
export function seedDemo(category: DisputeCategory): Promise<SeedResponse> {
  return invoke<SeedResponse>({ action: "seed", category }, INGEST_TIMEOUT_MS, "seed");
}
