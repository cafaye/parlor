/**
 * Typed client for the billing service.
 *
 * billing's `openapi/v1.yaml` on master declares six paths, and this file
 * speaks five of them:
 *
 *   GET    /v1/plans            200 PlanPage   | 400 | 422
 *   POST   /v1/plans            201 Plan       | 400 | 409 | 422
 *   GET    /v1/plans/{slug}     200 Plan       | 404
 *   PATCH  /v1/plans/{id}       200 Plan       | 404 | 409 | 422
 *   GET    /v1/customers        200 CustomerPage | 400 | 422
 *   POST   /v1/customers        201 Customer   | 400 | 409 | 422
 *   GET    /v1/customers/{id}   200 Customer   | 404
 *   PATCH  /v1/customers/{id}   200 Customer   | 404 | 422
 *
 * `/v1/webhooks/stripe` is the sixth and is deliberately absent: it is not a
 * cafaye client surface, it authenticates by signature over the raw body
 * rather than by token, and the contract says it must never grow a token check.
 *
 * There is no `/v1/subscriptions` here or anywhere else in the document. The
 * `info.description` lists subscriptions among the things billing is *for*, and
 * the next sentence scopes this build to "customers, plans, and one Stripe
 * webhook endpoint". So a plan here is a catalogue row — a thing that can be
 * bought, at a price, on a cadence — and nothing on the wire records which plan
 * a customer is on. Any screen that said "you are subscribed to X" would be
 * inventing an endpoint.
 *
 * Like `src/lib/identity.ts`, the transport is a parameter rather than `fetch`,
 * and billing has its own error type because it is a different service with its
 * own codes. The envelope is the same shape — core requires every cafaye service
 * to answer `application/problem+json` — but the two clients are independent on
 * purpose: a change to identity's contract should not be a change to billing's.
 */

import { isMoney, type Money } from "@/lib/money";

/** The interval a plan bills on. A one-time plan never recurs. */
export type Interval = "month" | "year" | "one_time";

/**
 * A plan: a catalogue row.
 *
 * `processor_product_id` and `processor_price_id` are always null in v0 — "this
 * build makes no Stripe call" — and are kept as nullable rather than dropped so
 * the type still matches when that changes.
 */
export type Plan = {
  id: string;
  name: string;
  slug: string;
  processor_product_id: string | null;
  processor_price_id: string | null;
  price: Money;
  interval: Interval;
  trial_days: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * What a customer record is *for*.
 *
 * This is the whole join between the two services: a uuid stored without a
 * foreign key, pointing at a record identity knows about. It is the only way
 * billing refers to a person or an account.
 */
export type CustomerOwner = {
  /** The enum is exactly these two. A third is a contract change, not a value. */
  type: "User" | "Account";
  id: string;
};

/**
 * billing's record of an identity user or account.
 *
 * `processor_customer_id` is always null in v0, so nothing here is connected to
 * a payment processor yet, and a screen must not imply otherwise.
 */
export type Customer = {
  id: string;
  owner: CustomerOwner;
  /** Only `stripe` in v0. */
  processor: string;
  processor_customer_id: string | null;
  email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/**
 * Cursor pagination, on every collection.
 *
 * `next_cursor` is opaque and "clients must not parse it; its encoding may
 * change without notice", so it is carried as a string and passed back verbatim.
 * `has_more` is the flag to branch on; `next_cursor` being non-null is not a
 * substitute, because a service is free to send a cursor it will not honour.
 */
export type Page = {
  next_cursor: string | null;
  has_more: boolean;
};

export type PlanPage = { data: Plan[]; page: Page };
export type CustomerPage = { data: Customer[]; page: Page };

/** One `{field, code}` pair out of a 422. */
export type FieldError = { field: string; code: string };

/** The body of `POST /v1/customers`. `owner` and `processor` are required. */
export type CustomerCreate = {
  owner: CustomerOwner;
  processor: string;
  email?: string | null;
  metadata?: Record<string, unknown>;
};

export type BillingTransportRequest = {
  url: string;
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: string;
};

export type BillingTransport = (request: BillingTransportRequest) => Promise<Response>;

export type BillingClient = {
  listPlans(options?: { cursor?: string; limit?: number; order?: "asc" | "desc" }): Promise<PlanPage>;
  getPlanBySlug(slug: string): Promise<Plan>;
  listCustomers(options?: { cursor?: string; limit?: number }): Promise<CustomerPage>;
  getCustomer(id: string): Promise<Customer>;
  /**
   * Creates a customer. The second argument is the `Idempotency-Key` uuid: pass
   * the same one to retry the same intent, or leave it and a fresh one is
   * generated per call.
   */
  createCustomer(input: CustomerCreate, idempotencyKey?: string): Promise<Customer>;
};

export class BillingError extends Error {
  readonly status: number;
  /** The reserved code from core's list, or `internal`. */
  readonly code: string;
  readonly title: string | null;
  readonly fieldErrors: FieldError[];
  readonly traceId: string | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      title?: string | null;
      fieldErrors?: FieldError[];
      traceId?: string | null;
    },
  ) {
    super(message);
    this.name = "BillingError";
    this.status = options.status;
    this.code = options.code ?? "internal";
    this.title = options.title ?? null;
    this.fieldErrors = options.fieldErrors ?? [];
    this.traceId = options.traceId ?? null;
  }
}

/**
 * The origin every call in this file is made against.
 *
 * The empty string, for the same reason and with the same trade as identity's
 * (`src/lib/identity.ts`): a relative URL is same-origin by construction, and
 * billing's address is a server-only variable that is not in this bundle.
 */
export const BILLING_BASE_URL = "";

