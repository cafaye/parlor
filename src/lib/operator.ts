/**
 * The system-admin surface: identity's human-session operator routes.
 *
 * Four routes, transcribed from the m147 packet's contract — NOT from
 * `identity/openapi/v1.yaml`, which does not describe them yet, and NOT from
 * running identity code, which is unmerged. If the merged service answers a
 * different shape, the mismatch is reported rather than absorbed here: the
 * readers below check the fields the contract names and let anything else
 * through untouched.
 *
 *   GET  /v1/operator/me                    200 {user:{id,email,staff}} | 401 | 403
 *   GET  /v1/operator/users?query=&limit=25  200 {users:[…]} | 401 | 403 | 422
 *   POST /v1/operator/users/{id}/disable     204 | 401 | 403 | 404
 *   POST /v1/operator/users/{id}/enable      204 | 401 | 403 | 404
 *
 * Three properties hold for every call here, and all three are the service's
 * rules rather than choices:
 *
 * 1. EVERY CALL TAKES THE SESSION TOKEN. These routes resolve a human session
 *    and then check `staff`; a scoped API key and a missing credential are
 *    both refused before anything is read. The existing machine-key
 *    disable/enable endpoints are a separate surface and are not in this file.
 * 2. Failures are `IdentityError`, the same envelope `src/lib/identity.ts`
 *    reads. Same service, same problem+json shape, no second error type — a
 *    401 stays "anonymous" and a 403 stays "authenticated but not staff", and
 *    a screen that flattened the two would send a signed-out operator to the
 *    wrong place.
 * 3. The base URL is this app's OWN ORIGIN, like every other client here.
 *    Every call goes through the `/v1` BFF allow-list in `src/lib/upstream.ts`,
 *    so no service address reaches the browser and no machine key exists in
 *    this file to leak.
 */

import {
  IdentityError,
  type Transport,
  type TransportRequest,
} from "@/lib/identity";

/** The origin every call in this file is made against: this app, same-origin. */
export const OPERATOR_BASE_URL = "";

/** The search page size the contract fixes. Sent on every search. */
export const OPERATOR_SEARCH_LIMIT = 25;

/**
 * Who the caller is, as `GET /v1/operator/me` answers it.
 *
 * `staff` is the whole of the authorization fact: true means this session may
 * use the other three calls, false means it is a 403 for doing so. A caller
 * that defaulted a missing `staff` to false would lock out an operator whose
 * answer was malformed; `readOperatorMe` refuses the body instead.
 */
export type OperatorMe = { user: { id: string; email: string; staff: boolean } };

/**
 * One row of `GET /v1/operator/users`.
 *
 * The four nullable timestamps are `string | null` and never absent-or-
 * defaulted: a disabled account with `disabled_at: null` invented by the
 * client is an enabled account, and a verified address with an invented
 * timestamp is a proved one. Absence is read as null, which is the safe side
 * for both.
 */
export type OperatorUser = {
  id: string;
  email: string;
  display_name: string | null;
  disabled_at: string | null;
  email_verified_at: string | null;
  created_at: string;
};

/**
 * The one client for the operator surface.
 *
 * Property declarations holding function types, for the reason `IdentityClient`
 * spells its members that way: method shorthand declares a `this` that does
 * not exist, and `@typescript-eslint/unbound-method` rejects the destructured
 * read every screen performs.
 */
export type OperatorClient = {
  /** Who this session is, and whether it is staff. The gate every screen reads. */
  me: (token: string) => Promise<OperatorMe>;
  /** Search users. The query must be non-empty; an empty one never reaches the wire. */
  searchUsers: (token: string, query: string) => Promise<OperatorUser[]>;
  /** Disable a user. 204; the audit record is identity's, attributed to this session. */
  disableUser: (token: string, userId: string) => Promise<void>;
  /** Re-enable a user. 204. */
  enableUser: (token: string, userId: string) => Promise<void>;
};

const fetchTransport: Transport = async ({ url, method, headers, body }) =>
  fetch(url, {
    method,
    headers,
    body,
    credentials: "same-origin",
  });

