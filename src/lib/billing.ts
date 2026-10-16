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
 * The subscription paths are here, as of billing 2.4.0: the production checkout
 * (`POST /v1/subscriptions`, which returns a Checkout session and writes
 * nothing — the row arrives on the processor's webhook), the reads, the two
 * mutations, the upcoming-invoice projection, and the portal URL. `/v1/
 * webhooks/stripe` is the one path this client deliberately does not speak: it
 * is not a cafaye client surface and authenticates by signature over the raw
 * body rather than by token.
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
 * What a plan grants: an object with at most two members, so a reader never has
 * to ask whether a key it does not know is one it should honour. A limit is a
 * count, never an amount.
 */
export type PlanEntitlements = { features: string[]; limits: Record<string, number> };

/**
 * A plan: a catalogue row.
 *
 * `processor_product_id` and `processor_price_id` are null until a Stripe
 * price exists for the plan — a plan with none cannot be bought, and a screen
 * must not offer it.
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
  /**
   * What buying this plan grants: a closed `{features, limits}` object. It is
   * required on the wire, so a plan without one is a malformed plan — the guard
   * says so rather than defaulting it to empty.
   */
  entitlements: PlanEntitlements;
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

/** The subscription statuses this service stores, and the only five. */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid";

/**
 * One account, on one plan, for one billing period at a time.
 *
 * `status` is the processor's statement and nothing else: this service stores
 * what the processor reports and does not correct it. A subscription does not
 * have a price of its own — `price` is the plan's.
 */
export type Subscription = {
  id: string;
  account_id: string;
  plan_id: string;
  plan_slug: string;
  customer_id: string;
  processor_subscription_id: string;
  status: SubscriptionStatus;
  price: Money;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionPage = { data: Subscription[]; page: Page };

/** What a plan grants, and whether this subscription is granting it. */
export type Entitlements = {
  subscription_id: string;
  plan_id: string;
  plan_slug: string;
  status: SubscriptionStatus;
  granted: boolean;
  features: string[];
  limits: Record<string, number>;
};

/**
 * The processor's projection of the next invoice.
 *
 * Every figure is the processor's own except `tax`, which the service derives
 * from the two processor totals for display. Nothing here is persisted.
 */
export type InvoiceLineItem = {
  description: string;
  period: { start: string; end: string };
  quantity: number;
  unit_amount: number;
  amount: number;
  currency: string;
};

export type InvoicePreview = {
  subscription_id: string;
  period_end: string;
  currency: string;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
};

/** What a customer was charged. */
export type Charge = {
  id: string;
  account_id: string;
  customer_id: string;
  subscription_id: string | null;
  processor_charge_id: string;
  amount: number;
  currency: string;
  description: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChargePage = { data: Charge[]; page: Page };

/**
 * The body of `POST /v1/subscriptions`.
 *
 * `success_url` is REQUIRED because Stripe requires it on a hosted Checkout
 * Session: the live recording caught this service sending a session without
 * one and Stripe refusing it outright, so the door could not open until the
 * field arrived. It is the caller's URL — the page a buyer lands on is the
 * app's — and `cancel_url` defaults to it at the service.
 *
 * `POST /v1/checkouts` (the development door) ignores both: its checkout
 * completes in the request, so there is no page to return to.
 */
export type CheckoutRequest = {
  customer_id: string;
  plan_id: string;
  quantity?: number;
  success_url?: string;
  cancel_url?: string;
};

/**
 * The production door's 201: a hosted Checkout session, and no subscription
 * exists yet — the row arrives when the processor's webhook says one does.
 */
export type CheckoutSession = {
  checkout_session_id: string;
  checkout_url: string;
  customer_id: string;
  plan_id: string;
};

/** The body of `POST /v1/subscriptions/{id}/cancel`. */
export type CancelRequest = { at_period_end: boolean };

/** The body of `POST /v1/subscriptions/{id}/change_plan`. */
export type ChangePlanRequest = { plan_id: string };

/** Whether a plan change takes effect now or at the renewal, and on what terms. */
export type PlanChangeDecision = {
  plan_id: string;
  effective: "immediately" | "period_end";
  proration: "always_invoice" | "none";
};

export type SubscriptionWithPlanChange = Subscription & { plan_change: PlanChangeDecision };

/** The body of `POST /v1/subscriptions/{id}/payment_method`. */
export type PaymentMethodRequest = { return_url: string };

/** The processor's own portal URL, for one visit. */
export type PaymentMethodUrl = { payment_method_url: string };

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

/**
 * Property declarations rather than method shorthand, for the same reason and
 * with the same reasoning as `IdentityClient` in `src/lib/identity.ts`: a
 * method signature tells TypeScript the member has a `this`, so reading one off
 * the object is "a method separated from its object" and
 * `@typescript-eslint/unbound-method` rejects it. `createBillingClient` below
 * returns arrow functions closing over `transport` and `base`, so there is no
 * `this` to lose. The two clients spell their types the same way because they
 * are the same shape of thing — a boundary this app injects a stub into — and a
 * reader comparing the two files is reading one decision rather than two.
 */
export type BillingClient = {
  listPlans: (options?: { cursor?: string; limit?: number; order?: "asc" | "desc" }) => Promise<PlanPage>;
  getPlanBySlug: (slug: string) => Promise<Plan>;
  listCustomers: (options?: { cursor?: string; limit?: number }) => Promise<CustomerPage>;
  getCustomer: (id: string) => Promise<Customer>;
  /**
   * Creates a customer. The second argument is the `Idempotency-Key` uuid: pass
   * the same one to retry the same intent, or leave it and a fresh one is
   * generated per call.
   */
  createCustomer: (input: CustomerCreate, idempotencyKey?: string) => Promise<Customer>;
  listSubscriptions: (options?: { cursor?: string; limit?: number }) => Promise<SubscriptionPage>;
  getSubscription: (id: string) => Promise<Subscription>;
  getEntitlements: (id: string) => Promise<Entitlements>;
  getUpcomingInvoice: (id: string) => Promise<InvoicePreview>;
  /**
   * The production door. Returns a Checkout session; **no subscription is
   * created by this request**, so a screen must not say "you are subscribed"
   * after a 201 — the row arrives on the processor's webhook.
   */
  startSubscriptionCheckout: (input: CheckoutRequest, idempotencyKey?: string) => Promise<CheckoutSession>;
  cancelSubscription: (id: string, input: CancelRequest, idempotencyKey?: string) => Promise<Subscription>;
  changeSubscriptionPlan: (
    id: string,
    input: ChangePlanRequest,
    idempotencyKey?: string,
  ) => Promise<SubscriptionWithPlanChange>;
  /**
   * The development door. Completes against the fake processor, so the reply
   * IS a subscription — unlike `startSubscriptionCheckout`. Answers 404 where
   * the deployment has not enabled it.
   */
  completeCheckout: (input: CheckoutRequest, idempotencyKey?: string) => Promise<Subscription>;
  listCharges: (options?: { cursor?: string; limit?: number }) => Promise<ChargePage>;
  createPaymentMethodUrl: (id: string, input: PaymentMethodRequest, idempotencyKey?: string) => Promise<PaymentMethodUrl>;
};

/**
 * The `code` on a `BillingError` that means "this deployment has no billing
 * configured", as distinct from "billing is unreachable" or "billing refused".
 *
 * The forwarder (`src/lib/upstream.ts`) answers a billing route with a 503
 * carrying this code when `BILLING_URL` is unset, so the two ways a billing
 * call can fail — "not configured" and "configured but broken" — are told
 * apart by the screens rather than collapsed into one transport error. It lives
 * here rather than in the forwarder because the forwarder is server-only and
 * the screens that branch on it are client code, and a constant both reach for
 * has to be somewhere both can import.
 */
export const BILLING_NOT_CONFIGURED_CODE = "billing_not_configured";

/**
 * The `code` on the 502 this app answers a billing route with when the
 * SESSION-TO-TOKEN EXCHANGE cannot be completed.
 *
 * Billing's bearer is not the caller's token: the browser sends identity's
 * opaque session token and billing verifies RS256 tokens with a singular
 * `account_id`, so this app exchanges the session for one at identity before
 * forwarding (`src/lib/billing-token.server.ts`). When identity does not
 * answer, or answers something this app cannot use, the billing request never
 * happens and the failure is THIS app's — which is what the code is for: the
 * screens can tell "we could not reach billing" from "we could not reach
 * identity to ask for billing's key", rather than both being a 502.
 */
export const BILLING_TOKEN_UNAVAILABLE_CODE = "billing_token_unavailable";

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
  options: { baseUrl?: string; transport?: BillingTransport; token?: string | null } = {},
): BillingClient {
  const base = (options.baseUrl ?? BILLING_BASE_URL).replace(/\/+$/, "");
  const inner = options.transport ?? fetchTransport;

  // THE BEARER, AND WHO PUTS IT THERE. The browsers' request carries the
  // identity SESSION token in `authorization`, because that is the only
  // credential a signed-in browser has, and the BFF (`src/lib/upstream.ts`)
  // EXCHANGES it for one billing reads: the browser's token is never
  // forwarded to billing, and what crosses is the minted account-scoped
  // token. Without this line the browser's billing calls carry no credential
  // at all, the exchange has nothing to work with, and the BFF forwards the
  // request bare — the screens answered "billing could not be reached"
  // while the API itself was answering 200 to an exchange it was never asked
  // to perform. Measured on the launch stack, 2026-10-16.
  const transport: BillingTransport = (request) => {
    const headers = { ...request.headers };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    return inner({ ...request, headers });
  };

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
    listSubscriptions: (query) => send(transport, `${base}/v1/subscriptions${queryString(query)}`, "GET"),
    getSubscription: (id) => send(transport, `${base}/v1/subscriptions/${encodeURIComponent(id)}`, "GET"),
    getEntitlements: (id) =>
      send(transport, `${base}/v1/subscriptions/${encodeURIComponent(id)}/entitlements`, "GET"),
    getUpcomingInvoice: (id) =>
      send(transport, `${base}/v1/subscriptions/${encodeURIComponent(id)}/upcoming_invoice`, "GET"),
    startSubscriptionCheckout: (input, idempotencyKey) =>
      send(transport, `${base}/v1/subscriptions`, "POST", {
        body: input,
        headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
      }),
    cancelSubscription: (id, input, idempotencyKey) =>
      send(transport, `${base}/v1/subscriptions/${encodeURIComponent(id)}/cancel`, "POST", {
        body: input,
        headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
      }),
    changeSubscriptionPlan: (id, input, idempotencyKey) =>
      send(transport, `${base}/v1/subscriptions/${encodeURIComponent(id)}/change_plan`, "POST", {
        body: input,
        headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
      }),
    completeCheckout: (input, idempotencyKey) =>
      send(transport, `${base}/v1/checkouts`, "POST", {
        body: input,
        headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() },
      }),
    listCharges: (query) => send(transport, `${base}/v1/charges${queryString(query)}`, "GET"),
    createPaymentMethodUrl: (id, input, idempotencyKey) =>
      send(transport, `${base}/v1/subscriptions/${encodeURIComponent(id)}/payment_method`, "POST", {
        body: input,
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

const SUBSCRIPTION_STATUSES: readonly string[] = ["trialing", "active", "past_due", "canceled", "unpaid"];

export function isSubscription(value: unknown): value is Subscription {
  const record = asRecord(value);
  if (!record) return false;

  return (
    typeof record.id === "string" &&
    typeof record.account_id === "string" &&
    typeof record.plan_id === "string" &&
    typeof record.plan_slug === "string" &&
    typeof record.customer_id === "string" &&
    typeof record.processor_subscription_id === "string" &&
    typeof record.status === "string" &&
    SUBSCRIPTION_STATUSES.includes(record.status) &&
    isMoney(record.price) &&
    isStringOrNull(record.current_period_start) &&
    isStringOrNull(record.current_period_end) &&
    typeof record.cancel_at_period_end === "boolean" &&
    isStringOrNull(record.canceled_at) &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string"
  );
}

export function isInvoicePreview(value: unknown): value is InvoicePreview {
  const record = asRecord(value);
  if (!record) return false;
  if (!Array.isArray(record.line_items)) return false;

  return (
    typeof record.subscription_id === "string" &&
    typeof record.period_end === "string" &&
    typeof record.currency === "string" &&
    typeof record.subtotal === "number" &&
    typeof record.tax === "number" &&
    typeof record.total === "number" &&
    record.line_items.every((line) => {
      const row = asRecord(line);
      return (
        row !== null &&
        typeof row.description === "string" &&
        typeof row.quantity === "number" &&
        typeof row.unit_amount === "number" &&
        typeof row.amount === "number" &&
        typeof row.currency === "string"
      );
    })
  );
}

export function isCharge(value: unknown): value is Charge {
  const record = asRecord(value);
  if (!record) return false;

  return (
    typeof record.id === "string" &&
    typeof record.account_id === "string" &&
    typeof record.customer_id === "string" &&
    isStringOrNull(record.subscription_id) &&
    typeof record.processor_charge_id === "string" &&
    typeof record.amount === "number" &&
    typeof record.currency === "string" &&
    isStringOrNull(record.description) &&
    isStringOrNull(record.paid_at) &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string"
  );
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
    isPlanEntitlements(record.entitlements) &&
    typeof record.active === "boolean" &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string"
  );
}

function isPlanEntitlements(value: unknown): value is PlanEntitlements {
  const record = asRecord(value);
  if (!record) return false;
  if (!Array.isArray(record.features)) return false;
  const limits = asRecord(record.limits);
  if (!limits) return false;

  return (
    record.features.every((entry) => typeof entry === "string") &&
    Object.values(limits).every((entry) => typeof entry === "number")
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
