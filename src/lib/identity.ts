/**
 * Typed client for the identity service.
 *
 * The endpoints this file speaks are fixed by contract:
 *
 *   POST   /v1/users     201 {id,email} | 422 | 409
 *   POST   /v1/session  200 {token,expires_at} | 401
 *   DELETE /v1/session  204
 *   GET    /v1/me        200 {id,email} | 401
 *
 * plus the two password-reset routes below, and the tenancy surface the same
 * service exposes under /v1/accounts and /v1/invitations. See "The tenancy
 * surface" below for where those shapes come from, which is not the place you
 * would expect.
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

import { MAX_NAME_LENGTH, type Role } from "@/lib/roles";

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

// ---------------------------------------------------------------------------
// The tenancy surface
//
// These shapes are transcribed from the service's own handler — the `json:` tags
// on accountResponse, accountListItem, membershipResponse, invitationResponse
// and the five request bodies in `identity/internal/httpapi/accounts.go` — and
// the status codes from its `registerTenancyRoutes` and `writeTenancyError`.
//
// They are NOT transcribed from `identity/openapi/v1.yaml`, because that
// document does not describe any of them. The document was last changed before
// the packet that added the tenancy implementation was merged, so the routes
// exist in the service and in its tests but not in the published contract. The
// handler is the stricter authority anyway — a struct tag is the wire, and a
// document is a description of one — but the gap is real and is the first thing
// that should be closed on the service side. Until it is, this file is the
// client half of a contract that has not been written down yet.
// ---------------------------------------------------------------------------

/**
 * An account, as the caller sees it.
 *
 * `role` is the CALLER's role in this account and not a property of the
 * account, which is why it travels on every response: without it a client
 * cannot decide whether to render a settings form, and answering that needs a
 * round trip for a value the authorization layer has already resolved.
 */
export type Account = {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  role: Role;
  created_at: string;
  updated_at: string;
};

/**
 * The account detail response.
 *
 * `members` is `omitempty` on the wire and absent on a list, and the absence is
 * meaningful: an empty list and no list are different answers, so this is
 * optional rather than defaulted to `[]`.
 */
export type AccountDetail = Account & { members?: Membership[] };

/**
 * One row of `GET /v1/accounts`.
 *
 * Its own type rather than a trimmed `Account`, because the service sends
 * neither `members` nor `updated_at` here and a list is "a navigation aid
 * carrying the minimum a client needs to render a row and open it".
 */
export type AccountListItem = {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  role: Role;
  created_at: string;
};

/** A membership: an account, a user, and a role. */
export type Membership = {
  account_id: string;
  user_id: string;
  role: Role;
  created_at: string;
};

/**
 * The member panel's response.
 *
 * A wrapper rather than an array so a client rendering the panel knows the
 * caller's own role without a third request.
 */
export type MemberList = { memberships: Membership[]; role: Role };

/**
 * A pending invitation, and on creation its one-time token.
 *
 * `token` appears here and nowhere else: there is no endpoint that re-reads it
 * and no column that stores it, only its digest. It is returned because until
 * courier exists, returning it is the only way an invitation can be delivered
 * at all. Nothing here may store it.
 */
export type Invitation = {
  id: string;
  account_id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  created_at: string;
};

/** One `{field, code}` pair out of a 422. The codes are contract vocabulary. */
export type FieldError = { field: string; code: string };

export type TransportRequest = {
  url: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  body?: string;
};

export type Transport = (request: TransportRequest) => Promise<Response>;

