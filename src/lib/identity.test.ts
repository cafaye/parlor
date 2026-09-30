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
});
