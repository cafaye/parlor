/**
 * The same-origin forwarder: the server side of the BFF.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * A browser on a deployed `parlor` could not sign in, and the cause was not in
 * either repository's code:
 *
 *   * `parlor` called `identity` from the BROWSER, at a build-time-substituted
 *     address. The caller of identity was a person's browser, on the app's own
 *     origin. The variable was named `NEXT_PUBLIC_IDENTITY_URL` and the build
 *     that inlined it was `next build`, neither of which exists in this
 *     repository any more; the hazard did not go with them, and it has a name in
 *     this build too — a value read through `import.meta.env`, which Vite
 *     substitutes into client code for its `VITE_` prefix, plus anything an
 *     explicit `define` in the vite config names.
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
 *      Build-time substitution is what made the old arrangement a trap in the
 *      other direction: a value the browser can read is a value the browser can
 *      change. These two values are read in a server-only module and are not in
 *      the bundle at all — see `src/app/v1/[...path]/route.ts`, whose header says
 *      what this build's substitution mechanism is and proves it is unused
 *      (`grep -rn "import.meta.env" src/` is empty, and `vite.config.mts`
 *      declares neither a `define` nor a widened `envPrefix`).
 *
 *   2. FORWARD ONLY THE PATHS THAT ARE NEEDED, AND REJECT THE REST. The table
 *      below holds every operation `src/lib/identity.ts` and `src/lib/billing.ts`
 *      can perform and nothing else, so the identity routes in it are
 *      a transcription with a test that reads it back ("the table and the clients
 *      agree" in `upstream.test.ts`). Everything identity serves that is not
 *      there — token introspection, the MFA disable (`DELETE /v1/mfa`), API
 *      keys, OIDC clients, email changes, `/v1/probe/{id}` — is refused before
 *      an address is contacted. A route being reachable from the internet is a
 *      decision somebody makes, not a side effect of a client existing.
 *
 *      This paragraph used to carry counts ("thirty routes, twenty-two
 *      reachable, eight not") and they were wrong twice over: they did not match
 *      the table, and `identity/openapi/v1.yaml` describes no tenancy route at
 *      all, so there was never anything to check them against. A number that
 *      cannot be re-derived from a file is a number that rots, and this is the
 *      one place in the codebase that must not rot quietly.
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

/**
 * Telemetry, for the trace forward.
 *
 * Imported here and nowhere else in this file's module graph below, because the
 * forwarder is the only outbound HTTP hop this app makes and it is therefore the
 * only place a trace can be continued. `tracedFetch` is called with the forwarder's
 * own `fetchImpl`, so nothing about this file's security properties changes: the
 * destination, the path, the method, the header allow-lists and the redirect
 * handling are all decided above this call and none of them is visible to it.
 *
 * The dependency runs the other way too — `telemetry.ts` does not import this
 * file — so there is no cycle to reason about.
 */