export function createOperatorClient(
  options: { baseUrl?: string; transport?: Transport } = {},
): OperatorClient {
  const base = (options.baseUrl ?? OPERATOR_BASE_URL).replace(/\/+$/, "");
  const transport = options.transport ?? fetchTransport;

  return {
    me: (token) => send(transport, `${base}/v1/operator/me`, "GET", { token }).then(readOperatorMe),
    searchUsers: (token, query) => {
      if (query.trim() === "") {
        throw new Error("searchUsers needs a non-empty query: identity answers 422 for an empty one");
      }
      const search = `?query=${encodeURIComponent(query)}&limit=${OPERATOR_SEARCH_LIMIT}`;
      return send<{ users: unknown }>(transport, `${base}/v1/operator/users${search}`, "GET", {
        token,
      }).then((body) => readOperatorUsers(body));
    },
    disableUser: (token, userId) =>
      send(transport, `${base}/v1/operator/users/${encodeURIComponent(userId)}/disable`, "POST", {
        token,
      }),
    enableUser: (token, userId) =>
      send(transport, `${base}/v1/operator/users/${encodeURIComponent(userId)}/enable`, "POST", {
        token,
      }),
  };
}

/**
 * Reads `GET /v1/operator/me` strictly.
 *
 * The contract names `user.id`, `user.email` and `user.staff`. A body missing
 * any of the three is not "not staff" — it is unreadable, and reading it as a
 * refusal would turn a malformed answer into a denied operator. It throws
 * `IdentityError` with the real status so a caller can tell the two apart.
 */
function readOperatorMe(body: unknown): OperatorMe {
  const record = asRecord(body);
  const user = record ? asRecord(record.user) : null;
  const id = user ? readString(user.id) : null;
  const email = user ? readString(user.email) : null;
  const staff = user ? user.staff : undefined;
  if (id === null || email === null || typeof staff !== "boolean") {
    throw new IdentityError("identity's operator/me answered a body this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return { user: { id, email, staff } };
}

/**
 * Reads `GET /v1/operator/users` strictly.
 *
 * `users` must be an array; each row must carry `id`, `email` and
 * `created_at`. The nullable fields default to null when absent, which is the
 * safe side for both — never an invented timestamp, never an invented state.
 */
function readOperatorUsers(body: { users: unknown }): OperatorUser[] {
  if (!Array.isArray(body.users)) {
    throw new IdentityError(
      "identity's operator/users answered a body this app does not recognise",
      { status: 200, code: "internal" },
    );
  }
  return body.users.map((entry) => {
    const record = asRecord(entry);
    const id = record ? readString(record.id) : null;
    const email = record ? readString(record.email) : null;
    const createdAt = record ? readString(record.created_at) : null;
    if (id === null || email === null || createdAt === null) {
      throw new IdentityError(
        "identity's operator/users answered a row this app does not recognise",
        { status: 200, code: "internal" },
      );
    }
    return {
      id,
      email,
      display_name: record ? readNullableString(record.display_name) : null,
      disabled_at: record ? readNullableString(record.disabled_at) : null,
      email_verified_at: record ? readNullableString(record.email_verified_at) : null,
      created_at: createdAt,
    };
  });
}

async function send<T>(
  transport: Transport,
  url: string,
  method: TransportRequest["method"],
  options: { token: string },
): Promise<T> {
  const response = await transport({
    url,
    method,
    headers: {
      Accept: "application/json, application/problem+json",
      Authorization: `Bearer ${options.token}`,
    },
  });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await readJson(response, url)) as T;
}

async function readJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    throw new IdentityError(`identity returned an empty body for ${url} (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
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
 * The same two envelopes `src/lib/identity.ts` reads — RFC 9457 problem+json
 * and the `{error:{…}}` shape — because this is the same service answering.
 * The 401/403 distinction is preserved in `status`: anonymous and non-staff
 * are different answers and the screens branch on them.
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
  if (nested) {
    return new IdentityError(
      readString(nested.message) ?? readString(nested.detail) ?? `Request to identity failed (${status})`,
      {
        status,
        code: readString(nested.code) ?? "internal",
        title: readString(nested.title) ?? readString(nested.message) ?? null,
        traceId,
      },
    );
  }
  if (body) {
    const code = readString(body.code) ?? "internal";
    const title = readString(body.title) ?? null;
    const detail = readString(body.detail);
    return new IdentityError(detail ?? title ?? `Request to identity failed (${status})`, {
      status,
      code,
      title,
      traceId,
    });
  }
  return new IdentityError(`Request to identity failed (${status})`, { status, traceId });
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

/**
 * A nullable contract string: a string, or null when absent or null.
 *
 * Distinct from `readString`, which refuses empties: these fields are
 * timestamps or names the service mints, and an empty string is not a value
 * the contract declares — reading it as null keeps the screen from rendering
 * one.
 */
function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length > 0 ? value : null;
}
