/**
 * The operator client: the contract's four routes, read strictly.
 *
 * Every test drives `transport`, never `fetch` — `beforeEach` bombs the
 * global, so a test that reached a socket fails loudly rather than slowly.
 * The API is unmerged, so the stub IS the contract witness: if the merged
 * service answers a different shape, these are the assertions that go red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityError, type Transport, type TransportRequest } from "./identity";
import {
  OPERATOR_SEARCH_LIMIT,
  createOperatorClient,
  type OperatorUser,
} from "./operator";

type Call = Omit<TransportRequest, "body"> & { body: string | null };

function stubTransport(
  respond: (call: Call) => Response | Promise<Response>,
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = async (request) => {
    const call: Call = { ...request, body: request.body ?? null };
    calls.push(call);
    return respond(call);
  };
  return { transport, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const problem = (status: number, code: string, title: string) =>
  json(status, {
    type: `https://docs.cafaye.com/errors/${code}`,
    title,
    status,
    code,
    trace_id: "trace_123",
  });

async function theFailure(promise: Promise<unknown>): Promise<IdentityError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityError);
    return error as IdentityError;
  }
  throw new Error("expected the call to fail, but it resolved");
}

const STAFF_ME = { user: { id: "op-1", email: "op@example.com", staff: true } };

const USER_ROW = {
  id: "8f2c1a44-0000-4000-8000-000000000001",
  email: "kaka@example.com",
  display_name: "Kaka",
  disabled_at: null,
  email_verified_at: "2026-09-01T00:00:00Z",
  created_at: "2026-08-01T00:00:00Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("real fetch() reached a test — the operator client was not given a seam");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator/me", () => {
  it("reads staff from the contract shape", async () => {
    const { transport, calls } = stubTransport(() => json(200, STAFF_ME));
    const client = createOperatorClient({ transport });

    const me = await client.me("session-token");

    expect(me).toEqual(STAFF_ME);
    expect(calls[0].url).toBe("/v1/operator/me");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer session-token");
  });

  it("reads a non-staff answer without flattening it", async () => {
    const { transport } = stubTransport(() =>
      json(200, { user: { id: "u-9", email: "kaka@example.com", staff: false } }),
    );
    const client = createOperatorClient({ transport });

    const me = await client.me("session-token");

    expect(me.user.staff).toBe(false);
  });

  it("refuses a body missing staff rather than reading it as denied", async () => {
    const { transport } = stubTransport(() =>
      json(200, { user: { id: "u-9", email: "kaka@example.com" } }),
    );
    const client = createOperatorClient({ transport });

    const failure = await theFailure(client.me("session-token"));

    expect(failure.code).toBe("internal");
  });

  it("keeps anonymous (401) and non-staff (403) apart", async () => {
    const anonymous = stubTransport(() => problem(401, "unauthenticated", "Sign in."));
    const forbidden = stubTransport(() => problem(403, "forbidden", "Staff only."));

    const anonymousFailure = await theFailure(
      createOperatorClient({ transport: anonymous.transport }).me("dead-token"),
    );
    const forbiddenFailure = await theFailure(
      createOperatorClient({ transport: forbidden.transport }).me("live-token"),
    );

    expect(anonymousFailure.status).toBe(401);
    expect(forbiddenFailure.status).toBe(403);
  });
});

describe("operator/users search", () => {
  it("sends the query with the contract's page size", async () => {
    const { transport, calls } = stubTransport(() => json(200, { users: [USER_ROW] }));
    const client = createOperatorClient({ transport });

    const users = await client.searchUsers("session-token", "kaka@example.com");

    expect(users).toHaveLength(1);
    expect(calls[0].url).toBe(
      `/v1/operator/users?query=${encodeURIComponent("kaka@example.com")}&limit=${OPERATOR_SEARCH_LIMIT}`,
    );
    expect(calls[0].headers.Authorization).toBe("Bearer session-token");
  });

  it("reads nulls as nulls, never as invented timestamps", async () => {
    const row = { ...USER_ROW, display_name: null, disabled_at: null, email_verified_at: null };
    const { transport } = stubTransport(() => json(200, { users: [row] }));
    const client = createOperatorClient({ transport });

    const [user] = await client.searchUsers("session-token", "kaka");

    expect(user satisfies OperatorUser | undefined).toEqual(row);
  });

  it("never sends an empty query to the wire", async () => {
    const { transport, calls } = stubTransport(() => json(200, { users: [] }));
    const client = createOperatorClient({ transport });

    expect(() => client.searchUsers("session-token", "   ")).toThrow(/non-empty/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a 422 for a query the service refuses", async () => {
    const { transport } = stubTransport(() => problem(422, "invalid", "Not valid."));
    const client = createOperatorClient({ transport });

    const failure = await theFailure(client.searchUsers("session-token", "x"));

    expect(failure.status).toBe(422);
  });

  it("refuses a row missing its id rather than rendering half a user", async () => {
    const { transport } = stubTransport(() => json(200, { users: [{ email: "kaka@example.com" }] }));
    const client = createOperatorClient({ transport });

    const failure = await theFailure(client.searchUsers("session-token", "kaka"));

    expect(failure.code).toBe("internal");
  });

  it("accepts an omitted display_name as null (omitempty upstream)", async () => {
    // Identity tags `display_name` `json:"display_name,omitempty"`, so
    // absence is a valid answer and normalizes to null — unlike the two
    // timestamp keys, which the contract promises as null keys.
    const { display_name: _dropped, ...rowWithoutName } = USER_ROW;
    void _dropped;
    const { transport } = stubTransport(() => json(200, { users: [rowWithoutName] }));
    const client = createOperatorClient({ transport });

    const [user] = await client.searchUsers("session-token", "kaka");

    expect(user?.display_name).toBeNull();
  });

  it("refuses a row with an absent disabled_at rather than defaulting it to null", async () => {
    // The contract promises the timestamp keys as null keys: an absent one is
    // a shape nobody described, and defaulting it would render a disabled
    // state the service never sent.
    const { disabled_at: _dropped, ...rowWithoutKey } = USER_ROW;
    void _dropped;
    const { transport, calls } = stubTransport(() => json(200, { users: [rowWithoutKey] }));
    const client = createOperatorClient({ transport });

    const failure = await theFailure(client.searchUsers("session-token", "kaka"));

    expect(failure.code).toBe("internal");
    expect(calls).toHaveLength(1);
  });

  it("refuses a row with an absent email_verified_at rather than defaulting it to null", async () => {
    const { email_verified_at: _dropped, ...rowWithoutKey } = USER_ROW;
    void _dropped;
    const { transport } = stubTransport(() => json(200, { users: [rowWithoutKey] }));
    const client = createOperatorClient({ transport });

    const failure = await theFailure(client.searchUsers("session-token", "kaka"));

    expect(failure.code).toBe("internal");
  });
});

describe("disable and enable", () => {
  it("posts disable to the contract path with the session", async () => {
    const id = "8f2c1a44-0000-4000-8000-000000000001";
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createOperatorClient({ transport });

    await client.disableUser("session-token", id);

    expect(calls[0].url).toBe(`/v1/operator/users/${id}/disable`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Bearer session-token");
  });

  it("posts enable to the contract path with the session", async () => {
    const id = "8f2c1a44-0000-4000-8000-000000000001";
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createOperatorClient({ transport });

    await client.enableUser("session-token", id);

    expect(calls[0].url).toBe(`/v1/operator/users/${id}/enable`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Bearer session-token");
  });

  it("surfaces a 404 for a user that is gone", async () => {
    const { transport } = stubTransport(() => problem(404, "not_found", "No such user."));
    const client = createOperatorClient({ transport });

    const failure = await theFailure(
      client.disableUser("session-token", "8f2c1a44-0000-4000-8000-000000000001"),
    );

    expect(failure.status).toBe(404);
  });

  it("surfaces a 403 when a non-staff session reaches for disable", async () => {
    const { transport } = stubTransport(() => problem(403, "forbidden", "Staff only."));
    const client = createOperatorClient({ transport });

    const failure = await theFailure(
      client.enableUser("session-token", "8f2c1a44-0000-4000-8000-000000000001"),
    );

    expect(failure.status).toBe(403);
  });

  it("sends no machine key and no second credential", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createOperatorClient({ transport });

    await client.disableUser("session-token", "8f2c1a44-0000-4000-8000-000000000001");

    const names = Object.keys(calls[0].headers).map((name) => name.toLowerCase());
    expect(names).toEqual(["accept", "authorization"]);
  });
});