import { BILLING_NOT_CONFIGURED_CODE } from "@/lib/billing";
import { tracedFetch } from "@/lib/telemetry.server";

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
 *
 * ---------------------------------------------------------------------------
 * `traceparent` CROSSES AND IS NOT ON THIS LIST, and that is not an exception
 * ---------------------------------------------------------------------------
 * `tracedFetch` adds it below, on the way out. It is the ONE header this file
 * puts on the wire that it did not receive, so it needs saying plainly why that
 * is different from a caller choosing what crosses:
 *
 *   * It is DERIVED, not received. A caller's `traceparent` is not on this list
 *     and does not cross — a caller cannot put its own span id on an upstream
 *     request, forge a parent, or splice itself into a trace it does not belong
 *     to. The value that crosses is this hop's own span id, minted here.
 *   * It carries no address, no credential and no caller text. It is 55 hex
 *     characters of this app's own doing, so there is nothing in it to smuggle
 *     and nothing in it to leak.
 *
 * A reader who finds `traceparent` on the wire and not on this list can now tell
 * which of the two it is by asking where the value came from, which is the
 * question the rest of this file is built on.
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
 * `retry-after` crosses for one route and one status: `POST /v1/session/mfa`
 * answers 423 when the second factor is locked after too many failures, and
 * the header carries the remaining window in whole seconds. Without it the
 * client sees a bare 423 and the login screen can only say "try again" — which
 * sends a person to retry forever against a lock that ignores them for fifteen
 * minutes. It is on the list rather than read upstream because the wait is a
 * fact about the ANSWER, not about the request, and the forwarder's rule is
 * that a header this file does not name cannot cross.
 *
 * `location` is NOT on this list, and its absence is a decision rather than an
 * oversight. `redirect: "manual"` further down already refuses to FOLLOW a
 * redirect, and this list refuses to hand one over: between them, a 302 from any
 * upstream reaches the browser as a 302 with nowhere to go. That is the honest
 * dead end for every route that has one, and a forwarder that relayed an
 * arbitrary upstream `Location` would be handing the browser a move to somewhere
 * this table never approved — with `__Host-session` riding it off-origin, which
 * is the hazard the omission exists for.
 *
 * THE ONE EXCEPTION IS DECLARED PER ROUTE, and never as a header on this list.
 * A route that means its 302 to be followed says so with `browserRedirect: true`
 * on its entry in `ROUTES`, and `relay` reads it from there. There is one:
 * `GET /v1/auth/oauth/{provider}`, whose answer is a redirect rather than a body.
 * Dropping its `Location` is the quietest possible way to break social login —
 * the hop still answers and the browser still gets a 302, and it follows a
 * `Location` that is not there, so a person presses "Continue with GitHub" and
 * lands on a blank page with no error anywhere.
 *
 * A DECLARED ROUTE IS THE OPPOSITE OF THE HAZARD, and the difference is where
 * the value comes from. The hazard was an UNDECLARED upstream redirect steering
 * the browser to an address the allow-list never approved. A declared route is
 * the service's own 302, on a path this file already names, and the destination
 * in it is a provider's public authorization endpoint rather than anything a
 * caller chose. Nothing rides off-origin with it either: the `__Host-oauth-state`
 * cookie is set by this app's own origin during the start leg, and a cookie is
 * origin-scoped, so the browser does not present it to the provider it is being
 * sent to.
 *
 * The sibling app at `../site` holds the same rule from the other side: its table
 * declares no route this way, and its suite asserts the consequence by name — "does
 * not follow a redirect, and does not hand its Location to the browser". One of
 * these two repositories is the template the other is built from, so what has to
 * agree is the MECHANISM (a per-route declaration, never an entry on the global
 * list) rather than which routes happen to carry it.
 *
 * Everything else is dropped. An upstream's `Server` or `X-Powered-By` names the
 * internal service and its version, and there is no client in this repository
 * that reads either.
 */
export const FORWARDED_RESPONSE_HEADERS = ["content-type", "x-trace-id", "retry-after"] as const;

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
type SegmentKind = "uuid" | "slug" | "token" | "provider";

/** A route in the table: a method, a path shape, and where it goes. */
export type Route = {
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
  /**
   * TRUE WHEN THIS ROUTE'S ANSWER IS A REDIRECT THE BROWSER IS MEANT TO FOLLOW.
   *
   * It is one flag for exactly one reason: `location` is not on the response
   * header allow-list, so a route whose success IS a redirect has to say that
   * here for `relay` to hand its `Location` over. There is currently one such
   * route — `GET /v1/auth/oauth/{provider}` — and the declaration is the whole
   * of the exception, so the set of routes that can send a browser off this
   * origin is readable in one place and is as small as the table allows.
   *
   * IT DOES NOT MEAN THE FORWARDER FOLLOWS ANYTHING. `redirect: "manual"` below
   * stays for every route including this one; what a declared route changes is
   * only who does the following. The browser does, from its own address bar,
   * having been handed a `Location` the service wrote.
   *
   * `true` and not a boolean on purpose. `browserRedirect: false` would be a
   * route declaring that it does not redirect, which is every other route, and a
   * table where "no" is spellable is a table where somebody eventually writes
   * the wrong one.
   */
  browserRedirect?: true;
};

