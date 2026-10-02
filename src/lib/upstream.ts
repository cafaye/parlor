/**
 * The same-origin forwarder: the server side of the BFF.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * A browser on a deployed `parlor` could not sign in, and the cause was not in
 * either repository's code:
 *
 *   * `parlor` called `identity` from the BROWSER, at `NEXT_PUBLIC_IDENTITY_URL`,
 *     which `next build` inlines into the client bundle. The caller of identity
 *     was a person's browser, on the app's own origin.
 *   * `identity` serves no CORS headers at all. There is no `Access-Control-*`
 *     anywhere in `identity/internal/`, and `OPTIONS /v1/session` answers 405
 *     because the route implements POST and a preflight is not that.
 *   * So the preflight failed, the response was unreadable, and `/login` rendered
 *     "Something went wrong. Try again."
 *
 * The end-to-end stack worked around it with nginx (`e2e/edge.conf`) and the
 * deploy could not, because kamal-proxy routes by hostname rather than by path:
 * one hostname cannot send `/v1/*` to identity and everything else to parlor.
 *
 * THIS IS THE OTHER HALF OF THAT ARGUMENT. The browser's traffic now goes to
 * this app, on this app's origin, and this file is what decides where it goes
 * next. Same-origin needs no CORS header anywhere, which is the whole of what
 * makes a sign-in possible — and it is why the alternative (permissive CORS on
 * identity) was not taken: that would have let every origin on the internet call
 * identity with a bearer token it stole from anywhere else, solving a deployment
 * problem by weakening the one service that does not have it.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR PROPERTIES, AND WHY EACH IS A SEPARATE THING
 * ---------------------------------------------------------------------------
 * This is a forwarder, and a forwarder that gets any of these wrong is an open
 * proxy: a server on the internet that will send a request anywhere anybody asks.
 *
 *   1. ONE CONFIGURED DESTINATION, NEVER A CALLER-SUPPLIED HOST. The two
 *      upstreams are constructor parameters read from the environment by the
 *      route handler. They are not read from a header, a query string, a path
 *      segment or the request body, and there is no code path that could.
 *
 *      `NEXT_PUBLIC_*` inlining is what made the old arrangement a trap in the
 *      other direction: a value the browser can read is a value the browser can
 *      change. These two values are read on the server, at request time, and are
 *      not in the bundle at all — see `src/app/v1/[...path]/route.ts`.
 *
 *   2. FORWARD ONLY THE PATHS THAT ARE NEEDED, AND REJECT THE REST. The table
 *      below is transcribed from the two clients. `identity` serves thirty
 *      routes; twenty-two are reachable from here, and the eight that are not
 *      (`/v1/introspections`, the MFA routes, API keys, OIDC clients, email
 *      changes, `/v1/probe/{id}`) are refused before an address is contacted.
 *      A route being reachable from the internet is a decision somebody makes,
 *      not a side effect of a client existing.
 *
 *      The upstream path is REBUILT from the table rather than forwarded as
 *      received. That is the property that makes traversal structurally
 *      impossible instead of filtered: there is no code that concatenates a
 *      caller's bytes into a URL, so `../`, an absolute URL in a segment, and a
 *      doubled slash are all simply not expressible.
 *
 *   3. DO NOT LEAK THE UPSTREAM'S INTERNAL ADDRESS. On a transport failure this
 *      answers 502 with a fixed body. `ECONNREFUSED 10.0.3.7:8080` names a
 *      container that is not published anywhere, and a fetch error message is
 *      the single most reliable way to hand out the internal topology.
 *
 *   4. DO NOT SWALLOW UPSTREAM ERRORS INTO A GENERIC 200. The status and body
 *      pass through. A 401 that became a 200 would render a wrong password as a
 *      success, and a 422 that became a 400 would drop the field errors the
 *      forms turn into sentences.
 *
 * ---------------------------------------------------------------------------
 * THE COOKIE, WHICH IS THE PART THAT ONLY WORKS BECAUSE OF ALL OF THE ABOVE
 * ---------------------------------------------------------------------------
 * `identity` sets `__Host-session` (`Secure`, `HttpOnly`, `SameSite=Lax`,
 * `Path=/`, no `Domain`). Before this packet the transport said
 * `credentials: "omit"` because the call was cross-origin and the cookie was
 * unreachable; now the call is same-origin, so the browser owns the cookie, and
 * this file has to carry it in both directions.
 *
 * The attributes are load-bearing in a way they were not, and the load-bearing
 * part is the `__Host-` PREFIX, which is a contract the BROWSER enforces:
 *
 *   * `Domain` MUST be ABSENT. A `__Host-` cookie with a `Domain` attribute is
 *     rejected outright by the browser. So is one without `Path=/`, and one
 *     without `Secure`. This is why the `Set-Cookie` header is forwarded byte
 *     for byte and never rewritten: the obvious "fix" of adding a `Domain` to
 *     make the cookie work is precisely what makes it stop working, and a
 *     rewrite that dropped the `__Host-` prefix would trade a browser-enforced
 *     guarantee for a convention.
 *   * `Secure` means the cookie is only stored on an HTTPS origin. A deploy
 *     behind kamal-proxy has `ssl: true` (`config/deploy.yml`), so the
 *     production origin is HTTPS and the cookie is stored. On the plain-HTTP
 *     compose stack the browser refuses it — which is correct behaviour, not a
 *     bug, and the reason the client also carries a bearer token.
 *   * `SameSite=Lax` is right here and would be wrong if this were cross-origin:
 *     every request the browser makes to this app is same-site, so Lax sends the
 *     cookie, and a cross-site caller gets nothing. That is the CSRF property,
 *     and it comes from the topology rather than from anything set here.
 *   * `Host` is not forwarded. The upstream gets its own from the URL, and a
 *     caller's `Host` or `X-Forwarded-Host` is not a route and never was.
 *
 * WHAT THIS DOES NOT DO: it does not move the session token out of `localStorage`.
 * The client still holds identity's opaque token and still sends it as a bearer
 * header, and `identity` prefers the header over the cookie anyway
 * (`presentedToken`). Retiring the `localStorage` half is the guard packet's
 * work — the BFF and the cookie are what make it possible, and the token's
 * continued presence is a known position, not an oversight. See README,
 * "Sessions".
 */