export type IdentityClient = {
  register(credentials: Credentials): Promise<User>;
  login(credentials: Credentials): Promise<Session>;
  logout(token: string): Promise<void>;
  me(token: string): Promise<User>;

  // The tenancy surface. Every one of these takes the session token, because
  // every account route resolves a session before it does anything else, and
  // the token doubles as the path segment's authority: a call without it is a
  // 401 rather than a 403.
  listAccounts(token: string): Promise<AccountListItem[]>;
  createAccount(token: string, input: { name: string }): Promise<Account>;
  getAccount(token: string, accountId: string): Promise<AccountDetail>;
  renameAccount(token: string, accountId: string, input: { name: string }): Promise<Account>;
  deleteAccount(token: string, accountId: string): Promise<void>;
  listMembers(token: string, accountId: string): Promise<MemberList>;
  inviteMember(
    token: string,
    accountId: string,
    input: { email: string; role: Role },
  ): Promise<Invitation>;
  acceptInvitation(token: string, input: { token: string }): Promise<Membership>;
  changeMemberRole(
    token: string,
    accountId: string,
    userId: string,
    input: { role: Role },
  ): Promise<Membership>;
  removeMember(token: string, accountId: string, userId: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // The recovery surface — see the wiring below for why neither takes a token.
  //
  // `requestPasswordReset` answers 202 for every address and returns the
  // service's constant `{"status":"accepted"}`, which is the entire
  // account-enumeration defence on that route. `redeemPasswordReset` answers 204
  // with no body, revokes every session and access token the account holds, and
  // mints nothing: a caller who redeems a reset is signed out by the same write
  // that changed the password. Both facts are load-bearing for the screens.
  // ---------------------------------------------------------------------------
  requestPasswordReset(email: string): Promise<RecoveryAccepted>;
  redeemPasswordReset(input: RedeemPasswordResetInput): Promise<void>;

  // ---------------------------------------------------------------------------
  // The verification surface, which is three routes rather than two and whose
  // enumeration stance is NOT the same as the reset surface's.
  //
  // `requestEmailVerification` answers the same constant 202 as
  // `requestPasswordReset` for an address with an account, one without, and one
  // inside the cooldown — with ONE declared exception, a 409 for an address that
  // is already proved. That 409 is the service's own stated trade (see
  // `RequestVerification`), so this client surfaces it rather than flattening it
  // into the acceptance answer.
  //
  // `redeemEmailVerification` answers 204 and, unlike the reset redemption,
  // revokes nothing and mints nothing: a verification is a fact about an address,
  // not a change of credential. Nobody is signed out by it and nobody is signed in.
  //
  // `verificationStatus` is the ONE route here that takes the token, because it
  // is the only one that answers a question about the caller rather than about a
  // token they were handed.
  // ---------------------------------------------------------------------------
  requestEmailVerification(email: string): Promise<RecoveryAccepted>;
  redeemEmailVerification(input: RedeemVerificationInput): Promise<void>;
  verificationStatus(token: string): Promise<VerificationStatus>;
};

/**
 * `202 {"status":"accepted"}` — the body of `POST /v1/password-resets`.
 *
 * It is typed rather than discarded because the contract declares it, but the
 * screens must not branch on it: it is the same for a registered address and an
 * unregistered one, which is the property worth having, so there is nothing in it
 * to read.
 */
export type RecoveryAccepted = { status: string };

/**
 * The body of `POST /v1/password-resets/confirm`.
 *
 * `token` is the credential from the emailed link and `password` is the value to
 * move to. There is no `email` and no `session`: the token IS the authority, which
 * is why this route is anonymous and why redeeming it signs the caller out.
 */
export type RedeemPasswordResetInput = { token: string; password: string };

/**
 * The body of `POST /v1/email-verifications/confirm`.
 *
 * `tokenRequest` in the handler: one field, and the other two token routes are
 * deliberately not folded into it. A shared type with an optional `password`
 * would invite a client to send a password to a verification endpoint, where the
 * service would ignore it — and "ignored" is worse than "refused", because a
 * caller that believed the field was accepted would never learn to retry.
 *
 * There is no `email` and no `session`: the token IS the authority, which is why
 * the route is anonymous and why redeeming it costs nobody their session.
 */
export type RedeemVerificationInput = { token: string };

/**
 * The 200 from `GET /v1/email-verification`.
 *
 * `verificationStatusResponse` in the handler. `email_verified_at` is OPTIONAL
 * and that is load-bearing: it is absent for an address that was never proved,
 * which is a different answer from an epoch timestamp, and different again from
 * `false` on an address that was proved and then changed — a changed address
 * lands unverified. So the type does not default it and the screen does not
 * invent one.
 */
export type VerificationStatus = {
  email: string;
  email_verified: boolean;
  email_verified_at?: string;
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

    listAccounts: (token) => send(transport, `${base}/v1/accounts`, "GET", { token }),
    createAccount: (token, input) =>
      send(transport, `${base}/v1/accounts`, "POST", { token, body: input }),
    getAccount: (token, accountId) =>
      send(transport, `${base}/v1/accounts/${accountId}`, "GET", { token }),
    renameAccount: (token, accountId, input) =>
      send(transport, `${base}/v1/accounts/${accountId}`, "PATCH", { token, body: input }),
    deleteAccount: (token, accountId) =>
      send(transport, `${base}/v1/accounts/${accountId}`, "DELETE", { token }),
    listMembers: (token, accountId) =>
      send(transport, `${base}/v1/accounts/${accountId}/members`, "GET", { token }),
    inviteMember: (token, accountId, input) =>
      send(transport, `${base}/v1/accounts/${accountId}/invitations`, "POST", {
        token,
        body: input,
      }),
    acceptInvitation: (token, input) =>
      send(transport, `${base}/v1/invitations/accept`, "POST", { token, body: input }),
    changeMemberRole: (token, accountId, userId, input) =>
      send(transport, `${base}/v1/accounts/${accountId}/members/${userId}`, "PATCH", {
        token,
        body: input,
      }),
    removeMember: (token, accountId, userId) =>
      send(transport, `${base}/v1/accounts/${accountId}/members/${userId}`, "DELETE", { token }),

    // -----------------------------------------------------------------------
    // The recovery surface.
    //
    // NEITHER CALL TAKES A TOKEN, and that is the service's rule rather than an
    // omission here. All eight recovery routes are wrapped in
    // `sessionCredentialOnly`, which refuses a scoped API key outright: a key
    // that can mint a password reset is a takeover with a delay rather than a
    // break-in. The four anonymous routes, these two among them, are exactly the
    // ones where presenting a credential would be worst. So `send` is called with
    // no `token`, and no `Authorization` header goes out at all.
    //
    // The request bodies and the statuses are transcribed from the handler
    // (`identity/internal/httpapi/recovery.go`) for the same reason the tenancy
    // shapes above are transcribed rather than read off the OpenAPI document.
    // -----------------------------------------------------------------------

    requestPasswordReset: (email) =>
      send(transport, `${base}/v1/password-resets`, "POST", { body: { email } }),
    redeemPasswordReset: (input) =>
      send(transport, `${base}/v1/password-resets/confirm`, "POST", { body: input }),

    // -----------------------------------------------------------------------
    // The verification surface.
    //
    // The same rule as the two calls above: both POSTs are wrapped in
    // `sessionCredentialOnly` and take no credential, so `send` is called with no
    // `token` and no Authorization header goes out at all. `verificationStatus`
    // is the exception — it resolves a session through `currentUser`, so it
    // carries the token like every other session-scoped call in this file.
    //
    // THE SINGULAR ROUTE IS `/v1/email-verification`, not `/v1/email-verifications`.
    // One word, singular, reading the caller's own state against the two-word
    // plural routes that start and redeem a flow. It is transcribed rather than
    // guessed because it is exactly the kind of name a plausible guess gets wrong,
    // and a wrong path here is a 404 that looks like an unverified account.
    // -----------------------------------------------------------------------

    requestEmailVerification: (email) =>
      send(transport, `${base}/v1/email-verifications`, "POST", { body: { email } }),
    redeemEmailVerification: (input) =>
      send(transport, `${base}/v1/email-verifications/confirm`, "POST", { body: input }),
    verificationStatus: (token) =>
      send(transport, `${base}/v1/email-verification`, "GET", { token }),
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
  // The tenancy codes first, because a role failure is a sentence about what
  // the service will not let you do rather than about the shape of a value, and
  // the generic fallbacks below would flatten all four of them into "Role is
  // not valid." — which is true, useless, and the same sentence for four
  // different mistakes.
  const tenancy = tenancyFieldMessage(field, code);
  if (tenancy) return tenancy;

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
      // The name has a published bound, so the sentence can quote it rather
      // than say "too long" and send somebody to look it up.
      return field === "name"
        ? `Use ${MAX_NAME_LENGTH} characters or fewer.`
        : `${label} is too long.`;
    default:
      // An unknown code is a gap in this table, not something to show a person.
      // It stays on the error for telemetry; the sentence stays plain.
      return `${label} is not valid.`;
  }
}