/**
 * The allow-list, transcribed from `src/lib/identity.ts` and `src/lib/billing.ts`.
 *
 * Read those two files to see the operations this covers, and read
 * `upstream.test.ts`'s "the table and the clients agree" to see the check that
 * keeps the transcription honest — it calls every method on both clients and
 * asks this table about each URL, so a route added to a client and not to this
 * table is a red suite rather than a 404 nobody sees.
 *
 * EXPORTED, and the reason is the OpenAPI document. `openapi/v1.yaml` is a
 * transcription of this table — every path and method there is one entry here
 * — and `src/lib/openapi-document.test.ts` keeps the two in agreement in both
 * directions: a table entry with no operation in the document is a red suite,
 * and an operation in the document with no table entry is a red suite. A
 * document that can silently drift from this table is worse than none, because
 * it looks authoritative.
 *
 * The identity surfaces deliberately absent: `/v1/introspections`,
 * `DELETE /v1/mfa`, the disable, which is a destructive security action with
 * no screen behind it yet, `/v1/accounts/{id}/api-keys` and its delete,
 * `/v1/accounts/{id}/oidc-clients`, `/v1/email-changes` and its two children,
 * and `/v1/probe/{accountID}`. None is in `src/lib/identity.ts`.
 *
 * The social-login pair was on this list until the packet that added it: the
 * service had served it the whole time, and this app simply could not reach it,
 * which is a decision nobody took rather than one somebody made. It is here
 * because `src/lib/identity.ts` can perform both operations, which is the same
 * bar every other entry in this table answers to.
 *
 * The MFA MANAGEMENT routes crossed that same bar in the packet that added
 * them: the client can perform all four, and the settings section drives them.
 * The LOGIN challenge crossed it in the packet that finished the flow W31
 * opened: `POST /v1/session/mfa` redeems the `mfa_required` answer `POST
 * /v1/session` can give, the client can perform it, and the login screen
 * drives it. What did NOT cross, and still has not, is the disable —
 * `DELETE /v1/mfa` — which remains a destructive security action with no
 * screen behind it. See `REPORT-parlor-mfa-challenge-01.md`.
 */