/** The services this app forwards to. Nothing else is reachable. */
export type UpstreamName = "identity" | "billing";

/**
 * The request body ceiling, in bytes.
 *
 * `4 << 10`, which is `maxRequestBody` in `identity/internal/httpapi/auth.go` —
 * a registration is an address and a password, so a legitimate body is under
 * 2 KB. The number is here so the refusal happens BEFORE the read rather than
 * after it: a forwarder that buffers a megabyte and then complains has already
 * spent the memory it was trying to save. It is not a second rule, so the
 * refusal is the same one identity would have made, for the same reason.
 */
export const MAX_REQUEST_BODY_BYTES = 4 << 10;

/**
 * Request headers that cross to the upstream. Everything else is dropped.
 *
 *   * `authorization` — identity's session token. The whole point.
 *   * `content-type` — a JSON body has to stay a JSON body.
 *   * `accept` — the clients ask for `application/json, application/problem+json`
 *     and a forwarder that dropped this would make identity answer with
 *     something the client cannot parse.
 *   * `cookie` — the same-origin session cookie. See the header comment.
 *   * `idempotency-key` — billing's `POST /v1/customers`. The header's entire
 *     purpose is to make a retry replay the original response, and dropping it
 *     turns a retry into a second customer.
 *   * `x-trace-id` — propagated so one failure has one identifier across the hop.
 *
 * The list is an ALLOW list and not a deny list, and that is the whole
 * discipline. A deny list has to have thought of `X-Forwarded-For` and
 * `X-Original-URL` and every header a future proxy invents; an allow list has to
 * have thought of the four the clients actually send. A header this file does
 * not name cannot be a smuggling channel, which is a property a deny list never
 * has.
 */
export const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "cookie",
  "idempotency-key",
  "x-trace-id",
] as const;

/**
 * Response headers that cross back to the browser, plus `Set-Cookie`.
 *
 * `content-type` and `x-trace-id` are the two the client reads. `set-cookie` is
 * handled separately, because `headers.get("set-cookie")` on a folded header
 * joins the values with ", " — which lands inside one cookie's `Expires` and
 * destroys both. `headers.getSetCookie()` is the only correct spelling, and
 * identity's 202 MFA branch is the case that proves it matters.
 *
 * Everything else is dropped. An upstream's `Server` or `X-Powered-By` names the
 * internal service and its version, and there is no client in this repository
 * that reads either.
 */
export const FORWARDED_RESPONSE_HEADERS = ["content-type", "x-trace-id"] as const;

