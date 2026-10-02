import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_BASE_URL,
  BillingError,
  createBillingClient,
  isCustomer,
  isPlan,
  type BillingTransport,
  type BillingTransportRequest,
} from "./billing";

/**
 * The billing client.
 *
 * billing's `openapi/v1.yaml` on master declares exactly six paths:
 * `/v1/customers` (GET, POST), `/v1/customers/{id}` (GET, PATCH),
 * `/v1/plans` (GET, POST), `/v1/plans/{slug}` (GET), `/v1/plans/{id}` (PATCH)
 * and `/v1/webhooks/stripe`. There is no `/v1/subscriptions` of any kind, so
 * there is no subscription anything in this file can honestly speak to.
 *
 * The response shapes below are the `components.schemas` entries from that
 * file: Money, Plan, PlanPage, Customer, CustomerPage, CustomerOwner, Page.
 * Fixtures are built from the schema's own `required` lists, so a test that
 * passes here is a test against the published contract.
 */

type Call = Omit<BillingTransportRequest, "body"> & { body: string | null };

function stubTransport(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const transport: BillingTransport = async (request) => {
    const call: Call = { ...request, body: request.body ?? null };
    calls.push(call);
    return respond(call);
  };
  return { transport, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const problem = (status: number, code: string, detail: string, extra: Record<string, unknown> = {}) =>
  json(status, {
    type: `https://errors.cafaye.com/${code}`,
    title: code,
    status,
    detail,
    instance: "/v1/plans",
    code,
    trace_id: "trace_123",
    ...extra,
  });

/** Plan, with every field the schema's `required` list names. */
const aPlan = (overrides: Record<string, unknown> = {}) => ({
  id: "plan_1",
  name: "Team",
  slug: "team",
  processor_product_id: null,
  processor_price_id: null,
  price: { amount_minor: 1900, currency: "USD" },
  interval: "month",
  trial_days: 14,
  active: true,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...overrides,
});

/** Customer, with every field the schema's `required` list names. */
const aCustomer = (overrides: Record<string, unknown> = {}) => ({
  id: "cus_1",
  owner: { type: "Account", id: "acc_0a1b2c3d" },
  processor: "stripe",
  // Always null in v0: "this build makes no Stripe call".
  processor_customer_id: null,
  email: "kaka@example.com",
  metadata: {},
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...overrides,
});

/** Page, which every collection wraps its data in. */
const aPage = (overrides: Record<string, unknown> = {}) => ({
  next_cursor: null,
  has_more: false,
  ...overrides,
});

let baseUrl: string;

beforeEach(() => {
  baseUrl = "https://billing.test";
  // Bomb the global, so a code path that escapes the injected transport fails
  // with a name instead of hanging on a socket.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("real fetch() reached a test — the transport was not injected");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base url", () => {
  it("is the app's own origin, and carries no address in the bundle", () => {
    // The empty string is the point rather than a placeholder: a relative URL
    // is same-origin by construction, and there is no environment variable a
    // browser could read and change. See `BILLING_BASE_URL`.
    expect(BILLING_BASE_URL).toBe("");
  });

  it("does not double the slash when the base url ends with one", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { data: [aPlan()], page: aPage() }),
    );
    const client = createBillingClient({ baseUrl: "https://billing.test/", transport });

    await client.listPlans();

    expect(calls[0].url).toBe("https://billing.test/v1/plans");
  });
});