/**
 * The browser transport.
 *
 * `credentials: "same-origin"`, and here the cookies are the point rather than a
 * side effect. billing authenticates nobody — its contract declares
 * `security: []` — so the right value is the one that sends nothing and can be
 * widened deliberately if billing ever grows a session. `"omit"` would also have
 * been correct; `"same-origin"` is chosen so the two clients state the same
 * posture, and a reader comparing them is reading one decision rather than two.
 */
const fetchTransport: BillingTransport = async ({ url, method, headers, body }) =>
  fetch(url, { method, headers, body, credentials: "same-origin" });

export function createBillingClient(
  options: { baseUrl?: string; transport?: BillingTransport } = {},
): BillingClient {
  const base = (options.baseUrl ?? BILLING_BASE_URL).replace(/\/+$/, "");
  const transport = options.transport ?? fetchTransport;

  return {
    listPlans: (query) => send(transport, `${base}/v1/plans${queryString(query)}`, "GET"),
    getPlanBySlug: (slug) => send(transport, `${base}/v1/plans/${encodeURIComponent(slug)}`, "GET"),
    listCustomers: (query) => send(transport, `${base}/v1/customers${queryString(query)}`, "GET"),
    getCustomer: (id) => send(transport, `${base}/v1/customers/${encodeURIComponent(id)}`, "GET"),
    createCustomer: (input, idempotencyKey) =>
      send(transport, `${base}/v1/customers`, "POST", {
        body: input,
        // Generated when the caller supplies none, because the header's purpose
        // is to make a retry safe and a caller that forgets to thread a key
        // through its retry is exactly the caller who needs one minted for it.
        // The parameter stays, so a caller retrying a *specific* intent can hold
        // one key across both attempts.
        headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
      }),
  };
}

/** Builds a query string, omitting anything absent rather than sending it empty. */
function queryString(query: { cursor?: string; limit?: number; order?: "asc" | "desc" } = {}): string {
  const parts: string[] = [];
  if (query.cursor) parts.push(`cursor=${encodeURIComponent(query.cursor)}`);
  if (query.limit !== undefined) parts.push(`limit=${encodeURIComponent(String(query.limit))}`);
  if (query.order) parts.push(`order=${encodeURIComponent(query.order)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * A uuid for an `Idempotency-Key`.
 *
 * `crypto.randomUUID` is a v4 from the platform's CSPRNG, which is what the
 * header's `format: uuid` asks for. It is passed in rather than generated inside
 * `send` so that a *retry* can reuse it: the whole point of the header is that
 * the same key with the same body replays the original response, and a key
 * minted per attempt would make a retry a second customer.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function send<T>(
  transport: BillingTransport,
  url: string,
  method: BillingTransportRequest["method"],
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
    ...options.headers,
  };

  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await transport({ url, method, headers, body });
  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Turns a failure response into a `BillingError`.
 *
 * `detail` is carried on the error and never rendered. billing's own schema
 * says it is "specific to this occurrence and not parsed by clients" and that it
 * "never contains an internal error, a host, a role or a query fragment" — which
 * is a promise about the good path, and the reason a screen writes its own
 * sentence rather than showing this.
 */
async function parseError(response: Response): Promise<BillingError> {
  const { status } = response;
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    // A body that cannot even be read is still a failure we can describe.
  }

  const body = asRecord(safeParse(raw));
  const traceId = readString(body?.trace_id) ?? response.headers.get("X-Trace-Id");
  const code = readString(body?.code) ?? "internal";

  return new BillingError(readString(body?.detail) ?? `Request to billing failed (${status})`, {
    status,
    code,
    title: readString(body?.title) ?? null,
    fieldErrors: readFieldErrors(body?.errors),
    traceId,
  });
}

function readFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  const found: FieldError[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const field = record ? readString(record.field) : null;
    const code = record ? readString(record.code) : null;
    if (field && code) found.push({ field, code });
  }
  return found;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Guards
//
// A response is untrusted input whatever the schema says, and these are the two
// places where a mismatch would reach a person as a wrong number or a wrong
// kind. Both are checks rather than casts: `Plan` and `Customer` are what the
// contract promises, and a value that is not one of those is a fact about the
// service, not something to render optimistically.
// ---------------------------------------------------------------------------

const INTERVALS: readonly string[] = ["month", "year", "one_time"];
const OWNER_TYPES: readonly string[] = ["User", "Account"];

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

export function isPlan(value: unknown): value is Plan {
  const record = asRecord(value);
  if (!record) return false;

  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.slug === "string" &&
    isStringOrNull(record.processor_product_id) &&
    isStringOrNull(record.processor_price_id) &&
    // The one that matters: a price this cannot format is a price this must not
    // show. A float would render 19.5 minor units as a plausible wrong price.
    isMoney(record.price) &&
    typeof record.interval === "string" &&
    INTERVALS.includes(record.interval) &&
    typeof record.trial_days === "number" &&
    typeof record.active === "boolean" &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string"
  );
}

export function isCustomer(value: unknown): value is Customer {
  const record = asRecord(value);
  if (!record) return false;

  const owner = asRecord(record.owner);
  if (!owner) return false;
  // The owner type is an enum of exactly two, and it is the only reference from
  // billing to identity — so a third value means the contract moved and a
  // screen guessing which kind it is would be inventing a link.
  if (typeof owner.type !== "string" || !OWNER_TYPES.includes(owner.type)) return false;
  if (typeof owner.id !== "string") return false;

  return (
    typeof record.id === "string" &&
    typeof record.processor === "string" &&
    isStringOrNull(record.processor_customer_id) &&
    // Null is allowed by the schema and means "this build makes no processor
    // call", so a null is a valid customer and not a malformed one.
    isStringOrNull(record.email) &&
    typeof record.metadata === "object" &&
    record.metadata !== null &&
    !Array.isArray(record.metadata) &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string"
  );
}