/**
 * The tenancy field codes, which the service declares in its own package.
 *
 * `internal/accounts/accounts.go` calls these "part of the contract and
 * clients may switch on them", so each one gets a sentence that says what
 * actually happened rather than what shape a value had.
 */
function tenancyFieldMessage(field: string, code: string): string | null {
  // Two client-only codes, not ones from the service.
  //
  // `POST /v1/password-resets/confirm` takes `{token, password}` and never sees
  // a confirmation, so "these two do not match" is only catchable on this side.
  // It goes through here rather than into the reset screen anyway, because this
  // is the one place a field code becomes a sentence, and a screen that wrote
  // its own would be the second place.
  if (field === "password_confirmation" && code === "mismatch") {
    return "The two passwords do not match.";
  }
  if (field === "name" && code === "invalid_format") {
    // ValidateName's third rule. A name with nothing sluggable in it would
    // produce an empty slug, and a slug is NOT NULL and unique — so the service
    // refuses it rather than turning a 422 into a 500. Saying so is more use
    // than "Name is not valid."
    return "Use a name with at least one letter or number in it.";
  }
  if (field === "role" && code === "not_invitable") {
    return "An invitation may carry the admin or member role.";
  }
  if (field === "role" && code === "last_owner") {
    return "This account must keep at least one owner.";
  }
  if (field === "role" && code === "unknown_role") {
    return "Choose a role this account recognises.";
  }
  return null;
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
