/**
 * Typed client for the identity service.
 *
 * The four endpoints this file speaks are fixed by contract:
 *
 *   POST   /v1/users     201 {id,email} | 422 | 409
 *   POST   /v1/session  200 {token,expires_at} | 401
 *   DELETE /v1/session  204
 *   GET    /v1/me        200 {id,email} | 401
 *
 * Two decisions are worth stating up front, because both will look like
 * accidents otherwise.
 *
 * 1. Errors are parsed from RFC 9457 problem+json, as `core` requires every
 *    cafaye service to answer (core/docs/openapi-conventions.md). The brief
 *    for identity-02 writes the failure body as `{error:{…}}`, which is a
 *    different shape for the same thing. Until the manager picks one, both are
 *    read and both produce the same `IdentityError`. See `parseError`.
 *
 * 2. The transport is a parameter, not `fetch`. Every caller in this repo
 *    injects one — a stub in tests, the real one in the browser — so a test
 *    can never reach the network by accident, and a future BFF proxy is a
 *    different transport rather than a rewrite of every screen.
 */

/** Where identity runs when nothing says otherwise: the compose stack. */
export const DEFAULT_IDENTITY_URL = "http://localhost:8080";

/**
 * Client-side mirror of `users.MinPasswordLength` in the identity service.
 *
 * This exists so a person is told the rule before a round trip, not instead of
 * one. The service is the authority: if the two ever disagree, the service is
 * right and this constant is the bug.
 */
export const MIN_PASSWORD_LENGTH = 8;

export type Credentials = { email: string; password: string };
export type User = { id: string; email: string };
export type Session = { token: string; expires_at: string };

/** One `{field, code}` pair out of a 422. The codes are contract vocabulary. */
export type FieldError = { field: string; code: string };

export type TransportRequest = {
  url: string;
  method: "GET" | "POST" | "DELETE";
  headers: Record<string, string>;
  body?: string;
};

export type Transport = (request: TransportRequest) => Promise<Response>;

export type IdentityClient = {
  register(credentials: Credentials): Promise<User>;
  login(credentials: Credentials): Promise<Session>;
  logout(token: string): Promise<void>;
  me(token: string): Promise<User>;
};

export class IdentityError extends Error {
  readonly status: number;
  /** A reserved code (`core/docs/openapi-conventions.md`), or `internal`. */
  readonly code: string;
  /** The fixed human summary for the code. Never occurrence-specific. */
  readonly title: string | null;
  /** Per-field failures from a 422. Empty for every other status. */
  readonly fieldErrors: FieldError[];
  /** `trace_id` from the body, else `X-Trace-Id`. What support will ask for. */
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
    this.name = "IdentityError";
    this.status = options.status;
    this.code = options.code ?? "internal";
    this.title = options.title ?? null;
    this.fieldErrors = options.fieldErrors ?? [];
    this.traceId = options.traceId ?? null;
  }
}

/** Reads the service address at call time so the env var is testable. */
export function identityBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_IDENTITY_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : DEFAULT_IDENTITY_URL;
}

/**
 * The browser transport.
 *
 * `credentials: "omit"` on purpose: this is a cross-origin API call whose
 * authority is the bearer token in the header, and an ambient cookie would add
 * a second one that nobody here is managing. Identity does set a session
 * cookie for same-origin callers; the BFF packet that moves parlor behind one
 * origin is where that becomes the browser's job.
 */
const fetchTransport: Transport = async ({ url, method, headers, body }) =>
  fetch(url, {
    method,
    headers,
    body,
    credentials: "omit",
  });

export function createIdentityClient(
  options: { baseUrl?: string; transport?: Transport } = {},
): IdentityClient {
  const base = (options.baseUrl ?? identityBaseUrl()).replace(/\/+$/, "");
  const transport = options.transport ?? fetchTransport;

  return {
    register: (credentials) => send(transport, `${base}/v1/users`, "POST", { body: credentials }),
    login: (credentials) => send(transport, `${base}/v1/session`, "POST", { body: credentials }),
    logout: (token) => send(transport, `${base}/v1/session`, "DELETE", { token }),
    me: (token) => send(transport, `${base}/v1/me`, "GET", { token }),
  };
}