export const ROUTES: readonly Route[] = [
  // --- identity: the session and user routes ------------------------------
  //
  // `PATCH /v1/me` sets or clears the caller's display name, and the two are
  // one request: an omitted `display_name` and an empty string decode the same
  // way upstream, so there is no "leave unchanged" to forward.
  //
  // The two sessions routes are a LIST and a per-row REVOKE, and they are
  // declared together because they are one surface: `GET /v1/sessions` answers
  // the caller's live sessions with never a token, and `DELETE
  // /v1/sessions/{session_id}` ends one. The revoke is refused with a single 404
  // for all four ways of not owning the id, which is the service's own
  // anti-probing stance and is not this file's to narrow or widen.
  { method: "POST", path: ["users"], upstream: "identity" },
  // `POST /v1/signup-timestamp` mints the signed pair the register screen
  // carries on `POST /v1/users`. Public and unauthenticated, exactly as
  // registration is: a browser arriving at the form holds nothing but the
  // address it was sent to. It takes no body and no credential, and it is in
  // the table for the same reason every other entry is — the client can
  // perform it (`mintSignupTimestamp` in `src/lib/identity.ts`) and the
  // register screen drives it.
  { method: "POST", path: ["signup-timestamp"], upstream: "identity" },
  { method: "POST", path: ["session"], upstream: "identity" },
  { method: "DELETE", path: ["session"], upstream: "identity" },
  { method: "GET", path: ["me"], upstream: "identity" },
  { method: "PATCH", path: ["me"], upstream: "identity" },
  // `DELETE /v1/me` ends the caller's account. It shares the `me` shape under a
  // third method, and the two-lookup rule in `forward` is what tells the three
  // apart — finding "the route for this shape" and then checking its method
  // would answer 405 to a deletion. The 204 carries no body and no
  // `Content-Type`; the 409 names the team accounts the caller solely owns.
  { method: "DELETE", path: ["me"], upstream: "identity" },
  { method: "GET", path: ["sessions"], upstream: "identity" },
  { method: "DELETE", path: ["sessions", ":sessionId"], upstream: "identity" },

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

  // --- identity: social login ----------------------------------------------
  //
  // THE ONLY TWO REDIRECT-FACING ROUTES IN THIS TABLE, and the only two whose
  // contract is about a BROWSER rather than about a caller: `/v1/auth/oauth/
  // {provider}` answers a 302 to a provider and `/v1/auth/oauth/{provider}/
  // callback` is where the provider sends the browser back. Everything else in
  // this file is same-origin XHR.
  //
  // They are declared together because they are one flow, and identity mounts
  // them as a pair or not at all — `registerSocialRoutes` returns before either
  // is registered when no provider is configured — so half of this exists
  // nowhere.
  //
  // `browserRedirect` is on the START LEG ONLY, and `relay` reads it from here to
  // decide whether to hand the `Location` over. The callback does not carry it,
  // and that asymmetry is the rule rather than an omission: the callback is where
  // the browser arrives AFTER the provider has already been visited, it answers
  // 200 with a body, and a `Location` on it would be an upstream move this table
  // never approved. The provider's trip to the callback is inside the `Location`
  // the start leg hands over, so the browser makes that hop by itself.
  //
  // The callback declares `code`, `state` and `error` because those are the three
  // parameters the document puts in the query string, in that order. It has to
  // declare all three and not just `state`: `code` is what the flow spends and
  // `error` is how a person who declined at the provider is told so rather than
  // being answered as an invalid request. A `query` list missing any one of them
  // does not fail loudly here — `buildQuery` drops what is not declared — it
  // drops the parameter and lets the service refuse the round trip, which is the
  // 400 that says "this social sign-in did not start in this browser".
  //
  // `redirect_uri` and `client_id` are deliberately NOT declared. Those are what
  // the PROVIDER sends to identity, this app is not the provider, and forwarding
  // a caller's `redirect_uri` is how an authorization code gets delivered to an
  // address the caller chose.
  {
    method: "GET",
    path: ["auth", "oauth", ":provider"],
    upstream: "identity",
    browserRedirect: true,
  },
  {
    method: "GET",
    path: ["auth", "oauth", ":provider", "callback"],
    upstream: "identity",
    query: ["code", "state", "error"],
  },

  // --- identity: recovery and verification --------------------------------
  { method: "POST", path: ["password-resets"], upstream: "identity" },
  { method: "POST", path: ["password-resets", "confirm"], upstream: "identity" },
  { method: "POST", path: ["email-verifications"], upstream: "identity" },
  { method: "POST", path: ["email-verifications", "confirm"], upstream: "identity" },
  { method: "GET", path: ["email-verification"], upstream: "identity" },

  // --- identity: the second-factor management surface ----------------------
  //
  // THE FOUR ROUTES THE SETTINGS SCREEN DRIVES, and the one MFA route that is
  // deliberately still absent: `DELETE /v1/mfa`, the disable. It is a
  // destructive security action — it revokes every session the account holds
  // — and it has no screen and no client method yet, so it stays refused
  // above. A route with no caller is a capability this app does not have, and
  // the allow-list is where that is enforced.
  //
  // The confirm route's `:enrollmentId` is value-matched as a uuid, because
  // the document declares it `format: uuid` and the handler's own note is
  // that another user's, an expired one's and an already-confirmed one's are
  // all 404 — so the id is not a way to learn which enrollments exist, and a
  // segment that is not a uuid is not one this app has ever held.
  { method: "GET", path: ["mfa"], upstream: "identity" },
  { method: "POST", path: ["mfa", "enrollments"], upstream: "identity" },
  {
    method: "POST",
    path: ["mfa", "enrollments", ":enrollmentId", "confirm"],
    upstream: "identity",
  },
  { method: "POST", path: ["mfa", "recovery-codes"], upstream: "identity" },
  // THE SECOND-FACTOR LOGIN CHALLENGE, which is not a management route and is
  // declared here for the same reason the four above are: the client can
  // perform it (`completeSecondFactor` in `src/lib/identity.ts`) and the login
  // screen drives it. It redeems the `mfa_required` answer `POST /v1/session`
  // gives — the only route in the service that turns a second factor into a
  // session — and until it was declared here, a user who turned on a second
  // factor was signing themselves out of their own account: the credentials
  // were accepted, the challenge was minted, and the leg that spends it was
  // refused before an address was contacted.
  //
  // It takes no token — the challenge in the body IS the credential — so it
  // answers the same bar the four management routes do (a caller this app has)
  // rather than the bar the anonymous recovery routes answer.
  { method: "POST", path: ["session", "mfa"], upstream: "identity" },

  // --- identity: the operator surface --------------------------------------
  //
  // THE FOUR HUMAN-SESSION SYSTEM-ADMIN ROUTES, and the reason they are here
  // rather than refused with the other unlisted identity routes. The client
  // can perform all four (`createOperatorClient` in `src/lib/operator.ts`)
  // and the `/admin` screen drives them — the same bar every entry in this
  // table answers to.
  //
  // These are the HUMAN-session routes. The machine-key disable/enable pair
  // stays refused above: no client here holds a machine key, and a route with
  // no caller is a capability this app does not have. `operator/me` is the
  // gate the screen and the header read; the search carries `query` and
  // `limit` because those are the two parameters the contract names, and an
  // undeclared parameter is dropped rather than forwarded.
  { method: "GET", path: ["operator", "me"], upstream: "identity" },
  {
    method: "GET",
    path: ["operator", "users"],
    upstream: "identity",
    query: ["query", "limit"],
  },
  { method: "POST", path: ["operator", "users", ":userId", "disable"], upstream: "identity" },
  { method: "POST", path: ["operator", "users", ":userId", "enable"], upstream: "identity" },

  // --- billing ------------------------------------------------------------
  { method: "GET", path: ["plans"], upstream: "billing", query: ["cursor", "limit", "order"] },
  { method: "GET", path: ["plans", ":slug"], upstream: "billing" },
  { method: "GET", path: ["customers"], upstream: "billing", query: ["cursor", "limit"] },
  { method: "POST", path: ["customers"], upstream: "billing" },
  { method: "GET", path: ["customers", ":id"], upstream: "billing" },
  { method: "GET", path: ["subscriptions"], upstream: "billing", query: ["cursor", "limit"] },
  { method: "POST", path: ["subscriptions"], upstream: "billing" },
  { method: "GET", path: ["subscriptions", ":id"], upstream: "billing" },
  { method: "POST", path: ["subscriptions", ":id", "cancel"], upstream: "billing" },
  { method: "POST", path: ["subscriptions", ":id", "change_plan"], upstream: "billing" },
  { method: "GET", path: ["subscriptions", ":id", "entitlements"], upstream: "billing" },
  { method: "GET", path: ["subscriptions", ":id", "upcoming_invoice"], upstream: "billing" },
  { method: "POST", path: ["subscriptions", ":id", "payment_method"], upstream: "billing" },
  { method: "POST", path: ["checkouts"], upstream: "billing" },
  { method: "GET", path: ["charges"], upstream: "billing", query: ["cursor", "limit"] },
];