/**
 * One shape of path segment, and how to recognise it.
 *
 * `uuid` is what `identity` puts in every id: `user.ID.String()` and
 * `accountResponse.ID` are both `uuid.UUID`, so a segment that is not one is not
 * a route this app has ever held. `slug` is billing's plan slug.
 * `token` is the opaque form recovery and invitation tokens take, and it is
 * deliberately loose: those are base64url and the alphabet is not this
 * repository's to narrow.
 */
type SegmentKind = "uuid" | "slug" | "token";

/** A route in the table: a method, a path shape, and where it goes. */
type Route = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Segments after `/v1`. A `:name` is a wildcard of the given kind. */
  path: string[];
  upstream: UpstreamName;
  /**
   * Query parameters this route accepts. Anything else is dropped rather than
   * forwarded, because a parameter the client never sends is one the service was
   * not written against.
   */
  query?: readonly string[];
};

/**
 * The allow-list, transcribed from `src/lib/identity.ts` and `src/lib/billing.ts`.
 *
 * Read those two files to see the twenty-two operations this covers, and read
 * `upstream.test.ts`'s "the table and the clients agree" to see the check that
 * keeps the transcription honest — it calls every method on both clients and
 * asks this table about each URL, so a route added to a client and not to this
 * table is a red suite rather than a 404 nobody sees.
 *
 * The eight routes identity serves that are deliberately absent:
 * `/v1/introspections`, `/v1/session/mfa`, `/v1/mfa` and its four children,
 * `/v1/accounts/{id}/api-keys` and its delete, `/v1/accounts/{id}/oidc-clients`,
 * `/v1/email-changes` and its two children, and `/v1/probe/{accountID}`. None is
 * in `src/lib/identity.ts`. The MFA routes in particular would be a real
 * capability change: reaching them from a browser turns a second factor into a
 * thing this origin can drive.
 */
const ROUTES: readonly Route[] = [
  // --- identity: the four session and user routes -------------------------
  { method: "POST", path: ["users"], upstream: "identity" },
  { method: "POST", path: ["session"], upstream: "identity" },
  { method: "DELETE", path: ["session"], upstream: "identity" },
  { method: "GET", path: ["me"], upstream: "identity" },

  // --- identity: the tenancy surface --------------------------------------
  { method: "GET", path: ["accounts"], upstream: "identity" },
  { method: "POST", path: ["accounts"], upstream: "identity" },
  { method: "GET", path: ["accounts", ":accountId"], upstream: "identity" },
  { method: "PATCH", path: ["accounts", ":accountId"], upstream: "identity" },
  { method: "DELETE", path: ["accounts", ":accountId"], upstream: "identity" },
  { method: "GET", path: ["accounts", ":accountId", "members"], upstream: "identity" },
  {
    method: "POST",
    path: ["accounts", ":accountId", "invitations"],
    upstream: "identity",
  },
  {
    method: "PATCH",
    path: ["accounts", ":accountId", "members", ":userId"],
    upstream: "identity",
  },
  {
    method: "DELETE",
    path: ["accounts", ":accountId", "members", ":userId"],
    upstream: "identity",
  },
  { method: "POST", path: ["invitations", "accept"], upstream: "identity" },

  // --- identity: recovery and verification --------------------------------
  { method: "POST", path: ["password-resets"], upstream: "identity" },
  { method: "POST", path: ["password-resets", "confirm"], upstream: "identity" },
  { method: "POST", path: ["email-verifications"], upstream: "identity" },
  { method: "POST", path: ["email-verifications", "confirm"], upstream: "identity" },
  { method: "GET", path: ["email-verification"], upstream: "identity" },

  // --- billing ------------------------------------------------------------
  { method: "GET", path: ["plans"], upstream: "billing", query: ["cursor", "limit", "order"] },
  { method: "GET", path: ["plans", ":slug"], upstream: "billing" },
  { method: "GET", path: ["customers"], upstream: "billing", query: ["cursor", "limit"] },
  { method: "POST", path: ["customers"], upstream: "billing" },
  { method: "GET", path: ["customers", ":id"], upstream: "billing" },
];

/** What kind of wildcard a `:name` in a route path is. */
const SEGMENT_KINDS: Record<string, SegmentKind> = {
  accountId: "uuid",
  userId: "uuid",
  id: "uuid",
  slug: "slug",
};