async function send<T>(
  transport: Transport,
  url: string,
  method: TransportRequest["method"],
  options: { body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  // Only a request that carries a token has one to send. register and login
  // must arrive with no Authorization header at all.
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await transport({ url, method, headers, body });
  if (!response.ok) throw await parseError(response);

  // 204 has no body by definition; anything else is a contract violation, and
  // reading it should say so rather than raise a parse error about `null`.
  if (response.status === 204) return undefined as T;

  return (await readJson(response)) as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new IdentityError(`identity returned a body that is not JSON (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
}

/**
 * Turns a failure response into an `IdentityError`.
 *
 * The status is the one fact that is never in doubt, so it is captured first
 * and everything after is best effort: a proxy's HTML 502 and a service's
 * problem+json 422 both come out as an `IdentityError` a screen can render.
 */
async function parseError(response: Response): Promise<IdentityError> {
  const { status } = response;
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    // A body that cannot even be read is still a failure we can describe.
  }

  const body = asRecord(safeParse(raw));
  const traceId = readString(body?.trace_id) ?? response.headers.get("X-Trace-Id");
  const nested = asRecord(body?.error);
  if (nested) return fromNestedEnvelope(nested, status, traceId);
  if (body) return fromProblemEnvelope(body, status, traceId);

  return new IdentityError(`Request to identity failed (${status})`, { status, traceId });
}

function fromProblemEnvelope(
  body: Record<string, unknown>,
  status: number,
  traceId: string | null,
): IdentityError {
  const code = readString(body.code) ?? "internal";
  const title = readString(body.title) ?? null;
  const detail = readString(body.detail);
  return new IdentityError(detail ?? title ?? `Request to identity failed (${status})`, {
    status,
    code,
    title,
    fieldErrors: readProblemFieldErrors(body.errors),
    traceId,
  });
}

/**
 * The `{error:{…}}` shape from the identity-02 brief, read into the same
 * `IdentityError` as the problem+json above. `fields` is a map of field name
 * to a list of codes, so a field with two failures becomes two entries and
 * the screen picks the first.
 */
function fromNestedEnvelope(
  error: Record<string, unknown>,
  status: number,
  traceId: string | null,
): IdentityError {
  const fieldErrors: FieldError[] = [];
  const fields = asRecord(error.fields);
  for (const [field, codes] of Object.entries(fields ?? {})) {
    for (const code of Array.isArray(codes) ? codes : [codes]) {
      if (typeof code === "string") fieldErrors.push({ field, code });
    }
  }

  return new IdentityError(
    readString(error.message) ?? readString(error.detail) ?? `Request to identity failed (${status})`,
    {
      status,
      code: readString(error.code) ?? "internal",
      title: readString(error.title) ?? readString(error.message) ?? null,
      fieldErrors,
      traceId,
    },
  );
}

function readProblemFieldErrors(value: unknown): FieldError[] {
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

/** Turns one contract field code into a sentence for a person. */
export function fieldErrorMessage(field: string, code: string): string {
  const label = fieldLabel(field);
  switch (code) {
    case "required":
      return `${label} is required.`;
    case "invalid_format":
      return field === "email" ? "Enter a valid email address." : `${label} is not valid.`;
    case "too_short":
      return field === "password"
        ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
        : `${label} is too short.`;
    case "too_long":
      return `${label} is too long.`;
    default:
      // An unknown code is a gap in this table, not something to show a person.
      // It stays on the error for telemetry; the sentence stays plain.
      return `${label} is not valid.`;
  }
}

function fieldLabel(field: string): string {
  if (field === "email") return "Email";
  if (field === "password") return "Password";
  const words = field.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