/** What kind of wildcard a `:name` in a route path is. */
const SEGMENT_KINDS: Record<string, SegmentKind> = {
  accountId: "uuid",
  userId: "uuid",
  id: "uuid",
  sessionId: "uuid",
  enrollmentId: "uuid",
  slug: "slug",
  provider: "provider",
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
 *
 * The provider shape is the one wildcard in this file that is deliberately NOT
 * closed, and that is worth more than a paragraph: `google`, `github` and any
 * other name a deployment might add are all FORWARDED, and the only question
 * this file asks of the segment is whether it is a name at all.
 *
 * The closed reading is tempting and it is wrong here. The document says a
 * provider a deployment has no credentials for and a name that does not exist
 * are BOTH 404, "because telling them apart is a way to enumerate a
 * deployment's configuration" — and narrowing the segment to the document's
 * `[google, github]` would put a third answer in front of both of them: this
 * file's own 404, whose problem document reads differently from identity's. The
 * difference between "this app has never heard of that provider" and "identity
 * knows that name and has not configured it" is exactly the bit an attacker
 * enumerating a deployment's configuration wants, and a forwarder is the last
 * place to leak it. So the enumeration defence stays where the service put it:
 * one 404, from one service, for both cases.
 *
 * The shape is the slug's, so what it rules out is a traversal, a second path
 * segment, a percent sign, a space, an empty segment and an upper-case name —
 * which is what makes the segment safe to splice, not which providers exist. The
 * test "asks identity about a provider this app does not narrow to the document's
 * enum" is the one that holds this in place, and the one that would go red if
 * somebody helpfully closed it.
 */
const SEGMENT_PATTERNS: Record<SegmentKind, RegExp> = {
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  token: /^[A-Za-z0-9_-]{1,256}$/,
  provider: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
};

export type UpstreamForwarder = (
  request: Request,
  segments: string[],
) => Promise<Response>;

export type UpstreamOptions = {
  /** Where identity runs. Read on the server, from the environment. */
  identityUrl: string;
  /**
   * Where billing runs. Same — EXCEPT THAT EMPTY MEANS "NOT CONFIGURED", AND IS
   * NOT A DEFAULT-IN-WAITING. The launch stack deploys no billing, so an empty
   * `billingUrl` is a real deployment state rather than a misconfiguration, and
   * the forwarder answers a billing route with a distinct 503 (see `forward`
   * below) rather than dialing anything. A test that wants billing reachable
   * passes an address; a test that wants the launch stack passes "".
   */
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

    // BILLING IS OPTIONAL, AND AN UNCONFIGURED BILLING IS AN HONEST ANSWER
    // RATHER THAN A TRANSPORT ERROR. The launch stack deploys no billing, so
    // `BILLING_URL` may be empty; when it is, a billing route is answered here
    // with a 503 carrying a distinct code rather than a request to a default
    // address. The alternative — letting `buildUrl` splice an empty base into a
    // relative URL — is a fetch that throws and a 502 three layers from the
    // cause, which is the failure mode this packet exists to remove. The code
    // is `BILLING_NOT_CONFIGURED_CODE` from `src/lib/billing.ts`, so the screens
    // that branch on it and the forwarder that mints it agree on one spelling.
    if (match.upstream === "billing" && bases.billing === "") {
      return problem(503, BILLING_NOT_CONFIGURED_CODE, "Billing is not configured.");
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
      // `tracedFetch` rather than `fetchImpl` directly, and the ONLY difference
      // is what leaves this process: one CLIENT span, and a `traceparent` naming
      // this hop's server span so the upstream's own span continues the trace
      // instead of starting a second one. Everything below — the method, the
      // allow-listed headers, the body, `redirect: "manual"` — is unchanged, and
      // the seam is passed through so `upstream.test.ts`'s recorder still sees
      // every hop without a socket.
      //
      // A failure here marks the CLIENT span and rethrows; the `catch` below
      // still answers 502 with a fixed body, so a downstream that is down is an
      // error the trace can see and a response that still leaks nothing. The
      // SERVER span's own status is not touched by this: `traceRequest` files it
      // from the status this function returns, and a 502 IS this app's answer.
      upstream = await tracedFetch(url, undefined, {
        method,
        headers,
        body,
        // identity's own errors are its own: a 401 stays a 401 so the sign-in
        // form can say "those are wrong" rather than "we could not find out".
        //
        // AND THE SOCIAL START'S OWN 302 IS NOT FOLLOWED, which is the second
        // reason this line is here rather than left at the default. `GET
        // /v1/auth/oauth/{provider}` answers 302 to a provider's HTTPS endpoint;
        // at the default `redirect: "follow"` the transport would chase it,
        // hand identity's `__Host-oauth-state` cookie and the whole request to
        // github.com, and return github's HTML as this app's answer to a
        // sign-in. Measured on Node 22.22.2, that is exactly what happens.
        //
        // One honest caveat, because it is the kind of thing that breaks on an
        // upgrade rather than on an edit. `redirect: "manual"` is SPECIFIED to
        // yield an opaque redirect — status 0, no headers, `type: "opaqueredirect"`
        // — which would make `relay()` throw on `new Response(body, { status: 0 })`
        // and turn the start leg into a 500. undici does not implement that
        // clause: measured on 22.22.2 it returns a `type: "basic"` response with
        // status 302 and a readable `Location` and `Set-Cookie`, which is the
        // behaviour `relay()` needs and the whole reason the hop works. So this
        // file depends on a deviation of the runtime it ships on. If a future
        // runtime implements the spec faithfully, `redirect: "manual"` is the
        // first thing to look at, and the symptom to recognise is a 500 on the
        // social start with no `Location` anywhere in the logs.
        redirect: "manual",
      }, fetchImpl);
    } catch {
      // Property 3. The catch is deliberately empty of the error: a fetch failure
      // message is `connect ECONNREFUSED 10.0.3.7:8080`, which is the internal
      // topology of a fleet, and it reaches whoever asked next.
      return problem(502, "upstream_unavailable", "The service is not reachable.");
    }

    return relay(upstream, match);
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
 *
 * `Location` crosses only for a route that declared `browserRedirect`, and that
 * is the whole of the exception. Two things are deliberately NOT conditioned on
 * the status code, because both would be wrong in a way this file cannot repair:
 *
 *   * `Set-Cookie` is relayed on a 302 exactly as it is on a 200. The social start
 *     leg is a 302 AND it is the leg that sets `__Host-oauth-state`, so a relay
 *     that treated cookies as a success-response detail would hand the browser a
 *     redirect to a provider with no state cookie, and the callback would then
 *     refuse the round trip with a 400 that says the flow "did not start in this
 *     browser". It did. The cookie never arrived.
 *   * `Location` is relayed on whatever status the upstream wrote it with. The
 *     route declared that its answer is a redirect; the service decides whether
 *     that is a 302 or a 303, and second-guessing it here would be this file
 *     inventing a contract it is not the authority for.
 *
 * The route is passed in rather than looked up again because the caller has
 * already matched it, and matching twice would be a second reading of "which
 * route is this" — the thing property 1 is built on not having.
 */
function relay(upstream: Response, route: Route): Response {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (route.browserRedirect === true) {
    const location = upstream.headers.get("location");
    if (location !== null) headers.set("location", location);
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
    { type: `https://docs.cafaye.com/errors/${code}`, title, status, code },
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