/**
 * The shapes a wildcard segment may take.
 *
 * A uuid is matched in full rather than as "some characters": an allow list of
 * permitted bytes is the only version of this that cannot be walked out of, and
 * a uuid is short enough that the cost of being exact is nil.
 *
 * The token shape is base64url plus a hyphen or an underscore. The recovery and
 * invitation tokens are opaque values minted by another service, so the exact
 * alphabet is that service's to declare and not this file's to narrow — but the
 * negative case still holds, which is what matters: no `/`, no `.`, no `?`, no
 * `#`, no `%` and no control character can appear, so a token segment cannot
 * introduce a new path segment, a traversal, or a query of its own.
 */
const SEGMENT_PATTERNS: Record<SegmentKind, RegExp> = {
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  token: /^[A-Za-z0-9_-]{1,256}$/,
};

export type UpstreamForwarder = (
  request: Request,
  segments: string[],
) => Promise<Response>;

export type UpstreamOptions = {
  /** Where identity runs. Read on the server, from the environment. */
  identityUrl: string;
  /** Where billing runs. Same. */
  billingUrl: string;
  /** The seam. Tests pass a recorder; the route handler passes nothing. */
  fetchImpl?: typeof fetch;
};

/**
 * Builds the forwarder.
 *
 * The two addresses are taken once, here, and every hop is built from them. That
 * is the whole of property 1: there is no second reading of "where does this go"
 * anywhere in this file, so there is nothing for a caller to influence.
 */
export function createUpstreamForwarder(options: UpstreamOptions): UpstreamForwarder {
  const bases: Record<UpstreamName, string> = {
    identity: stripTrailingSlash(options.identityUrl),
    billing: stripTrailingSlash(options.billingUrl),
  };
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function forward(request: Request, segments: string[]): Promise<Response> {
    const method = request.method.toUpperCase();

    // No route of this shape at all: 404, and no address is contacted. Which is
    // the difference between a forwarder and an open proxy, and it is why the
    // eight unlisted identity routes are refused here rather than upstream.
    if (!ROUTES.some((route) => matchesShape(route.path, segments))) {
      return problem(404, "not_found", "No such route.");
    }

    // The shape exists but not under this method: 405, with the methods that
    // would have worked, so a client can tell a wrong verb from a wrong path.
    //
    // TWO LOOKUPS, and the second is not redundant. `POST /v1/session` and
    // `DELETE /v1/session` are ONE shape under two methods, so finding "the
    // route for this shape" and then checking its method answers 405 to a
    // sign-out — and a sign-out that answers 405 leaves the session alive.
    //
    // The `Allow` header names routes this app serves, which is not a
    // disclosure: every one of them is in the client bundle.
    const match = ROUTES.find(
      (route) => route.method === method && matchesShape(route.path, segments),
    );
    if (!match) {
      return problem(405, "method_not_allowed", "Method not allowed.", {
        headers: { allow: allowedMethods(segments).join(", ") },
      });
    }

    const url = buildUrl(bases[match.upstream], match, segments, request.url);

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }

    // A GET and a DELETE carry no body in this app, and reading one anyway would
    // make a caller choose how much memory this process spends before the route
    // table is even consulted.
    let body: string | undefined;
    if (method !== "GET" && method !== "DELETE") {
      const read = await readBoundedBody(request);
      if (read.tooLarge) return problem(413, "payload_too_large", "The request body is too large.");
      body = read.text;
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(url, {
        method,
        headers,
        body,
        // identity's own errors are its own: a 401 stays a 401 so the sign-in
        // form can say "those are wrong" rather than "we could not find out".
        redirect: "manual",
      });
    } catch {
      // Property 3. The catch is deliberately empty of the error: a fetch failure
      // message is `connect ECONNREFUSED 10.0.3.7:8080`, which is the internal
      // topology of a fleet, and it reaches whoever asked next.
      return problem(502, "upstream_unavailable", "The service is not reachable.");
    }

    return relay(upstream);
  };
}

/**
 * True when `segments` has the shape `shape` describes.
 *
 * The wildcard branch is the load-bearing one and it is deliberately stricter
 * than "this position is a wildcard". The router has already percent-decoded
 * each segment by the time it arrives here, so `accounts/%2e%2e%2f%2e%2e` is one
 * segment reading `../../` — and a check that only counted positions would treat
 * it as an account id and splice it into the upstream URL. Matching the value
 * against the shape the route declares is what makes a traversal impossible
 * rather than filtered.
 */
