import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_IDENTITY_URL,
  MIN_PASSWORD_LENGTH,
  IdentityError,
  createIdentityClient,
  fieldErrorMessage,
  identityBaseUrl,
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
) =>
  json(status, {
    type: `https://errors.cafaye.com/${fields.code}`,
    title: fields.title,
    status,
    detail: fields.detail,
    code: fields.code,
    trace_id: "trace_123",
    ...(fields.errors ? { errors: fields.errors } : {}),
  });

const CREDENTIALS = { email: "kaka@example.com", password: "correct horse" };

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
  delete process.env.NEXT_PUBLIC_IDENTITY_URL;
});

describe("base url", () => {
  it("defaults to the local identity service", () => {
    expect(DEFAULT_IDENTITY_URL).toBe("http://localhost:8080");
  });

  it("falls back to the default when the env var is unset", () => {
    expect(identityBaseUrl()).toBe(DEFAULT_IDENTITY_URL);
  });

  it("falls back to the default when the env var is blank", () => {
    process.env.NEXT_PUBLIC_IDENTITY_URL = "   ";

    expect(identityBaseUrl()).toBe(DEFAULT_IDENTITY_URL);
  });

  it("uses NEXT_PUBLIC_IDENTITY_URL when it is set", () => {
    process.env.NEXT_PUBLIC_IDENTITY_URL = "https://identity.cafaye.com";

    expect(identityBaseUrl()).toBe("https://identity.cafaye.com");
  });
});

describe("register", () => {
  it("posts the credentials to /v1/users as JSON", async () => {
    const { transport, calls } = stubTransport(() => json(201, { id: "usr_1", email: CREDENTIALS.email }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.register(CREDENTIALS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://identity.test/v1/users");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual(CREDENTIALS);
  });

  it("sends no bearer token when registering", async () => {
    const { transport, calls } = stubTransport(() => json(201, { id: "usr_1", email: CREDENTIALS.email }));
    const client = createIdentityClient({ baseUrl, transport });

    await client.register(CREDENTIALS);

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("returns the created user on 201", async () => {
    const { transport } = stubTransport(() => json(201, { id: "usr_1", email: "kaka@example.com" }));
    const client = createIdentityClient({ baseUrl, transport });

    await expect(client.register(CREDENTIALS)).resolves.toEqual({
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

    const error = await client.register(CREDENTIALS).catch((thrown: unknown) => thrown);

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
      .register(CREDENTIALS)
      .catch((thrown: unknown) => thrown)) as IdentityError;

    expect(error.code).toBe("conflict");
    expect(error.fieldErrors).toEqual([]);
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

    await expect(client.login(CREDENTIALS)).resolves.toEqual({
      token: "tok_abc",
      expires_at: "2026-10-01T00:00:00Z",
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
      .register(CREDENTIALS)
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
      .register(CREDENTIALS)
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
      .register(CREDENTIALS)
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
