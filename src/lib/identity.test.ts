import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDENTITY_BASE_URL,
  MIN_PASSWORD_LENGTH,
  IdentityError,
  createIdentityClient,
  fieldErrorMessage,
  type Transport,
  type TransportRequest,
} from "./identity";
import { MAX_NAME_LENGTH } from "./roles";

/**
 * Hand-rolled transport. No msw: the surface is four endpoints, and a recording
 * stub is a smaller thing to trust than a request-interception layer.
 *
 * Every test drives `transport`, never `fetch`. A real fetch would mean a real
 * socket to localhost:8080 — which is exactly the flakiness this packet is
 * trying to avoid — so `beforeEach` also replaces the global with a bomb.
 */
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

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const problem = (
  status: number,
  fields: {
    code: string;
    title: string;
    detail?: string;
    errors?: { field: string; code: string }[];
  },
  headers: Record<string, string> = {},
) =>
  json(
    status,
    {
      type: `https://errors.cafaye.com/${fields.code}`,
      title: fields.title,
      status,
      detail: fields.detail,
      code: fields.code,
      trace_id: "trace_123",
      ...(fields.errors ? { errors: fields.errors } : {}),
    },
    headers,
  );

const CREDENTIALS = { email: "kaka@example.com", password: "correct horse" };

/**
 * A minted signup timestamp pair, as `POST /v1/signup-timestamp` answers it.
 *
 * Identity verifies the pair on `POST /v1/users` — a forged, instant or
 * expired pair is refused with the same generic 422 as any other validation
 * failure — so a registration that does not carry one cannot succeed against
 * a live service.
 */
const PAIR = { timestamp: 1759843200, signature: "minted-signature" };
const REGISTRATION = { ...CREDENTIALS, ...PAIR, website: "" };

/**
 * Awaits a call that must fail and hands back the `IdentityError`.
 *
 * Better than `.catch(error => error as IdentityError)`, which types as
 * `T | IdentityError` and so lets a test read `.status` off a success value —
 * and which silently passes if the call resolves, since there is no failure to
 * notice. This one throws if the promise resolved, so "it failed" is part of
 * what the test proved.
 */
async function theFailure(promise: Promise<unknown>): Promise<IdentityError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IdentityError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused, but it resolved");
}

let baseUrl: string;

beforeEach(() => {
  baseUrl = "https://identity.test";
  // Bomb the global. If a code path ever escapes the injected transport, the
  // test fails here with a name, instead of hanging on a socket.
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
    // browser could read and change. `NEXT_PUBLIC_IDENTITY_URL` was inlined
    // into the client bundle at build time, which is what made a deployed
    // sign-in a cross-origin call identity refused to answer.
    expect(IDENTITY_BASE_URL).toBe("");
  });

  it("builds every path relative to that origin", async () => {
    const { transport, calls } = stubTransport(() => json(200, { id: "usr_1", email: CREDENTIALS.email }));
    const client = createIdentityClient({ transport });

    await client.me("tok");

    expect(calls[0].url).toBe("/v1/me");
  });
});