function matchesShape(shape: string[], segments: string[]): boolean {
  if (shape.length !== segments.length) return false;
  return shape.every((part, index) => {
    if (!part.startsWith(":")) return part === segments[index];
    const kind = SEGMENT_KINDS[part.slice(1)];
    // A wildcard with no declared kind is a bug in the table above, and matching
    // nothing is the safe reading of one: an unrecognised shape is not a route.
    return kind !== undefined && SEGMENT_PATTERNS[kind].test(segments[index]);
  });
}

/**
 * The methods the table declares for this exact path shape, for `Allow`.
 *
 * Deliberately shape-based and not route-based: a caller that guessed one of the
 * paths learns the same thing a caller that guessed a valid one does, and the
 * list is the app's own client surface either way.
 */
function allowedMethods(segments: string[]): string[] {
  return ROUTES.filter((route) => matchesShape(route.path, segments)).map((route) => route.method);
}

/**
 * Reads the body once, and refuses it if it is over the ceiling.
 *
 * ONE read, and that is not an optimisation. `Request.text()` consumes the body,
 * so a version that measured the length and then read it again for the upstream
 * would forward an empty body on every POST — a 201 from `POST /v1/users` with
 * nothing in it, which is a contract violation the service answers to rather
 * than one anybody here would notice.
 *
 * `content-length` is refused before the read, so a caller that declares a
 * large body never gets it buffered at all. The ceiling on the text afterwards is
 * for the caller that declares nothing, or declares less than it sends.
 */
async function readBoundedBody(request: Request): Promise<{ text: string; tooLarge: boolean }> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_REQUEST_BODY_BYTES) {
    return { text: "", tooLarge: true };
  }
  const text = await request.text();
  return { text, tooLarge: text.length > MAX_REQUEST_BODY_BYTES };
}

/**
 * Builds the upstream URL, and rebuilds the PATH from the table.
 *
 * This is property 2's mechanism. Nothing here concatenates a caller's bytes
 * into a URL: the shape came from `ROUTES`, the wildcards are re-encoded from
 * segments that have already been checked against `SEGMENT_PATTERNS`, and the
 * only caller-controlled text that survives is a query parameter whose NAME is on
 * the route's list. A traversal, an absolute URL in a segment and a doubled
 * slash are not rejected by a filter here — they are not expressible.
 */
function buildUrl(
  base: string,
  route: Route,
  segments: string[],
  requestUrl: string,
): string {
  const path = route.path
    .map((part, index) => (part.startsWith(":") ? encodeURIComponent(segments[index]) : part))
    .join("/");

  const query = buildQuery(route, requestUrl);
  return `${base}/v1/${path}${query}`;
}

/**
 * The query string, filtered to the names the route declares.
 *
 * Order follows the route's declaration rather than the caller's, so two callers
 * asking the same question produce the same URL. A name that is not declared is
 * dropped rather than refused: the route exists, the extra parameter is noise,
 * and refusing would make a browser appending a cache-buster look like an
 * attack.
 */
function buildQuery(route: Route, requestUrl: string): string {
  if (!route.query) return "";
  const incoming = new URL(requestUrl).searchParams;
  const pairs: string[] = [];
  for (const name of route.query) {
    const value = incoming.get(name);
    if (value !== null) pairs.push(`${name}=${encodeURIComponent(value)}`);
  }
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/**
 * Hands the upstream's answer back, minus what must not cross.
 *
 * The status and the body go through untouched — that is property 4, and it is
 * the difference between a refused sign-in and a rendered one. `Set-Cookie` is
 * relayed through `getSetCookie()` so that two cookies stay two cookies; adding
 * `Cache-Control: no-store` is the one header ADDED rather than forwarded,
 * because a 200 carrying somebody's email and a `Set-Cookie`, held in any cache
 * between here and the browser, is a credential at rest.
 */
function relay(upstream: Response): Response {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * The forwarder's own answers, in the envelope the clients already parse.
 *
 * `application/problem+json` because that is what `core` requires of every
 * cafaye service and what `parseError` in both clients reads, so a 404 from the
 * allow-list arrives at a screen as an `IdentityError` or a `BillingError` with
 * the right status rather than as a parse failure. The `type` and the `title` are
 * fixed: neither names an upstream, and a title is a sentence for a person while
 * `detail` is occurrence-specific and never rendered.
 */
function problem(
  status: number,
  code: string,
  title: string,
  extra: { headers?: Record<string, string> } = {},
): Response {
  return Response.json(
    { type: `https://errors.cafaye.com/${code}`, title, status, code },
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "no-store",
        ...(extra.headers ?? {}),
      },
    },
  );
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