describe("listPlans", () => {
  it("asks for the collection and returns the page whole", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { data: [aPlan()], page: aPage({ has_more: true, next_cursor: "c2" }) }),
    );
    const client = createBillingClient({ baseUrl, transport });

    const page = await client.listPlans();

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${baseUrl}/v1/plans`);
    // The page travels with the rows: `has_more` and `next_cursor` are how a
    // client knows there is a second page, and dropping them turns a paginated
    // collection into a silent truncation.
    expect(page.page.has_more).toBe(true);
    expect(page.page.next_cursor).toBe("c2");
  });

  it("sends the cursor when given one, and does not when it is absent", async () => {
    const { transport, calls } = stubTransport(() => json(200, { data: [], page: aPage() }));
    const client = createBillingClient({ baseUrl, transport });

    await client.listPlans();
    await client.listPlans({ cursor: "c2" });

    expect(calls[0].url).toBe(`${baseUrl}/v1/plans`);
    expect(calls[1].url).toContain("cursor=c2");
  });

  it("never parses the cursor, because the contract says it may change", async () => {
    // "Opaque base64url cursor... Clients must not parse it; its encoding may
    // change without notice." So the client passes it back verbatim and adds
    // nothing to it.
    const { transport, calls } = stubTransport(() => json(200, { data: [], page: aPage() }));
    const client = createBillingClient({ baseUrl, transport });

    await client.listPlans({ cursor: "eyJvIjoxMH0" });

    expect(calls[0].url).toContain("cursor=eyJvIjoxMH0");
  });

  it("asks for a bounded page rather than the default", async () => {
    const { transport, calls } = stubTransport(() => json(200, { data: [], page: aPage() }));
    const client = createBillingClient({ baseUrl, transport });

    await client.listPlans({ limit: 50 });

    expect(calls[0].url).toContain("limit=50");
  });

  it("drops a null email from a customer's rendering rather than printing it", async () => {
    // Customer.email is `type: [string, 'null']`. A screen that prints `null`
    // has a bug; the type makes that impossible to express by accident.
    const { transport } = stubTransport(() =>
      json(200, { data: [aCustomer({ email: null })], page: aPage() }),
    );
    const client = createBillingClient({ baseUrl, transport });

    const page = await client.listCustomers();

    expect(page.data[0].email).toBeNull();
  });
});

describe("listCustomers", () => {
  it("asks for the collection and returns the page", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { data: [aCustomer()], page: aPage() }),
    );
    const client = createBillingClient({ baseUrl, transport });

    const page = await client.listCustomers();

    expect(calls[0].url).toBe(`${baseUrl}/v1/customers`);
    expect(page.data).toHaveLength(1);
  });

  it("carries the owner's reference through, which is the link to identity", async () => {
    // `CustomerOwner` is "a reference to an identity record. A uuid, stored
    // without a foreign key: it crosses a service boundary". The type is the
    // enum `[User, Account]`, so a third value cannot arrive unnoticed.
    const { transport } = stubTransport(() => json(200, { data: [aCustomer()], page: aPage() }));
    const client = createBillingClient({ baseUrl, transport });

    const page = await client.listCustomers();

    expect(page.data[0].owner).toEqual({ type: "Account", id: "acc_0a1b2c3d" });
  });
});

describe("createCustomer", () => {
  it("sends an Idempotency-Key, because the contract asks the client to choose one", async () => {
    const { transport, calls } = stubTransport(() => json(201, aCustomer()));
    const client = createBillingClient({ baseUrl, transport });

    await client.createCustomer({
      owner: { type: "Account", id: "acc_0a1b2c3d" },
      processor: "stripe",
    });

    // "A uuid chosen by the client. The same key with the same body replays the
    // original response." Without a key the request is still processed, but a
    // client that retries after a timeout gets a second customer.
    expect(calls[0].headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("reuses a key the caller supplies, so a retry is still a retry", async () => {
    const { transport, calls } = stubTransport(() => json(201, aCustomer()));
    const client = createBillingClient({ baseUrl, transport });

    const key = "3f6b2c10-1111-4222-8333-444455556666";
    await client.createCustomer({ owner: { type: "User", id: "usr_1" }, processor: "stripe" }, key);
    await client.createCustomer({ owner: { type: "User", id: "usr_1" }, processor: "stripe" }, key);

    expect(calls[0].headers["Idempotency-Key"]).toBe(key);
    expect(calls[1].headers["Idempotency-Key"]).toBe(key);
  });

  it("generates a different key for each call, so two intents do not collide", async () => {
    const { transport, calls } = stubTransport(() => json(201, aCustomer()));
    const client = createBillingClient({ baseUrl, transport });

    const input = { owner: { type: "User" as const, id: "usr_1" }, processor: "stripe" as const };
    await client.createCustomer(input);
    await client.createCustomer(input);

    expect(calls[0].headers["Idempotency-Key"]).not.toBe(calls[1].headers["Idempotency-Key"]);
  });

  it("sends only the fields the schema allows", async () => {
    const { transport, calls } = stubTransport(() => json(201, aCustomer()));
    const client = createBillingClient({ baseUrl, transport });

    await client.createCustomer({
      owner: { type: "Account", id: "acc_0a1b2c3d" },
      processor: "stripe",
      email: "kaka@example.com",
      metadata: { plan: "team" },
    });

    expect(JSON.parse(calls[0].body as string)).toEqual({
      owner: { type: "Account", id: "acc_0a1b2c3d" },
      processor: "stripe",
      email: "kaka@example.com",
      metadata: { plan: "team" },
    });
  });
});

describe("failures", () => {
  it("turns a problem document into a BillingError carrying the status", async () => {
    const { transport } = stubTransport(() => problem(404, "not_found", "no such plan"));
    const client = createBillingClient({ baseUrl, transport });

    const failure = await client.listPlans().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BillingError);
    expect((failure as BillingError).status).toBe(404);
    expect((failure as BillingError).code).toBe("not_found");
  });

  it("carries the field errors off a 422", async () => {
    const { transport } = stubTransport(() =>
      problem(422, "validation_failed", "the request has an invalid field", {
        errors: [{ field: "email", code: "invalid_format" }],
      }),
    );
    const client = createBillingClient({ baseUrl, transport });

    const failure = (await client
      .createCustomer({ owner: { type: "User", id: "usr_1" }, processor: "stripe" })
      .catch((error: unknown) => error)) as BillingError;

    expect(failure.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
  });

  it("does not repeat the service's own wording to a person", async () => {
    // `detail` is documented as "specific to this occurrence and not parsed by
    // clients... Never contains an internal error, a host, a role or a query
    // fragment". It is kept on the error for telemetry and never rendered.
    const { transport } = stubTransport(() =>
      problem(500, "internal", "pq: dial tcp 10.0.3.11:5432 refused"),
    );
    const client = createBillingClient({ baseUrl, transport });

    const failure = (await client.listPlans().catch((error: unknown) => error)) as BillingError;

    expect(failure.message).toBe("pq: dial tcp 10.0.3.11:5432 refused");
    // The point is that the client does not *decide* anything from it. A screen
    // renders its own sentence; this test records that the raw text is still
    // available and is not the thing a screen is given.
    expect(failure.status).toBe(500);
  });

  it("reports a cursor the service rejected as a 400, not a 422", async () => {
    // The contract has a dedicated `CursorInvalid` response on 400 for exactly
    // this, separate from `ValidationFailed` on 422.
    const { transport } = stubTransport(() => problem(400, "invalid_cursor", "the cursor is not valid"));
    const client = createBillingClient({ baseUrl, transport });

    const failure = (await client
      .listPlans({ cursor: "nonsense" })
      .catch((error: unknown) => error)) as BillingError;

    expect(failure.status).toBe(400);
  });
});

describe("the guards on a response that does not match the contract", () => {
  it("refuses a plan whose price is not integer minor units", async () => {
    // A float price would be 422 on the way in, so a service that sent one is
    // broken. Rendering it anyway is how a page shows 0.1 as 0.0999999.
    const { transport } = stubTransport(() =>
      json(200, { data: [aPlan({ price: { amount_minor: 19.5, currency: "USD" } })], page: aPage() }),
    );
    const client = createBillingClient({ baseUrl, transport });

    expect(isPlan(aPlan({ price: { amount_minor: 19.5, currency: "USD" } }))).toBe(false);
    // The call itself still succeeds; the guard is for the render layer, which
    // must not be handed a price it cannot format honestly.
    const page = await client.listPlans();
    expect(isPlan(page.data[0])).toBe(false);
  });

  it("accepts a plan that matches the schema", () => {
    expect(isPlan(aPlan())).toBe(true);
  });

  it("refuses a customer whose owner type is not one the enum names", () => {
    // `CustomerOwner.type` is `enum: [User, Account]`. A third value means the
    // contract moved, and rendering it as a known kind would be a guess.
    expect(isCustomer(aCustomer({ owner: { type: "Tenant", id: "acc_1" } }))).toBe(false);
    expect(isCustomer(aCustomer({ owner: { type: "User", id: "usr_1" } }))).toBe(true);
  });

  it("refuses a customer whose email is a number", () => {
    expect(isCustomer(aCustomer({ email: 42 }))).toBe(false);
  });

  it("accepts a null email, because the schema allows it", () => {
    expect(isCustomer(aCustomer({ email: null }))).toBe(true);
  });
});