describe("register", () => {
  it("posts the credentials and the signed timestamp pair to /v1/users as JSON", async () => {
    const { transport, calls } = stubTransport(() => json(201, { id: "usr_1", email: CREDENTIALS.email }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.register(REGISTRATION);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://identity.test/v1/users");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual(REGISTRATION);
  });

  it("carries the empty website honeypot with the signed pair", async () => {
    // `POST /v1/users` takes a request-only `website` honeypot alongside the
    // `{timestamp, signature}` pair: the register form renders it empty, a
    // person never fills it, and identity refuses a non-empty one with the
    // same generic 422 as any other validation failure — before any row is
    // created. The wire body carries all three, so a registration that omits
    // the field is one the form never sent.
    const { transport, calls } = stubTransport(() => json(201, { id: "usr_1", email: CREDENTIALS.email }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.register({ ...REGISTRATION, website: "" });

    expect(JSON.parse(calls[0].body ?? "null")).toEqual({ ...REGISTRATION, website: "" });
  });

  it("sends no bearer token when registering", async () => {
    const { transport, calls } = stubTransport(() => json(201, { id: "usr_1", email: CREDENTIALS.email }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.register(REGISTRATION);

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("returns the created user on 201", async () => {
    const { transport } = stubTransport(() => json(201, { id: "usr_1", email: "kaka@example.com" }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.register(REGISTRATION)).resolves.toEqual({
      id: "usr_1",
      email: "kaka@example.com",
    });
  });

  it("surfaces per-field failures from a 422", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        detail: "email is not a deliverable address",
        errors: [{ field: "email", code: "invalid_format" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await client.register(REGISTRATION).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IdentityError);
    const identityError = error as IdentityError;
    expect(identityError.status).toBe(422);
    expect(identityError.code).toBe("validation_failed");
    expect(identityError.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
    expect(identityError.traceId).toBe("trace_123");
  });

  it("reports a taken address as a conflict, not a validation failure", async () => {
    const { transport } = stubTransport(() =>
      problem(409, {
        code: "conflict",
        title: "Conflict",
        detail: "email already registered",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .register(REGISTRATION)
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.code).toBe("conflict");
    expect(error.fieldErrors).toEqual([]);
  });
});

describe("mintSignupTimestamp", () => {
  it("posts to /v1/signup-timestamp with no body", async () => {
    const { transport, calls } = stubTransport(() => json(200, PAIR));
    const client = createIdentityClient({ baseUrl, transport });

    await client.mintSignupTimestamp();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://identity.test/v1/signup-timestamp");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toBeNull();
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("sends no bearer token when minting", async () => {
    const { transport, calls } = stubTransport(() => json(200, PAIR));
    const client = createIdentityClient({ baseUrl, transport });

    await client.mintSignupTimestamp();

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("returns the minted pair on 200", async () => {
    const { transport } = stubTransport(() => json(200, PAIR));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.mintSignupTimestamp()).resolves.toEqual(PAIR);
  });
});

describe("login", () => {
  it("posts the credentials to /v1/session", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.login(CREDENTIALS);

    expect(calls[0].url).toBe("https://identity.test/v1/session");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual(CREDENTIALS);
  });

  it("returns the token and expiry on 200", async () => {
    const { transport } = stubTransport(() =>
      json(200, { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    // The 200 arm is the session half of the union, and the token lives inside
    // it rather than at the top level: a caller that read `token` off the result
    // would find nothing on the 202 arm, and "nothing" is the one answer that
    // must never render as a signed-in state.
    await expect(client.login(CREDENTIALS)).resolves.toEqual({
      kind: "session",
      session: { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" },
    });
  });

  it("sends no bearer token when logging in", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.login(CREDENTIALS);

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("raises an unauthorized error on 401", async () => {
    const { transport } = stubTransport(() =>
      problem(401, { code: "unauthorized", title: "Unauthorized" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client.login(CREDENTIALS).catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error).toBeInstanceOf(IdentityError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("unauthorized");
  });

  it("answers a second-factor account with the 202 as a result, not a throw", async () => {
    // The 202 is a success — the credentials were accepted and a second factor
    // is owed — so it resolves. A version that routed it through `send`'s
    // failure path would throw, and the login screen would render "Invalid
    // email or password" for a person whose password was just accepted.
    const { transport } = stubTransport(() =>
      json(202, { mfa_required: true, challenge: "ch_1", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const result = await client.login(CREDENTIALS);

    expect(result.kind).toBe("mfa_required");
  });

  it("carries the challenge and its expiry through", async () => {
    const { transport, calls } = stubTransport(() =>
      json(202, { mfa_required: true, challenge: "ch_1", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const result = await client.login(CREDENTIALS);

    expect(result).toEqual({
      kind: "mfa_required",
      challenge: "ch_1",
      expiresAt: "2026-10-01T00:00:00Z",
    });
    // The 202 is still the ordinary login request — same URL, same method,
    // same body. Only the answer differs.
    expect(calls[0].url).toBe("https://identity.test/v1/session");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual(CREDENTIALS);
  });

  it("sends no bearer token when logging in, on either arm", async () => {
    const { transport, calls } = stubTransport(() =>
      json(202, { mfa_required: true, challenge: "ch_1", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.login(CREDENTIALS);

    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});

describe("completeSecondFactor", () => {
  it("posts the challenge and the code to /v1/session/mfa", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.completeSecondFactor({ challenge: "ch_1", code: "482913" });

    expect(calls[0].url).toBe("https://identity.test/v1/session/mfa");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({ challenge: "ch_1", code: "482913" });
  });

  it("sends no bearer token: the challenge in the body IS the credential", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.completeSecondFactor({ challenge: "ch_1", code: "482913" });

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("returns the minted session on 200", async () => {
    const { transport } = stubTransport(() =>
      json(200, { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await expect(
      client.completeSecondFactor({ challenge: "ch_1", code: "482913" }),
    ).resolves.toEqual({
      token: "tok_abc",
      expires_at: "2026-10-01T00:00:00Z",
    });
  });

  it("raises one unauthorized error for a refused code, whatever the cause", async () => {
    // A wrong TOTP code, a spent recovery code, a used step, a malformed
    // value and a rotated-away secret are all the same 401 with the same body.
    // The client reads the status and nothing else, so the collapse the
    // service deliberate chose is preserved.
    const { transport } = stubTransport(() =>
      problem(401, { code: "unauthorized", title: "Unauthorized" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(
      client.completeSecondFactor({ challenge: "ch_1", code: "000000" }),
    );

    expect(error).toBeInstanceOf(IdentityError);
    expect(error.status).toBe(401);
  });

  it("reads the lockout window from Retry-After on a 423", async () => {
    const { transport } = stubTransport(() =>
      problem(423, { code: "account_locked", title: "Locked" }, { "Retry-After": "900" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(
      client.completeSecondFactor({ challenge: "ch_1", code: "000000" }),
    );

    expect(error.status).toBe(423);
    expect(error.retryAfter).toBe(900);
  });

  it("leaves the wait null when a 423 carries no Retry-After", async () => {
    // A 423 without the header is still a lockout, but the wait is not a fact
    // the service sent. Null is the honest reading — the screen falls back to
    // a bare "try again later" rather than rendering a number it invented.
    const { transport } = stubTransport(() =>
      problem(423, { code: "account_locked", title: "Locked" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(
      client.completeSecondFactor({ challenge: "ch_1", code: "000000" }),
    );

    expect(error.status).toBe(423);
    expect(error.retryAfter).toBeNull();
  });

  it("surfaces a 503 when the deployment cannot verify a second factor", async () => {
    const { transport } = stubTransport(() =>
      problem(503, { code: "service_unavailable", title: "Unavailable" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(
      client.completeSecondFactor({ challenge: "ch_1", code: "482913" }),
    );

    expect(error).toBeInstanceOf(IdentityError);
    expect(error.status).toBe(503);
  });
});

describe("me", () => {
  it("reads /v1/me with the token as a bearer credential", async () => {
    const { transport, calls } = stubTransport(() => json(200, { id: "usr_1", email: "kaka@example.com" }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.me("tok_abc");

    expect(calls[0].url).toBe("https://identity.test/v1/me");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
  });

  it("raises an unauthorized error when the token is rejected", async () => {
    const { transport } = stubTransport(() => problem(401, { code: "unauthorized", title: "Unauthorized" }));
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client.me("tok_stale").catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.code).toBe("unauthorized");
  });
});

describe("updateMyDisplayName", () => {
  it("patches /v1/me with the token as a bearer credential", async () => {
    const { transport, calls } = stubTransport(() =>
      json(200, { id: "usr_1", email: "kaka@example.com", display_name: "Kaka" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.updateMyDisplayName("tok_abc", { display_name: "Kaka" });

    expect(calls[0].url).toBe("https://identity.test/v1/me");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({ display_name: "Kaka" });
  });

  it("always sends the display_name field, because an omitted one clears", async () => {
    // The contract: an empty string and an omitted field decode the same way
    // upstream, so there is no "leave unchanged" to express — every commit is
    // "this is my name now" or "nothing", and clearing is the empty string.
    const { transport, calls } = stubTransport(() =>
      json(200, { id: "usr_1", email: "kaka@example.com" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.updateMyDisplayName("tok_abc", { display_name: "" });

    expect(JSON.parse(calls[0].body ?? "null")).toEqual({ display_name: "" });
  });

  it("returns the updated user, with the name omitted when cleared", async () => {
    const { transport } = stubTransport(() =>
      json(200, { id: "usr_1", email: "kaka@example.com" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.updateMyDisplayName("tok_abc", { display_name: "" })).resolves.toEqual({
      id: "usr_1",
      email: "kaka@example.com",
    });
  });

  it("surfaces a too-long name as a 422 on the display_name field", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        errors: [{ field: "display_name", code: "too_long" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .updateMyDisplayName("tok_abc", { display_name: "x" })
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual([{ field: "display_name", code: "too_long" }]);
  });
});

describe("listSessions", () => {
  it("reads /v1/sessions with the token as a bearer credential", async () => {
    const { transport, calls } = stubTransport(() => json(200, { sessions: [] }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.listSessions("tok_abc");

    expect(calls[0].url).toBe("https://identity.test/v1/sessions");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
  });

  it("returns the caller's sessions, which carry no token and no digest", async () => {
    const { transport } = stubTransport(() =>
      json(200, {
        sessions: [
          {
            id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
            created_at: "2026-09-30T09:14:02Z",
            expires_at: "2026-10-30T09:14:02Z",
            user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            ip: "203.0.113.7",
            current: true,
          },
        ],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.listSessions("tok_abc")).resolves.toEqual({
      sessions: [
        {
          id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
          created_at: "2026-09-30T09:14:02Z",
          expires_at: "2026-10-30T09:14:02Z",
          user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          ip: "203.0.113.7",
          current: true,
        },
      ],
    });
  });
});

describe("revokeSession", () => {
  it("deletes the session with the token as a bearer credential", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.revokeSession("tok_abc", "3f2504e0-4f89-11d3-9a0c-0305e82c3301");

    expect(calls[0].url).toBe("https://identity.test/v1/sessions/3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
  });

  it("resolves on an empty 204 body", async () => {
    const { transport } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(
      client.revokeSession("tok_abc", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
    ).resolves.toBeUndefined();
  });

  it("reads one 404 for a session that is not the caller's", async () => {
    // Never existed, somebody else's, already revoked and a malformed id are
    // one answer, because a 403 against a 404 would let a signed-in caller
    // probe whether a session id belongs to a live session anywhere.
    const { transport } = stubTransport(() =>
      problem(404, { code: "not_found", title: "Not found" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .revokeSession("tok_abc", "3f2504e0-4f89-11d3-9a0c-0305e82c3301")
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.status).toBe(404);
  });
});

describe("deleteMyAccount", () => {
  it("deletes /v1/me with the token as a bearer credential", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.deleteMyAccount("tok_abc");

    expect(calls[0].url).toBe("https://identity.test/v1/me");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
  });

  it("resolves on an empty 204 body", async () => {
    const { transport } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.deleteMyAccount("tok_abc")).resolves.toBeUndefined();
  });

  it("surfaces a sole-owner refusal as a 409 with the service's detail", async () => {
    // The one non-constant answer: a caller who is the only owner of a team
    // account is refused, and the problem document's detail names each account
    // by name and slug so the caller can act.
    const { transport } = stubTransport(() =>
      problem(409, {
        code: "account_ownership_conflict",
        title: "Account ownership conflict",
        detail: 'sole owner of a team account: "Acme" (acme). Transfer ownership to somebody else.',
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .deleteMyAccount("tok_abc")
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.status).toBe(409);
    expect(error.code).toBe("account_ownership_conflict");
    expect(error.message).toContain("Acme");
  });
});

describe("logout", () => {
  it("deletes the session with the token as a bearer credential", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.logout("tok_abc");

    expect(calls[0].url).toBe("https://identity.test/v1/session");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
  });

  it("resolves on an empty 204 body", async () => {
    const { transport } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.logout("tok_abc")).resolves.toBeUndefined();
  });

  it("raises an error when the delete fails", async () => {
    const { transport } = stubTransport(() => new Response("gateway down", { status: 502 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.logout("tok_abc")).rejects.toBeInstanceOf(IdentityError);
  });
});

describe("error envelope parsing", () => {
  it("keeps the status when the body is not JSON", async () => {
    // A proxy in front of identity answers with HTML. A JSON parse error here
    // would be reported as "Unexpected token <" and lose the one useful fact.
    const { transport } = stubTransport(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client.me("tok_abc").catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error).toBeInstanceOf(IdentityError);
    expect(error.status).toBe(502);
    expect(error.message).toContain("502");
  });

  it("keeps the status when the body is empty", async () => {
    const { transport } = stubTransport(() => new Response(null, { status: 401 }));
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client.me("tok_abc").catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.status).toBe(401);
  });

  it("falls back to a generic code when the body omits one", async () => {
    const { transport } = stubTransport(() => json(500, { something: "else" }));
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client.me("tok_abc").catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.code).toBe("internal");
  });

  it("reads the trace id from the response header when the body omits it", async () => {
    const { transport } = stubTransport(() =>
      json(422, { code: "validation_failed", title: "Validation failed" }, { "X-Trace-Id": "hdr_9" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .register(REGISTRATION)
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.traceId).toBe("hdr_9");
  });

  it("prefers the specific detail over the generic title as its message", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        detail: "email is not a deliverable address",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .register(REGISTRATION)
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.message).toBe("email is not a deliverable address");
    expect(error.title).toBe("Validation failed");
  });

  it("reads a nested error envelope as well as problem+json", async () => {
    // The brief for identity-02 writes the failure shape as `{error:{…}}`, while
    // core/docs/openapi-conventions.md mandates problem+json. identity has not
    // shipped either yet, so the client accepts both and the manager picks.
    const { transport } = stubTransport(() =>
      json(422, {
        error: {
          code: "validation_failed",
          message: "Validation failed",
          fields: { email: ["invalid_format"] },
        },
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = (await client
      .register(REGISTRATION)
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.code).toBe("validation_failed");
    expect(error.message).toBe("Validation failed");
    expect(error.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
  });
});

describe("base url joining", () => {
  it("does not double the slash when the base url ends with one", async () => {
    const { transport, calls } = stubTransport(() => json(200, { id: "usr_1", email: "kaka@example.com" }));
    const client = createIdentityClient({ baseUrl: "https://identity.test/", transport });

    await client.me("tok_abc");

    expect(calls[0].url).toBe("https://identity.test/v1/me");
  });
});

describe("fieldErrorMessage", () => {
  it("asks for the email when it is missing", () => {
    expect(fieldErrorMessage("email", "required")).toBe("Email is required.");
  });

  it("asks for the password when it is missing", () => {
    expect(fieldErrorMessage("password", "required")).toBe("Password is required.");
  });

  it("explains a malformed email without echoing it back", () => {
    expect(fieldErrorMessage("email", "invalid_format")).toBe("Enter a valid email address.");
  });

  it("quotes the minimum length for a short password", () => {
    expect(fieldErrorMessage("password", "too_short")).toBe(
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  it("mirrors the service's own minimum password length", () => {
    // identity rejects under 8 (users.MinPasswordLength). This constant is a
    // client-side mirror; if the service moves, both must move together.
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("labels a field the client does not know about", () => {
    expect(fieldErrorMessage("first_name", "required")).toBe("First name is required.");
  });

  it("keeps an unknown code out of the sentence shown to a person", () => {
    const message = fieldErrorMessage("email", "something_new_in_the_contract");

    expect(message).toBe("Email is not valid.");
    expect(message).not.toContain("something_new_in_the_contract");
  });

  it("says a mismatched confirmation plainly, since the service never sees one", () => {
    // The service's confirm body is `{token, password}` — there is no
    // confirmation field for it to refuse, so this code exists only on this side.
    // It still gets a real sentence rather than the generic fallback.
    expect(fieldErrorMessage("password_confirmation", "mismatch")).toBe(
      "The two passwords do not match.",
    );
  });
});

// ---------------------------------------------------------------------------
// The password-reset surface.
//
// Transcribed from the handler, `identity/internal/httpapi/recovery.go`:
// `handleRequestPasswordReset` and `handleRedeemPasswordReset`, the
// `acceptedResponse` constant, `passwordResetRequest`, and the table in
// `writeRecoveryError`. The route table is `registerRecoveryRoutes`.
//
// The property these tests exist to hold is the enumeration one: both routes are
// anonymous (`sessionCredentialOnly`), so a client that sent a credential would
// be refused by the service. The "sends no bearer token" assertions below are the
// client half of that same rule.
// ---------------------------------------------------------------------------

describe("password reset: requesting a link", () => {
  it("posts only the address to /v1/password-resets", async () => {
    const { transport, calls } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.requestPasswordReset("kaka@example.com");

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/password-resets`);
    expect(JSON.parse(calls[0].body as string)).toEqual({ email: "kaka@example.com" });
  });

  it("sends no bearer token, because the service refuses one on this route", async () => {
    // `sessionCredentialOnly` wraps all eight recovery routes. A scoped API key
    // presented here is a 403, and an identity session token would be a
    // credential in a request that needs none.
    const { transport, calls } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.requestPasswordReset("kaka@example.com");

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("reads the constant 202 body as accepted", async () => {
    // `acceptedResponse` is a CONSTANT in the service: the same bytes for a
    // registered address, an unregistered one, and one inside the cooldown.
    // Typed rather than discarded, and the client asserts the literal value so a
    // service that grew a field (`sent`, `expires_at`) shows up here.
    const { transport } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.requestPasswordReset("kaka@example.com")).resolves.toEqual({
      status: "accepted",
    });
  });

  it("gives an unregistered address exactly the same answer", async () => {
    // Not a real service — the point is that the client cannot tell the two
    // apart, because there is nothing in a 202 to tell them apart with. The
    // anti-enumeration property is the service's; this asserts the client is not
    // in a position to undo it.
    const { transport } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    const known = await client.requestPasswordReset("kaka@example.com");
    const unknown = await client.requestPasswordReset("nobody@example.com");

    expect(unknown).toEqual(known);
  });

  it("surfaces a 503 when the deployment cannot send email", async () => {
    // `ErrNoMailer` maps to 503, checked BEFORE the address is looked up so that
    // "503 against 202" cannot become an existence oracle. The screen must not
    // render "check your inbox" for this, which is the whole reason it is a 503.
    const { transport } = stubTransport(() =>
      problem(503, {
        code: "service_unavailable",
        title: "Service unavailable",
        detail: "this deployment cannot send email, so it cannot send that link",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.requestPasswordReset("kaka@example.com"));

    expect(error.status).toBe(503);
    expect(error.code).toBe("service_unavailable");
  });

  it("surfaces a 422 field error from the request route", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        errors: [{ field: "email", code: "invalid_format" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.requestPasswordReset("not-an-address"));

    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
  });
});

describe("password reset: spending a link", () => {
  const TOKEN = "0Kq3Zs1oQw7bXn0K9dLpR2vT4yE6hJ8cF1gM5nA2qU0";

  it("posts the token and the new password, and nothing else", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.redeemPasswordReset({ token: TOKEN, password: "a brand new password" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/password-resets/confirm`);
    // No email, no session, no confirmation: the service's body is
    // `passwordResetRequest{token, password}` and anything else is ignored.
    expect(JSON.parse(calls[0].body as string)).toEqual({
      token: TOKEN,
      password: "a brand new password",
    });
  });

  it("sends no bearer token: the token in the body IS the credential", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.redeemPasswordReset({ token: TOKEN, password: "a brand new password" });

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("resolves on an empty 204, which is the whole success answer", async () => {
    // The 204 carries no session on purpose: redeeming a reset mints nothing,
    // because that would be a second way to turn a mailbox into a credential.
    const { transport } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(
      client.redeemPasswordReset({ token: TOKEN, password: "a brand new password" }),
    ).resolves.toBeUndefined();
  });

  it("reads one 404 for a link that never existed, expired, or was already spent", async () => {
    // `ErrTokenNotFound` is a single sentinel covering four cases, and the
    // service answers 404 for all of them. The screen cannot tell them apart and
    // must not try to.
    const { transport } = stubTransport(() =>
      problem(404, {
        code: "not_found",
        title: "Not found",
        detail: "no such link, or it has already been used",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(
      client.redeemPasswordReset({ token: TOKEN, password: "a brand new password" }),
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("surfaces a too-short password as a 422 on the password field", async () => {
    // `RedeemPasswordReset` runs `users.ValidatePassword` before it hashes
    // anything, so a short value is a `FieldError{password, too_short}`.
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        detail: "the request has an invalid field",
        errors: [{ field: "password", code: "too_short" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.redeemPasswordReset({ token: TOKEN, password: "short" }));

    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual([{ field: "password", code: "too_short" }]);
  });
});

// ---------------------------------------------------------------------------
// The verification surface.
//
// Transcribed from the same handler the reset routes above come from —
// `identity/internal/httpapi/recovery.go`: `handleRequestVerification` and
// `handleRedeemVerification` with the shared `emailRequest` and `tokenRequest`
// bodies, `handleVerificationStatus` with `verificationStatusResponse`, the
// `acceptedResponse` constant, and the `ErrAlreadyVerified` branch of
// `writeRecoveryError`. `GET /v1/email-verification` is declared in
// `identity/openapi/v1.yaml`; the two POSTs are too, and the handler agrees with
// the document here — which is worth saying because the tenancy surface above is
// the case where they do NOT agree.
//
// THE PROPERTY BESIDE THE PARSER: all three routes are wrapped in
// `sessionCredentialOnly` (recovery.go, registerRecoveryRoutes), and the two that
// take no credential are the two that must send NO Authorization header at all.
// `verificationStatus` is the odd one out — it resolves a session, so it does
// take the token — and that difference is asserted below rather than assumed.
// ---------------------------------------------------------------------------

describe("email verification: requesting a link", () => {
  it("posts only the address to /v1/email-verifications", async () => {
    const { transport, calls } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.requestEmailVerification("kaka@example.com");

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/email-verifications`);
    // `emailRequest{Email}` — one field. The address looks the account UP; what
    // gets proved is the address already on the row, so sending anything else
    // would be a client asking for a registration of somebody else's inbox.
    expect(JSON.parse(calls[0].body as string)).toEqual({ email: "kaka@example.com" });
  });

  it("sends no bearer token, because the service refuses one on this route", async () => {
    // Same rule as the reset request route, and the same reason: the mailer is
    // reached with no session, and a credential presented here would be refused.
    const { transport, calls } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.requestEmailVerification("kaka@example.com");

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("reads the constant 202 body as accepted", async () => {
    const { transport } = stubTransport(() => json(202, { status: "accepted" }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.requestEmailVerification("kaka@example.com")).resolves.toEqual({
      status: "accepted",
    });
  });

  it("surfaces a 503 when the deployment cannot send email", async () => {
    // `Service.RequestVerification` calls `deliverable` FIRST, before it looks
    // the address up — which is what stops 503-against-202 from being an
    // existence oracle, and what lets a screen say this differently from success.
    const { transport } = stubTransport(() =>
      problem(503, {
        code: "service_unavailable",
        title: "Service unavailable",
        detail: "this deployment cannot send email, so it cannot send that link",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.requestEmailVerification("kaka@example.com"));

    expect(error.status).toBe(503);
    expect(error.code).toBe("service_unavailable");
  });

  it("reads an already-proved address as a 409, which is the one answer that names a state", async () => {
    // `RequestVerification` checks `user.IsVerified()` after the lookup and
    // before the cooldown window, so a proved address answers 409 whatever else
    // is true. This is the service's declared enumeration stance on this route
    // and NOT the constant 202 the reset route uses — asserted here so the
    // difference is a fact in the client rather than a surprise in a screen.
    const { transport } = stubTransport(() =>
      problem(409, {
        code: "conflict",
        title: "Conflict",
        detail: "this account's email address is already verified",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.requestEmailVerification("kaka@example.com"));

    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    // And no field errors: the address is well formed, it is just spoken for.
    expect(error.fieldErrors).toEqual([]);
  });

  it("surfaces a 422 field error from the request route", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        detail: "the request has an invalid field",
        errors: [{ field: "email", code: "invalid_format" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.requestEmailVerification("not-an-address"));

    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
  });
});

describe("email verification: spending a link", () => {
  const TOKEN = "0Kq3Zs1oQw7bXn0K9dLpR2vT4yE6hJ8cF1gM5nA2qU0";

  it("posts the token and nothing else, to the confirm route", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.redeemEmailVerification({ token: TOKEN });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/email-verifications/confirm`);
    // `tokenRequest{Token}` and NOT the reset body. A verification redeeming
    // route that also accepted a password would invite a client to send one,
    // where it would be ignored — and "ignored" is worse than "refused".
    expect(JSON.parse(calls[0].body as string)).toEqual({ token: TOKEN });
  });

  it("sends no bearer token: the token in the body IS the credential", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.redeemEmailVerification({ token: TOKEN });

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("resolves on an empty 204, which is the whole success answer", async () => {
    // A verification mints nothing and revokes nothing, so there is no session
    // in the answer and nobody to sign out. Contrast the reset route's 204.
    const { transport } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.redeemEmailVerification({ token: TOKEN })).resolves.toBeUndefined();
  });

  it("reads one 404 for a link that never existed, expired, was spent, or is another flow's", async () => {
    // `ErrTokenNotFound` again, with the same four cases, and identity's own
    // tests pin that a verification token is not accepted by the reset route and
    // a reset token is not accepted by this one.
    const { transport } = stubTransport(() =>
      problem(404, {
        code: "not_found",
        title: "Not found",
        detail: "no such link, or it has already been used",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.redeemEmailVerification({ token: TOKEN }));

    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("reads a token of the wrong length as the same 404 any other dead token gets", async () => {
    // MEASURED AGAINST A RUNNING IDENTITY, and it contradicts the document.
    //
    // `identity/openapi/v1.yaml` declares `RecoveryTokenRequest.token` as
    // `minLength: 43, maxLength: 43` and lists a 422 on the route, so the first
    // version of this test asserted a 422 for a short token. Posting
    // `{"token":"too-short"}` to a real identity answers **404** with the ordinary
    // `not_found` problem, because `RedeemVerification` goes straight to
    // `tokens.Live(sessions.Digest(in.Token))` and a token of any shape that is
    // not live is `ErrTokenNotFound`. `tokenRequest` is one `string` field with no
    // validation on it.
    //
    // So the document declares a validation failure the handler does not
    // implement, and this client follows the handler — the same rule the tenancy
    // surface in this file is transcribed by. Recorded in CHANGELOG "Known gaps".
    //
    // The property worth holding is the one it pins: a truncated link is
    // indistinguishable from any other dead one, which is exactly what a screen
    // needs in order to say one sentence for all of them.
    const { transport } = stubTransport(() =>
      problem(404, {
        code: "not_found",
        title: "Not found",
        detail: "no such link, or it has already been used",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.redeemEmailVerification({ token: "too-short" }));

    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("sends a token of any length without editing it, because the service is the judge", async () => {
    // The companion to the test above: the client does not validate the length
    // locally either. A local check would be a second opinion on a rule the
    // service does not enforce, and it would refuse a link before the 404 that
    // says so.
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.redeemEmailVerification({ token: "too-short" });

    expect(JSON.parse(calls[0].body as string)).toEqual({ token: "too-short" });
  });
});

describe("email verification: reading the caller's own state", () => {
  it("reads /v1/email-verification with the token as a bearer credential", async () => {
    // The ONE verification route that is not anonymous: `handleVerificationStatus`
    // calls `currentUser`, and this is a question about the caller's own account.
    const { transport, calls } = stubTransport(() =>
      json(200, { email: "kaka@example.com", email_verified: false }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.verificationStatus("tok_abc");

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${baseUrl}/v1/email-verification`);
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
  });

  it("reads a proved address with its instant", async () => {
    const { transport } = stubTransport(() =>
      json(200, {
        email: "kaka@example.com",
        email_verified: true,
        email_verified_at: "2026-09-30T12:10:00Z",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.verificationStatus("tok_abc")).resolves.toEqual({
      email: "kaka@example.com",
      email_verified: true,
      email_verified_at: "2026-09-30T12:10:00Z",
    });
  });

  it("keeps the absent timestamp absent, because never-proved is not proved-at-epoch", async () => {
    // `verificationStatusResponse.EmailVerifiedAt` is `*time.Time` with
    // `omitempty`. Defaulting it to `null` here would collapse "never verified"
    // and "verified at 1970" into one answer, and the service says they are
    // different answers. So the client adds nothing: the key is absent off the
    // wire and absent here, rather than present-and-empty.
    const { transport } = stubTransport(() =>
      json(200, { email: "kaka@example.com", email_verified: false }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const status = await client.verificationStatus("tok_abc");

    expect(status.email_verified_at).toBeUndefined();
    expect("email_verified_at" in status).toBe(false);
  });

  it("answers 200 for an unverified account rather than 404, so there is no unverified gap", async () => {
    // The contract: "A `200` for every signed-in account, never a 404 for an
    // unverified one: the question has an answer for everybody."
    const { transport } = stubTransport(() =>
      json(200, { email: "kaka@example.com", email_verified: false }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.verificationStatus("tok_abc")).resolves.toMatchObject({
      email_verified: false,
    });
  });

  it("raises a 401 when there is no session", async () => {
    const { transport } = stubTransport(() =>
      problem(401, { code: "unauthorized", title: "Unauthorized" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const error = await theFailure(client.verificationStatus("tok_dead"));

    expect(error.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The tenancy surface: accounts, members and invitations.
//
// Every request and response shape below is transcribed from the service's own
// handler, `identity/internal/httpapi/accounts.go` — the `json:` tags on
// accountResponse, accountListItem, membershipResponse, invitationResponse and
// the five request bodies, and the status codes in registerTenancyRoutes and
// writeTenancyError. These are the merged implementation's shapes, not guesses
// from a document: `identity/openapi/v1.yaml` on master does not describe the
// tenancy surface at all (see the packet report), so the handler is the only
// authority there is.
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "acc_1a2b3c";
const USER_ID = "usr_9f8e7d";

/** accountResponse, as handleCreateAccount and handleGetAccount write it. */
const anAccount = (overrides: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  name: "Acme Corp",
  slug: "acme-corp",
  personal: false,
  role: "owner",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...overrides,
});

/** accountListItem — the same row without members and without updated_at. */
const anAccountListItem = (overrides: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  name: "Acme Corp",
  slug: "acme-corp",
  personal: false,
  role: "owner",
  created_at: "2026-09-01T10:00:00Z",
  ...overrides,
});

/** membershipResponse, as handleAcceptInvitation and handleChangeRole write it. */
const aMembership = (overrides: Record<string, unknown> = {}) => ({
  account_id: ACCOUNT_ID,
  user_id: USER_ID,
  role: "member",
  created_at: "2026-09-02T11:00:00Z",
  ...overrides,
});

/** invitationResponse — the 201, which is the only place the token appears. */
const anInvitation = (overrides: Record<string, unknown> = {}) => ({
  id: "inv_5e4d3c",
  account_id: ACCOUNT_ID,
  email: "newcomer@example.com",
  role: "member",
  token: "inv_tok_9z8y7x",
  expires_at: "2026-09-08T10:00:00Z",
  created_at: "2026-09-01T10:05:00Z",
  ...overrides,
});

describe("tenancy: the request each endpoint makes", () => {
  it("lists the caller's accounts", async () => {
    const { transport, calls } = stubTransport(() => json(200, [anAccountListItem()]));
    const client = createIdentityClient({ baseUrl, transport });

    const accounts = await client.listAccounts("tok_abc");

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts`);
    expect(calls[0].headers.Authorization).toBe("Bearer tok_abc");
    expect(accounts).toEqual([anAccountListItem()]);
  });

  it("reads a memberless list item without inventing the fields it lacks", async () => {
    // accountListItem has no `members` and no `updated_at`. A client that
    // fabricated them would be showing a detail response on a list page.
    const { transport } = stubTransport(() => json(200, [anAccountListItem()]));
    const client = createIdentityClient({ baseUrl, transport });

    const [account] = await client.listAccounts("tok_abc");

    expect(account).not.toHaveProperty("members");
    expect(account).not.toHaveProperty("updated_at");
  });

  it("creates an account from a name alone", async () => {
    const { transport, calls } = stubTransport(() => json(201, anAccount()));
    const client = createIdentityClient({ baseUrl, transport });

    await client.createAccount("tok_abc", { name: "Acme Corp" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts`);
    // The owner is the caller and the slug is derived; neither is the client's
    // to send, and the service's request body has exactly one field.
    expect(JSON.parse(calls[0].body as string)).toEqual({ name: "Acme Corp" });
  });

  it("reads one account by id", async () => {
    const { transport, calls } = stubTransport(() => json(200, anAccount()));
    const client = createIdentityClient({ baseUrl, transport });

    await client.getAccount("tok_abc", ACCOUNT_ID);

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}`);
  });

  it("renames with PATCH and sends only a name", async () => {
    const { transport, calls } = stubTransport(() => json(200, anAccount({ name: "Acme Ltd" })));
    const client = createIdentityClient({ baseUrl, transport });

    const renamed = await client.renameAccount("tok_abc", ACCOUNT_ID, { name: "Acme Ltd" });

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}`);
    expect(JSON.parse(calls[0].body as string)).toEqual({ name: "Acme Ltd" });
    expect(renamed.name).toBe("Acme Ltd");
  });

  it("lists members, which is a wrapper and not an array", async () => {
    // handleListMembers answers {memberships, role} so a client rendering the
    // panel knows the caller's own role without a third request.
    const { transport, calls } = stubTransport(() =>
      json(200, { memberships: [aMembership()], role: "owner" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const panel = await client.listMembers("tok_abc", ACCOUNT_ID);

    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}/members`);
    expect(panel.role).toBe("owner");
    expect(panel.memberships).toHaveLength(1);
  });

  it("invites with an email and a role", async () => {
    const { transport, calls } = stubTransport(() => json(201, anInvitation()));
    const client = createIdentityClient({ baseUrl, transport });

    const invitation = await client.inviteMember("tok_abc", ACCOUNT_ID, {
      email: "newcomer@example.com",
      role: "member",
    });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}/invitations`);
    expect(JSON.parse(calls[0].body as string)).toEqual({
      email: "newcomer@example.com",
      role: "member",
    });
    // The token is returned exactly once, by this endpoint and no other.
    expect(invitation.token).toBe("inv_tok_9z8y7x");
  });

  it("accepts an invitation by token, with no account in the path", async () => {
    const { transport, calls } = stubTransport(() => json(200, aMembership()));
    const client = createIdentityClient({ baseUrl, transport });

    const membership = await client.acceptInvitation("tok_abc", { token: "inv_tok_9z8y7x" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/invitations/accept`);
    expect(JSON.parse(calls[0].body as string)).toEqual({ token: "inv_tok_9z8y7x" });
    expect(membership.role).toBe("member");
  });

  it("changes a member's role by user id", async () => {
    const { transport, calls } = stubTransport(() => json(200, aMembership({ role: "admin" })));
    const client = createIdentityClient({ baseUrl, transport });

    await client.changeMemberRole("tok_abc", ACCOUNT_ID, USER_ID, { role: "admin" });

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}/members/${USER_ID}`);
    expect(JSON.parse(calls[0].body as string)).toEqual({ role: "admin" });
  });

  it("removes a member and expects no body back", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.removeMember("tok_abc", ACCOUNT_ID, USER_ID)).resolves.toBeUndefined();

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}/members/${USER_ID}`);
  });

  it("deletes an account and expects no body back", async () => {
    const { transport, calls } = stubTransport(() => new Response(null, { status: 204 }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.deleteAccount("tok_abc", ACCOUNT_ID)).resolves.toBeUndefined();

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${baseUrl}/v1/accounts/${ACCOUNT_ID}`);
  });

  it("sends the bearer token on every tenancy call", async () => {
    // Every account route resolves a session first, so a tenancy call without
    // the token is a guaranteed 401.
    const { transport, calls } = stubTransport((call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : json(200, []),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await client.listAccounts("tok_abc");
    await client.getAccount("tok_abc", ACCOUNT_ID);
    await client.deleteAccount("tok_abc", ACCOUNT_ID);

    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer tok_abc");
    }
  });
});

describe("tenancy: the failures the service declares", () => {
  // The table in writeTenancyError. Which of these a screen renders differently
  // is the whole reason they are tested individually: a 404 and a 403 are two
  // different sentences to a person even though both are refusals.
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [410, "gone"],
    [422, "validation_failed"],
    [500, "internal"],
  ];

  it.each(cases)("keeps the %i status and code through to the error", async (status, code) => {
    const { transport } = stubTransport(() => problem(status, { code, title: "Refused" }));
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(client.listAccounts("tok_abc"));

    expect(failure).toBeInstanceOf(IdentityError);
    expect(failure.status).toBe(status);
    expect(failure.code).toBe(code);
  });

  it("reports an expired invitation as gone, distinctly from an unknown one", async () => {
    // The service maps both ErrInvitationExpired and ErrInvitationUsed to 410,
    // and ErrInvitationNotFound to 404 "so a guessed token is useless". The
    // accept page has to be able to tell those two apart, and it can only do it
    // from the status.
    const expired = stubTransport(() =>
      problem(410, { code: "gone", title: "Gone", detail: "this invitation has expired; ask for a new one" }),
    );
    const unknown = stubTransport(() =>
      problem(404, { code: "not_found", title: "Not found", detail: "no invitation matches that token" }),
    );

    const a = await theFailure(
      createIdentityClient({ baseUrl, transport: expired.transport }).acceptInvitation("tok_abc", {
        token: "t",
      }),
    );
    const b = await theFailure(
      createIdentityClient({ baseUrl, transport: unknown.transport }).acceptInvitation("tok_abc", {
        token: "t",
      }),
    );

    expect(a.status).toBe(410);
    expect(b.status).toBe(404);
  });

  it("carries a last-owner refusal as a field error on the role", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        errors: [{ field: "role", code: "last_owner" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(
      client.changeMemberRole("tok_abc", ACCOUNT_ID, USER_ID, { role: "member" }),
    );

    expect(failure.status).toBe(422);
    expect(failure.fieldErrors).toEqual([{ field: "role", code: "last_owner" }]);
  });

  it("carries a not-invitable refusal as a field error on the role", async () => {
    const { transport } = stubTransport(() =>
      problem(422, {
        code: "validation_failed",
        title: "Validation failed",
        errors: [{ field: "role", code: "not_invitable" }],
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(
      client.inviteMember("tok_abc", ACCOUNT_ID, { email: "a@example.com", role: "admin" }),
    );

    expect(failure.fieldErrors).toEqual([{ field: "role", code: "not_invitable" }]);
  });
});

// ---------------------------------------------------------------------------
// The social surface.
//
// The two calls that make up a social sign-in, and the reason they do not look
// like any other method in this file: **both are redirects rather than JSON**,
// at least one of them, and `send`'s contract — 2xx or throw — is wrong for a 302.
// So the 3xx is recognised before the failure branch, which is the ordering
// identity's own client uses for the same operation and for the same reason: a
// 302 carries no problem document, so an implementation that checked the status
// first would report a redirect as a malformed answer from a proxy.
// ---------------------------------------------------------------------------

describe("social login: starting the flow", () => {
  it("asks identity for the provider's address and sends no credential", async () => {
    // `security: []` in the document. The operation reads a session cookie but
    // only to record an INTENTION — whether this becomes a sign-in or a LINK —
    // so it needs no credential of its own, and `send` is called with no `token`
    // for the same reason the recovery routes take none.
    const { transport, calls } = stubTransport(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://accounts.google.com/o/oauth2/v2/auth?state=xyz" },
        }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const location = await client.startSocialLogin("google");

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${baseUrl}/v1/auth/oauth/google`);
    // The header a client must NOT send, asserted by name because "the transport
    // attaches one" is the kind of thing a later refactor adds back quietly.
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(location).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=xyz");
  });

  it("treats the 302 as the success it is, not as a failure", async () => {
    // The one test that distinguishes this method from `send`. A 302 is not
    // `response.ok`, so an implementation that reached the failure branch first
    // would throw `IdentityError` on a perfectly good answer — and the button
    // would never navigate anywhere.
    const { transport } = stubTransport(
      () => new Response(null, { status: 302, headers: { Location: "https://example.test/go" } }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.startSocialLogin("github")).resolves.toBe("https://example.test/go");
  });

  it("fails rather than return an empty string when the answer carries no Location", async () => {
    // A 302 with nowhere to send the browser is not a success, and an empty
    // string here would render as a link pointing at the current page. identity's
    // own client raises here for exactly the same reason.
    const { transport } = stubTransport(() => new Response(null, { status: 302 }));
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(client.startSocialLogin("google"));

    expect(failure.status).toBe(302);
    expect(failure.message).toMatch(/Location/);
  });

  it("reports a 2xx as the contract violation it is", async () => {
    // The document promises no 2xx for this operation. One means something
    // between here and identity is not identity, and there is no Location to
    // report — so it must not be handed back as an empty string either.
    const { transport } = stubTransport(() => json(200, {}));
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(client.startSocialLogin("google"));

    expect(failure.message).toMatch(/redirect/i);
  });

  it("carries a refusal rather than an address of nowhere", async () => {
    // A provider this deployment has no credentials for, and a provider that does
    // not exist, are BOTH this answer. The client must not distinguish them, and
    // must certainly not render the message — which is why `IdentityError.title`
    // is the fixed summary and `message` carries `detail`.
    const { transport } = stubTransport(() =>
      problem(404, { code: "not_found", title: "Not found." }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(client.startSocialLogin("gitlab"));

    expect(failure.status).toBe(404);
    expect(failure.code).toBe("not_found");
  });
});

describe("social login: reaching the callback", () => {
  it("reads a finished sign-in as a session", async () => {
    // The sign-in shape: a `token`, and the `__Host-session` cookie that rides
    // alongside it in the response headers. This method only ever sees the body,
    // because the cookie belongs to the browser — which is exactly why the hop
    // that produced it has to relay `Set-Cookie`, and why `upstream.test.ts` has
    // a test for that which this one cannot stand in for.
    const { transport, calls } = stubTransport(() =>
      json(200, { token: "tok_social", expires_at: "2026-10-30T12:00:00Z" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const result = await client.completeSocialLogin("github", {
      code: "the-code",
      state: "st_1",
    });

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(
      `${baseUrl}/v1/auth/oauth/github/callback?code=the-code&state=st_1`,
    );
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(result).toEqual({
      kind: "session",
      session: { token: "tok_social", expires_at: "2026-10-30T12:00:00Z" },
    });
  });

  it("reads a link as a link, and never as a session with an empty token", async () => {
    // THE SHAPE THAT CATCHES A LAZY READER. The link body has `linked_provider`
    // and NO `token` field at all, so a client that looked for `token` and
    // defaulted it to `""` would be inventing a state the service does not have:
    // a caller holding that would treat somebody's account as signed in when
    // nothing was minted.
    const { transport } = stubTransport(() => json(200, { linked_provider: "google" }));
    const client = createIdentityClient({ baseUrl, transport });

    const result = await client.completeSocialLogin("google", { state: "st_1" });

    expect(result).toEqual({ kind: "linked", linked: { linked_provider: "google" } });
    expect(result).not.toHaveProperty("session");
  });

  it("reads a second factor as a login that is not finished", async () => {
    // A 202 is NOT a session and must never be typed as one. It is also the one
    // shape this app cannot finish from the browser: the second step is
    // `POST /v1/session/mfa`, which is deliberately absent from the forwarder's
    // allow-list (see `upstream.ts`), so a caller reaching this has somewhere to
    // go and no route to take.
    const { transport } = stubTransport(() =>
      json(202, {
        mfa_required: true,
        challenge: "chal_1",
        expires_at: "2026-10-30T12:10:00Z",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const result = await client.completeSocialLogin("github", { state: "st_1", code: "c" });

    expect(result).toEqual({
      kind: "mfa_required",
      challenge: { mfa_required: true, challenge: "chal_1", expires_at: "2026-10-30T12:10:00Z" },
    });
    expect(result).not.toHaveProperty("session");
  });

  it("carries a declined consent as a refusal rather than as a missing code", async () => {
    // Somebody who said no at the provider comes back with `error` and no `code`.
    // identity answers that as a 400 on purpose so the screen can say "you
    // declined" instead of "that is not valid" — which only works if `error` is
    // in the URL this method builds.
    const { transport, calls } = stubTransport(() =>
      problem(400, {
        code: "invalid_request",
        title: "Invalid request",
        detail: "this social sign-in did not start in this browser",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(
      client.completeSocialLogin("google", { state: "st_1", error: "access_denied" }),
    );

    expect(calls[0].url).toBe(
      `${baseUrl}/v1/auth/oauth/google/callback?state=st_1&error=access_denied`,
    );
    expect(failure.status).toBe(400);
  });

  it("carries the anti-takeover 409 as a refusal, not as a session", async () => {
    // An address a local account already holds REFUSES the sign-in. Flattening
    // this into a success would be the worst answer available: somebody who
    // controls a provider account with another person's address would walk into
    // that account. It has to reach the screen as a 409.
    const { transport } = stubTransport(() =>
      problem(409, {
        code: "conflict",
        title: "Conflict",
        detail: "an account already exists for the email address that oauth account reports",
      }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(client.completeSocialLogin("google", { state: "s", code: "c" }));

    expect(failure.status).toBe(409);
    expect(failure.code).toBe("conflict");
  });

  it("does not treat a body carrying both keys as something it recognises", async () => {
    // Neither documented shape carries both, so this answer is one this build has
    // no reading for. Returning a session for it would be a guess about which of
    // the two the service meant, and this file does not guess — the same
    // discipline `readJson` applies to a body that is not JSON.
    const { transport } = stubTransport(() =>
      json(200, { token: "tok_social", linked_provider: "google" }),
    );
    const client = createIdentityClient({ baseUrl, transport });

    const failure = await theFailure(client.completeSocialLogin("google", { state: "s", code: "c" }));

    expect(failure.status).toBe(200);
    expect(failure.message).toMatch(/recognise|recognize/i);
  });

  it("cannot be pointed at another provider's callback than the one it was asked for", async () => {
    // A provider name is a PATH SEGMENT here, not a query parameter, and it is
    // encoded on the way in. A caller that could smuggle `/callback` or a second
    // provider into it would be asking a different question than the method says
    // it is asking — which is the whole reason `upstream.ts` rebuilds the path
    // from its own table instead of forwarding what it received.
    const { transport, calls } = stubTransport(() => json(200, { linked_provider: "google" }));
    const client = createIdentityClient({ baseUrl, transport });

    // `SocialProvider` is `string`, so this needs no cast to be a legal argument —
// and the point of the case is that the client's own type will not stop a
// traversal string from reaching `encodeURIComponent`. The forwarder's
// `SEGMENT_PATTERNS` is what refuses it; see `upstream.test.ts`.
await client.completeSocialLogin("../google/../../me", { state: "s", code: "c" });

    expect(calls[0].url).toBe(
      `${baseUrl}/v1/auth/oauth/..%2Fgoogle%2F..%2F..%2Fme/callback?state=s&code=c`,
    );
    expect(calls[0].url).not.toContain("/v1/me");
  });
});

describe("fieldErrorMessage: the tenancy codes", () => {
  it("says a blank name is required, not invalid", () => {
    // The service keeps these apart because they mean different things to the
    // person filling in the form.
    expect(fieldErrorMessage("name", "required")).toBe("Name is required.");
  });

  it("asks for a name it can make a handle from", () => {
    expect(fieldErrorMessage("name", "invalid_format")).toMatch(/letter or number/i);
  });

  it("quotes the maximum length for a long name", () => {
    expect(fieldErrorMessage("name", "too_long")).toContain(String(MAX_NAME_LENGTH));
  });

  it("explains that only an owner may hand out admin", () => {
    expect(fieldErrorMessage("role", "not_invitable")).toMatch(/admin or member/i);
  });

  it("explains that an account keeps an owner", () => {
    expect(fieldErrorMessage("role", "last_owner")).toMatch(/owner/i);
  });

  it("explains that the role is not one the service knows", () => {
    expect(fieldErrorMessage("role", "unknown_role")).toMatch(/role/i);
  });

  it("never leaks an unknown tenancy code into the sentence", () => {
    const message = fieldErrorMessage("role", "some_future_code");
    expect(message).not.toContain("some_future_code");
  });
});

// ---------------------------------------------------------------------------
// The MFA surface.
//
// The four routes the settings section drives. The shapes are transcribed from
// `identity/openapi/v1.yaml` and the statuses from the same document — the
// confirm route's 401 (a refused code) and 404 (an enrollment that is not
// this caller's, is expired, or is already confirmed) are the two the screen
// has to be able to tell apart, so both are asserted here.
// ---------------------------------------------------------------------------

describe("the MFA surface", () => {
  const ENROLLMENT_ID = "8f2c1a44-0000-4000-8000-000000000001";

  describe("mfaStatus", () => {
    it("reads /v1/mfa with the token as a bearer credential", async () => {
      const { transport, calls } = stubTransport(() => json(200, { enabled: false }));
      const client = createIdentityClient({ transport });

      await client.mfaStatus("tok");

      expect(calls[0].url).toBe("/v1/mfa");
      expect(calls[0].method).toBe("GET");
      expect(calls[0].headers.Authorization).toBe("Bearer tok");
    });

    it("treats a 200 with enabled:false as the answer, not a 404", async () => {
      // The question has an answer for every signed-in user, so a client that
      // read a 404 here would be reporting "this is not your account" for a
      // person who simply has no factor yet.
      const { transport } = stubTransport(() => json(200, { enabled: false }));
      const client = createIdentityClient({ transport });

      await expect(client.mfaStatus("tok")).resolves.toEqual({ enabled: false });
    });

    it("returns the enrolled status with its optional fields", async () => {
      const { transport } = stubTransport(() =>
        json(200, {
          enabled: true,
          method: "totp",
          enrolled_at: "2026-09-30T12:04:11Z",
          recovery_codes_remaining: 8,
        }),
      );
      const client = createIdentityClient({ transport });

      await expect(client.mfaStatus("tok")).resolves.toEqual({
        enabled: true,
        method: "totp",
        enrolled_at: "2026-09-30T12:04:11Z",
        recovery_codes_remaining: 8,
      });
    });

    it("raises an unauthorized error when the token is rejected", async () => {
      const { transport } = stubTransport(() => problem(401, { code: "unauthorized", title: "Unauthenticated" }));
      const client = createIdentityClient({ transport });

      const failure = await theFailure(client.mfaStatus("tok"));

      expect(failure.status).toBe(401);
    });
  });

  describe("startMfaEnrollment", () => {
    it("posts to /v1/mfa/enrollments with the token as a bearer credential", async () => {
      const { transport, calls } = stubTransport(() =>
        json(201, { enrollment_id: ENROLLMENT_ID, secret: "JBSWY3DPEHPK3PXP" }),
      );
      const client = createIdentityClient({ transport });

      await client.startMfaEnrollment("tok");

      expect(calls[0].url).toBe("/v1/mfa/enrollments");
      expect(calls[0].method).toBe("POST");
      expect(calls[0].headers.Authorization).toBe("Bearer tok");
    });

    it("sends an empty body for a first enrollment, because the code is the optional half", async () => {
      // The document requires a body and makes `code` optional, so a first
      // enrollment sends `{}` — a client that sent no body at all would be
      // refused by a service that reads the request body as required.
      const { transport, calls } = stubTransport(() => json(201, { enrollment_id: ENROLLMENT_ID }));
      const client = createIdentityClient({ transport });

      await client.startMfaEnrollment("tok");

      expect(calls[0].body).toBe("{}");
    });

    it("sends the current code when this is a rotation", async () => {
      const { transport, calls } = stubTransport(() => json(201, { enrollment_id: ENROLLMENT_ID }));
      const client = createIdentityClient({ transport });

      await client.startMfaEnrollment("tok", { code: "482913" });

      expect(calls[0].body).toBe('{"code":"482913"}');
    });

    it("returns the one-time secret and provisioning URI", async () => {
      const { transport } = stubTransport(() =>
        json(201, {
          enrollment_id: ENROLLMENT_ID,
          secret: "JBSWY3DPEHPK3PXP",
          provisioning_uri: "otpauth://totp/Acme:kaka@example.com?secret=JBSWY3DPEHPK3PXP",
          method: "totp",
          digits: 6,
          period_seconds: 30,
          algorithm: "SHA1",
          expires_at: "2026-09-30T12:14:11Z",
          replaced: false,
        }),
      );
      const client = createIdentityClient({ transport });

      const enrollment = await client.startMfaEnrollment("tok");

      expect(enrollment.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(enrollment.provisioning_uri).toContain("otpauth://totp/");
      expect(enrollment.replaced).toBe(false);
    });
  });

  describe("confirmMfaEnrollment", () => {
    it("posts the code to the enrollment's own confirm route", async () => {
      const { transport, calls } = stubTransport(() =>
        json(200, { enabled: true, recovery_codes: ["AAAA-BBBB-CCCC-DDDD"] }),
      );
      const client = createIdentityClient({ transport });

      await client.confirmMfaEnrollment("tok", ENROLLMENT_ID, { code: "482913" });

      expect(calls[0].url).toBe(`/v1/mfa/enrollments/${ENROLLMENT_ID}/confirm`);
      expect(calls[0].method).toBe("POST");
      expect(calls[0].body).toBe('{"code":"482913"}');
    });

    it("returns the recovery codes the confirm mints", async () => {
      const codes = ["AAAA-BBBB-CCCC-DDDD", "EEEEFFFFGGGGHHHH"];
      const { transport } = stubTransport(() =>
        json(200, {
          enabled: true,
          method: "totp",
          enrolled_at: "2026-09-30T12:04:11Z",
          recovery_codes: codes,
          replaced_existing_secret: false,
        }),
      );
      const client = createIdentityClient({ transport });

      const confirmed = await client.confirmMfaEnrollment("tok", ENROLLMENT_ID, { code: "482913" });

      expect(confirmed.recovery_codes).toEqual(codes);
      expect(confirmed.enabled).toBe(true);
    });

    it("raises an unauthorized error on a refused code, whatever the cause", async () => {
      // Wrong, already spent, malformed, and produced by a replaced secret are
      // all the same 401 — the document is explicit, and the client keeps the
      // status so the screen can render its one sentence.
      const { transport } = stubTransport(() => problem(401, { code: "invalid_code", title: "The code was refused" }));
      const client = createIdentityClient({ transport });

      const failure = await theFailure(client.confirmMfaEnrollment("tok", ENROLLMENT_ID, { code: "000000" }));

      expect(failure.status).toBe(401);
    });

    it("raises a not-found error for an enrollment that is not this caller's", async () => {
      // Another user's, an expired one's and an already-confirmed one's are all
      // 404, and the client keeps the status so the screen can tell "start
      // again" from "try another code".
      const { transport } = stubTransport(() => problem(404, { code: "not_found", title: "No such enrollment" }));
      const client = createIdentityClient({ transport });

      const failure = await theFailure(client.confirmMfaEnrollment("tok", ENROLLMENT_ID, { code: "482913" }));

      expect(failure.status).toBe(404);
    });
  });

  describe("regenerateMfaRecoveryCodes", () => {
    it("posts the code to /v1/mfa/recovery-codes", async () => {
      const { transport, calls } = stubTransport(() =>
        json(200, { recovery_codes: ["AAAA-BBBB-CCCC-DDDD"], recovery_codes_remaining: 10 }),
      );
      const client = createIdentityClient({ transport });

      await client.regenerateMfaRecoveryCodes("tok", { code: "482913" });

      expect(calls[0].url).toBe("/v1/mfa/recovery-codes");
      expect(calls[0].method).toBe("POST");
      expect(calls[0].headers.Authorization).toBe("Bearer tok");
      expect(calls[0].body).toBe('{"code":"482913"}');
    });

    it("returns the fresh set and the count that replaced the old one", async () => {
      const { transport } = stubTransport(() =>
        json(200, {
          recovery_codes: ["AAAA-BBBB-CCCC-DDDD", "EEEEFFFFGGGGHHHH"],
          issued_at: "2026-09-30T12:04:11Z",
          recovery_codes_remaining: 10,
        }),
      );
      const client = createIdentityClient({ transport });

      const codes = await client.regenerateMfaRecoveryCodes("tok", { code: "482913" });

      expect(codes.recovery_codes).toHaveLength(2);
      expect(codes.recovery_codes_remaining).toBe(10);
    });

    it("raises an unauthorized error when the factor is refused", async () => {
      // The route's 401 covers "refused" and "no second factor" alike, and the
      // client does not try to tell them apart — one status, one sentence.
      const { transport } = stubTransport(() => problem(401, { code: "invalid_code", title: "The factor was refused" }));
      const client = createIdentityClient({ transport });

      const failure = await theFailure(client.regenerateMfaRecoveryCodes("tok", { code: "000000" }));

      expect(failure.status).toBe(401);
    });
  });
});
