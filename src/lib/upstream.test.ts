/**
 * The tests for the same-origin forwarder, and the red proof that they can fail.
 *
 * The order in this file is the order the questions matter. The destination is
 * fixed first, because every other property is downstream of it: if a caller can
 * choose where a request goes, an allow-list of paths is a list of doors on a
 * building the caller also owns. Then the allow-list, then the cookie, then the
 * response.
 *
 * A NOTE ON WHAT IS BOMBED, because it is the reason this file can make claims
 * about sockets. `beforeEach` replaces the global `fetch` with a function that
 * throws. The forwarder takes its own `fetchImpl` parameter, so the bomb only
 * fires if some path reaches the network without the seam — which is the same
 * guard `identity.test.ts` uses, and for the same reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BILLING_NOT_CONFIGURED_CODE } from "./billing";
import {
  FORWARDED_RESPONSE_HEADERS,
  MAX_REQUEST_BODY_BYTES,
  createUpstreamForwarder,
  type UpstreamName,
} from "./upstream";

/**
 * One recorded hop: what the forwarder asked the network for.
 *
 * `url` is a string rather than a `URL` on purpose — the assertions read
 * `.toBe("http://identity.test/v1/session")`, and a `URL` would have to be
 * stringified by every one of them, which is the sort of incidental friction that
 * gets a test loosened.
 */
type Hop = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

const IDENTITY_URL = "http://identity.test";
const BILLING_URL = "http://billing.test";

/**
 * The URL out of whatever spelling of a request `fetch` was handed.
 *
 * `fetch` takes `string | URL | Request`, and the forwarder under test calls it
 * with a string, so the other two are not exercised here — but they are all
 * legitimate and a narrowing helper is wrong for two of them.
 *
 * `String(input)` is the obvious thing and it is wrong for one of the three: a
 * `Request` stringifies to `[object Request]`, which would put that in a `Hop`
 * and turn any assertion about a URL into one that passes for the wrong reason.
 * A `URL` is handled by its own case rather than by stringification for the
 * same reason — `String(new URL(href))` happens to be `href` today and is not a
 * contract.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Records every hop and answers with whatever the test queued. */
function recordingFetch(respond?: (hop: Hop) => Response) {
  const hops: Hop[] = [];
  // `RequestInfo | URL` rather than `string | URL`, because the seam is typed as
  // the platform's `fetch` and a narrower parameter type is not assignable to
  // it. Widening the parameter is what makes this a drop-in; the recorder only
  // ever reads `requestUrl(input)` below, which is correct for all three
  // spellings.
  //
  // NOT `async`, and the seam is typed as returning a promise — so this returns
  // one explicitly. `async` was contributing nothing but the wrapper, and
  // `@typescript-eslint/require-await` is right that there is no `await` in it.
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    // `init.headers` is a `Headers` instance and spreading one yields `{}` — a
    // spread reads own enumerable properties and a Headers keeps its map
    // internal. Reading it through `entries()` is the only way to see what would
    // actually cross the wire, and asserting on `{}` is how a header allow-list
    // test passes without testing anything.
    const sent = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    for (const [name, value] of sent) headers[name] = value;

    const hop: Hop = {
      url: requestUrl(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    };
    hops.push(hop);
    return Promise.resolve(respond ? respond(hop) : new Response("{}", { status: 200 }));
  });
  return { fetchImpl, hops };
}

function forwarder(respond?: (hop: Hop) => Response) {
  const { fetchImpl, hops } = recordingFetch(respond);
  return {
    hops,
    fetchImpl,
    forward: createUpstreamForwarder({
      identityUrl: IDENTITY_URL,
      billingUrl: BILLING_URL,
      fetchImpl,
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("real fetch() reached a test — the forwarder was not given a seam");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. The destination is not the caller's to choose.
//
// This is the whole security argument of the packet in four questions, and each
// one is a way a forwarder becomes an open proxy. They are written as attacks a
// person would actually send, not as abstractions.
// ---------------------------------------------------------------------------

describe("the destination is fixed", () => {
  it("ignores a Host header naming another origin", async () => {
    const { forward, hops } = forwarder();

    await forward(
      new Request("https://parlor.test/v1/session", {
        method: "POST",
        headers: { Host: "evil.example", "Content-Type": "application/json" },
        body: "{}",
      }),
      ["session"],
    );

    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/session`);
  });

  it("ignores a X-Forwarded-Host naming another origin", async () => {
    const { forward, hops } = forwarder();

    await forward(
      new Request("https://parlor.test/v1/me", {
        headers: { "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http" },
      }),
      ["me"],
    );

    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/me`);
  });

  it("ignores a query parameter asking for another origin", async () => {
    const { forward, hops } = forwarder();

    await forward(new Request("https://parlor.test/v1/me?url=http%3A%2F%2Fevil.example%2Fsteal"), [
      "me",
    ]);

    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/me`);
  });

  it("ignores a path segment that is itself an absolute URL", async () => {
    // `//evil.example/v1/me` parses as a protocol-relative URL, so a forwarder
    // that builds its URL with `new URL(segment, base)` sends the request to
    // evil.example and the allow-list never sees it. This is the single most
    // common way a path-joining forwarder becomes an open proxy.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/me"), [
      "//evil.example",
      "me",
    ]);

    expect(hops).toHaveLength(0);
    expect(response.status).toBe(404);
  });

  it("refuses a path segment that is not the shape the route declares", async () => {
    // A traversal is not a path the table has, so it is refused before any
    // address is contacted. `%2e%2e%2f` decodes to `../` — one segment, because
    // the router already decoded it, which is why the segment is validated
    // rather than the whole string being pattern-matched.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/accounts/x"), [
      "accounts",
      "../../admin",
    ]);

    expect(hops).toHaveLength(0);
    expect(response.status).toBe(404);
  });

  it("refuses an account id that is not a uuid", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/accounts/x"), [
      "accounts",
      "not-a-uuid",
    ]);

    expect(hops).toHaveLength(0);
    expect(response.status).toBe(404);
  });

  // The three shapes a "count the positions" implementation would wave through,
  // because each has the right NUMBER of segments and a plausible-looking first
  // one. Written as attacks rather than as a table because the reason each is
  // refused differs: one is a length, one is a value the pattern excludes, and
  // one is a value the pattern excludes for a reason that is not obvious.
  it("refuses an empty segment where a uuid belongs", async () => {
    // `["accounts", ""]` has the right length. A check that only counted
    // positions would splice an empty string into the upstream URL and produce
    // `…/v1/accounts/` — which is a route, and not the one that was asked for.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/accounts/x"), [
      "accounts",
      "",
    ]);

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("refuses a NUL byte in a segment", async () => {
    // Worth its own case because the failure it prevents is not a 404: a NUL in
    // a path is how a value that is meant to be a path segment becomes
    // something a C library, a log line or a shell downstream reads as a
    // terminator. The uuid pattern excludes it, and this is the assertion that
    // the exclusion is load-bearing rather than incidental.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/accounts/x"), [
      "accounts",
      // A real NUL, written as an escape so the file stays greppable and a
      // stray control byte cannot be mistaken for a formatting accident.
      "a\u0000b",
    ]);

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("refuses a longer path than any route declares, without contacting upstream", async () => {
    // `/v1/accounts/{id}/` — a trailing slash is a different path to the router
    // and a *prefix* to a naive prefix matcher. Length equality is what refuses
    // it, and a prefix matcher is the mistake a rewrite would have made.
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/accounts/x/"),
      ["accounts", "8f2c1a44-0000-4000-8000-000000000001", ""],
    );

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The allow-list. Only what the two clients call, and nothing else.
//
// The set is transcribed from `src/lib/identity.ts` and `src/lib/billing.ts`, so
// a test that asserts "the table and the clients agree" is a cross-file check
// this repository can actually make. See `forwards exactly what the clients call`
// at the bottom of this file.
// ---------------------------------------------------------------------------

describe("the allow-list", () => {
  it("forwards a listed identity route", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/me"), ["me"]);

    expect(response.status).toBe(200);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/me`);
    expect(hops[0].method).toBe("GET");
  });

  it("forwards the display-name patch on the same path", async () => {
    // `PATCH /v1/me` shares its shape with `GET /v1/me` under a second method,
    // and the two-lookup rule in `forward` is what tells them apart: finding
    // "the route for this shape" and then checking its method would answer 405
    // to a rename.
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: "Kaka" }),
      }),
      ["me"],
    );

    expect(response.status).toBe(200);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/me`);
    expect(hops[0].method).toBe("PATCH");
  });

  it("forwards the session list", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/sessions"), ["sessions"]);

    expect(response.status).toBe(200);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/sessions`);
    expect(hops[0].method).toBe("GET");
  });

  it("forwards a session revoke, with the session id value-matched", async () => {
    // The `:sessionId` segment is a uuid like every other id in this table, so
    // a revoke of a session id this service did not issue is refused HERE rather
    // than upstream — the same traversal-impossibility property the account
    // routes have.
    const { forward, hops } = forwarder();
    const sessionId = "8f2c1a44-0000-4000-8000-000000000001";

    const response = await forward(
      new Request(`https://parlor.test/v1/sessions/${sessionId}`, { method: "DELETE" }),
      ["sessions", sessionId],
    );

    expect(response.status).toBe(200);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/sessions/${sessionId}`);
    expect(hops[0].method).toBe("DELETE");
  });

  it("refuses a revoke under a session id that is not a uuid", async () => {
    // The value match, not the shape length: two segments reach the wildcard
    // check, and a segment that is not a uuid is not a session this app has
    // ever held. The same property every `:accountId` route has.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/sessions/not-a-uuid"), [
      "sessions",
      "not-a-uuid",
    ]);

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("forwards the account deletion on the same path under a third method", async () => {
    // `DELETE /v1/me` shares the `me` shape with `GET` and `PATCH`, and the
    // two-lookup rule in `forward` is what tells the three apart — finding "the
    // route for this shape" and then checking its method would answer 405 to a
    // deletion.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/me", { method: "DELETE" }), [
      "me",
    ]);

    expect(response.status).toBe(200);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/me`);
    expect(hops[0].method).toBe("DELETE");
  });

  it("forwards the four MFA management routes the settings screen drives", async () => {
    // All four are in `src/lib/identity.ts` and the settings section calls
    // them, which is the bar every other entry in the table answers to. The
    // confirm route's `:enrollmentId` is value-matched as a uuid because the
    // document declares it one — a segment that is not a uuid is not an
    // enrollment this app has ever held.
    const enrollmentId = "8f2c1a44-0000-4000-8000-000000000001";
    const routes = [
      { segments: ["mfa"], method: "GET" },
      { segments: ["mfa", "enrollments"], method: "POST" },
      { segments: ["mfa", "enrollments", enrollmentId, "confirm"], method: "POST" },
      { segments: ["mfa", "recovery-codes"], method: "POST" },
    ];

    for (const route of routes) {
      const { forward, hops } = forwarder();
      const response = await forward(
        new Request(`https://parlor.test/${route.segments.join("/")}`, {
          method: route.method,
          headers: { Authorization: "Bearer t" },
          body: route.method === "GET" ? undefined : "{}",
        }),
        route.segments,
      );

      expect(response.status, `${route.method} /${route.segments.join("/")}`).toBe(200);
      expect(hops, `${route.method} /${route.segments.join("/")}`).toHaveLength(1);
      // The forwarder rebuilds the upstream path from the route table, so the
      // `/v1` the segments sit under is part of every hop URL.
      expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/${route.segments.join("/")}`);
    }
  });

  it("forwards the second-factor login challenge", async () => {
    // The leg that finishes a sign-in for an account with a confirmed second
    // factor. It is in the table for the same reason the four management
    // routes are: the client can perform it and the login screen drives it.
    // Until it was declared, a user who turned on a second factor was signing
    // themselves out of their own account — the credentials were accepted, the
    // challenge was minted, and the leg that spends it was refused before an
    // address was contacted.
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/session/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: "ch_1", code: "482913" }),
      }),
      ["session", "mfa"],
    );

    expect(response.status).toBe(200);
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/session/mfa`);
    expect(hops[0].method).toBe("POST");
  });

  it("forwards the signup timestamp mint", async () => {
    // The mint the register screen carries: `POST /v1/signup-timestamp` is
    // public and unauthenticated exactly as `POST /v1/users` is, and until it
    // was declared here a registration could mint no pair — so identity
    // refused every submission with a 422 and the screen could only say
    // something went wrong.
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/signup-timestamp", {
      method: "POST",
    }), ["signup-timestamp"]);

    expect(response.status).toBe(200);
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/signup-timestamp`);
    expect(hops[0].method).toBe("POST");
  });

  it("hands the lockout window back to the browser on a 423", async () => {
    // The 423's `Retry-After` is the one fact a person needs from a locked
    // second factor — the wait, not a bare "try again" — so it crosses back
    // like `Set-Cookie` and `X-Trace-Id` do. Without it the client sees a bare
    // 423 and the login screen can only say "try again", which sends a person
    // to retry forever against a lock that ignores them for fifteen minutes.
    const { forward } = forwarder(
      () =>
        new Response(
          JSON.stringify({
            type: "https://errors.cafaye.com/account_locked",
            title: "Locked",
            status: 423,
            code: "account_locked",
          }),
          {
            status: 423,
            headers: { "Content-Type": "application/problem+json", "Retry-After": "900" },
          },
        ),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/session/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: "ch_1", code: "000000" }),
      }),
      ["session", "mfa"],
    );

    expect(response.status).toBe(423);
    expect(response.headers.get("retry-after")).toBe("900");
  });

  it("refuses an enrollment id that is not a uuid", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/mfa/enrollments/not-a-uuid/confirm", {
        method: "POST",
        headers: { Authorization: "Bearer t" },
        body: "{}",
      }),
      ["mfa", "enrollments", "not-a-uuid", "confirm"],
    );

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("refuses a route identity serves but this app never calls", async () => {
    // identity serves /v1/introspections, DELETE /v1/mfa,
    // /v1/accounts/{id}/api-keys, /v1/accounts/{id}/oidc-clients,
    // /v1/email-changes/* and /v1/probe/{id}. Not one of them is in
    // `src/lib/identity.ts`, and the point of the allow-list is that a route
    // being reachable from the internet is a decision somebody makes rather than
    // a side effect of a client existing.
    //
    // The four MFA MANAGEMENT routes are no longer on this list — the client
    // can perform all four and the settings screen drives them — and neither is
    // the LOGIN challenge (`POST /v1/session/mfa`), which the packet that
    // finished the second-factor flow un-refused: the client can perform it
    // and the login screen drives it. What remains is the one route that is
    // still a decision: the disable (`DELETE /v1/mfa`), a destructive security
    // action with no screen behind it yet.
    //
    // The expected status is per route rather than a constant, because the two
    // kinds of refusal are different answers: `DELETE /v1/mfa` is a 405 — the
    // shape exists under GET, so the forwarder says "this route, not this
    // method" — while the rest are 404s, shapes no route declares. Both refuse
    // the hop; only the reason differs.
    const refused = [
      { segments: ["introspections"], method: "POST", status: 404 },
      { segments: ["mfa"], method: "DELETE", status: 405 },
      { segments: ["email-changes", "current-address"], method: "POST", status: 404 },
      { segments: ["probe", "8f2c1a44-0000-4000-8000-000000000000"], method: "GET", status: 404 },
    ];

    for (const route of refused) {
      const { forward, hops } = forwarder();
      const response = await forward(
        new Request(`https://parlor.test/${route.segments.join("/")}`, { method: route.method }),
        route.segments,
      );

      expect(response.status, `${route.method} /${route.segments.join("/")}`).toBe(route.status);
      expect(hops, `${route.method} /${route.segments.join("/")}`).toHaveLength(0);
    }
  });

  it("refuses an api key under an account, which is an account route with a suffix", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/accounts/x/api-keys"), [
      "accounts",
      "8f2c1a44-0000-4000-8000-000000000000",
      "api-keys",
    ]);

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("refuses a method the route does not declare", async () => {
    const { forward, hops } = forwarder();

    // `GET /v1/session` is not a route. Identity answers 405 for it, and so
    // does the forwarder — but without a request leaving this process, which is
    // the difference between a refused method and a proxied one.
    const response = await forward(new Request("https://parlor.test/v1/session"), ["session"]);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    expect(hops).toHaveLength(0);
  });

  it("refuses a method on a route that has a wildcard segment", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/plans/pro", { method: "PUT" }),
      ["plans", "pro"],
    );

    expect(response.status).toBe(405);
    expect(hops).toHaveLength(0);
  });

  it("routes a billing path to billing and an identity path to identity", async () => {
    // Both services live under /v1, so the table is the only thing that knows
    // which upstream a path belongs to. A collision here would be a silent
    // credential leak: an identity session token reaching a service that
    // declares `security: []`.
    const { forward, hops } = forwarder();

    await forward(new Request("https://parlor.test/v1/plans"), ["plans"]);
    await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    expect(hops.map((hop) => hop.url)).toEqual([
      `${BILLING_URL}/v1/plans`,
      `${IDENTITY_URL}/v1/session`,
    ]);
    // And the bodies survived the hop, which is the half of it that a transport
    // bug would break silently.
    expect(hops[1].body).toBe("{}");
  });

  it("does not send an identity session token to billing", async () => {
    // The claim in `src/lib/billing.ts` is that no identity credential is ever
    // handed to billing. With a forwarder in the path that claim is only true if
    // the forwarder does not add one — so this asserts on the hop, not on the
    // comment.
    const { forward, hops } = forwarder();

    await forward(new Request("https://parlor.test/v1/customers", {
      headers: { Authorization: "Bearer a-session-token" },
    }), ["customers"]);

    expect(hops[0].headers.authorization).toBe("Bearer a-session-token");
    // Billing's own client sends no credential, and the forwarder invents none.
    const billingHop = hops[0];
    expect(billingHop.url.startsWith(BILLING_URL)).toBe(true);
  });

  it("drops a query parameter the route does not declare", async () => {
    // A query the client never sends is a parameter the service was not written
    // against. Forwarding it is how a smuggle gets in through a door that is
    // otherwise allow-listed.
    const { forward, hops } = forwarder();

    await forward(new Request("https://parlor.test/v1/me?callback=http://evil.example"), ["me"]);

    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/me`);
  });

  it("forwards the three query parameters billing's client actually sends", async () => {
    const { forward, hops } = forwarder();

    await forward(new Request("https://parlor.test/v1/plans?limit=2&order=desc&cursor=abc"), [
      "plans",
    ]);

    // In the route's declaration order, not the caller's, so two callers asking
    // the same question produce the same URL.
    expect(hops[0].url).toBe(`${BILLING_URL}/v1/plans?cursor=abc&limit=2&order=desc`);
  });

  it("answers a billing route with a distinct 503 when billing is not configured, and dials nothing", async () => {
    // The launch stack deploys no billing, so an empty `billingUrl` is a real
    // deployment state rather than a misconfiguration. The forwarder must not
    // dial a default: `DEFAULT_BILLING_URL` used to be `localhost:3000`, which
    // inside a container is parlor's own port, and a request to it is a request
    // to parlor — a 502 three layers from the cause and nothing naming the
    // variable. So the answer is minted here, and the hop list stays empty.
    const { fetchImpl, hops } = recordingFetch();
    const forward = createUpstreamForwarder({
      identityUrl: IDENTITY_URL,
      billingUrl: "",
      fetchImpl,
    });

    const response = await forward(new Request("https://parlor.test/v1/plans"), ["plans"]);

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    const body = (await response.json()) as { code?: unknown };
    expect(body.code).toBe(BILLING_NOT_CONFIGURED_CODE);
    // The whole point: nothing was dialed. A hop here is the old bug.
    expect(hops).toHaveLength(0);
  });

  it("still forwards an identity route when billing is not configured", async () => {
    // The control for the test above: an unconfigured billing must not take
    // identity down with it. The launch stack's entire reason to exist is a
    // sign-in, and `/v1/session` is the route that serves it.
    const { fetchImpl, hops } = recordingFetch();
    const forward = createUpstreamForwarder({
      identityUrl: IDENTITY_URL,
      billingUrl: "",
      fetchImpl,
    });

    const response = await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    expect(response.status).toBe(200);
    expect(hops.map((hop) => hop.url)).toEqual([`${IDENTITY_URL}/v1/session`]);
  });
});

// ---------------------------------------------------------------------------
// 3. The cookie. This is the part that only starts working because the traffic
//    is same-origin, and the part whose attributes are load-bearing in a way
//    they were not before.
// ---------------------------------------------------------------------------

describe("the session cookie", () => {
  it("hands identity's Set-Cookie to the browser with its attributes untouched", async () => {
    // `__Host-` is a contract the BROWSER enforces: Secure, Path=/, and no
    // Domain. Rewriting any of those three either breaks the cookie or, worse,
    // turns a host-only cookie into one a sibling subdomain can set. So the
    // header is forwarded byte for byte and the test reads the bytes.
    const { forward } = forwarder(
      () =>
        new Response(JSON.stringify({ token: "t", expires_at: "2030-01-01T00:00:00Z" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie":
              "__Host-session=t; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
          },
        }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("__Host-session=t");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // The attribute a forwarder adds to make a cookie "work" and which makes the
    // browser reject the whole thing.
    expect(cookie).not.toContain("Domain=");
  });

  it("forwards every Set-Cookie, so a second cookie is not collapsed into the first", async () => {
    // `headers.get("set-cookie")` on a folded header returns the values joined
    // with ", ", which lands in one cookie's Expires and destroys both. The
    // 202 MFA branch sets a challenge cookie and is the case that proves this.
    const { forward } = forwarder(
      () =>
        new Response("{}", {
          status: 202,
          headers: [
            ["Set-Cookie", "__Host-mfa-challenge=c1; Path=/; Secure; HttpOnly"],
            ["Set-Cookie", "__Host-session=t; Path=/; Secure; HttpOnly"],
          ],
        }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-mfa-challenge=c1");
    expect(cookies[1]).toContain("__Host-session=t");
  });

  it("forwards the browser's cookie to identity", async () => {
    const { forward, hops } = forwarder();

    await forward(
      new Request("https://parlor.test/v1/me", {
        headers: { Cookie: "__Host-session=t" },
      }),
      ["me"],
    );

    expect(hops[0].headers.cookie).toBe("__Host-session=t");
  });

  it("marks a proxied response no-store, so a session is not cached by anything in between", async () => {
    // A 200 carrying somebody's email and a Set-Cookie, held in a shared cache or
    // a disk cache, is a credential at rest. This is the one response header the
    // forwarder ADDS rather than forwards.
    const { forward } = forwarder(
      () =>
        new Response(JSON.stringify({ id: "u1", email: "kaka@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Set-Cookie": "__Host-session=t; Path=/" },
        }),
    );

    const response = await forward(new Request("https://parlor.test/v1/me"), ["me"]);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("never answers with a CORS header, which is what makes this not a CORS bypass", async () => {
    // The packet's forbidden shortcut was permissive CORS on identity. This is
    // the assertion that the same hole was not opened from this side instead: the
    // forwarder is same-origin by construction, so it emits no
    // `Access-Control-Allow-*` at all — not even echoing the caller's Origin.
    const { forward } = forwarder(
      () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/me", { headers: { Origin: "https://evil.example" } }),
      ["me"],
    );

    for (const [name] of response.headers) {
      expect(name.toLowerCase().startsWith("access-control-")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The response. An upstream failure must stay a failure.
// ---------------------------------------------------------------------------

describe("upstream failures", () => {
  it("passes a 401 through with its body, so a refused sign-in is not a 200", async () => {
    // The client parses problem+json and the login form branches on the status.
    // A forwarder that collapsed this into a generic 200 would render a wrong
    // password as a success.
    const { forward } = forwarder(
      () =>
        new Response(JSON.stringify({ title: "Unauthorized", status: 401, code: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/problem+json", "X-Trace-Id": "trace_1" },
        }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
    expect(response.headers.get("x-trace-id")).toBe("trace_1");
  });

  it("passes a 422 through with its field errors", async () => {
    const { forward } = forwarder(
      () =>
        new Response(
          JSON.stringify({
            title: "Unprocessable",
            status: 422,
            code: "validation_failed",
            errors: [{ field: "email", code: "invalid_format" }],
          }),
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
    );

    const response = await forward(new Request("https://parlor.test/v1/users", {
      method: "POST",
      body: JSON.stringify({ email: "nope", password: "short" }),
    }), ["users"]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      errors: [{ field: "email", code: "invalid_format" }],
    });
  });

  it("answers 502 when the upstream cannot be reached, without naming the upstream", async () => {
    // The two halves are one property. A 200 here would let a sign-in form render
    // "Something went wrong" against a success, and the address in the body is
    // the internal name of a service that is not published anywhere.
    const { fetchImpl } = recordingFetch(() => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.3.7:8080");
    });
    const forward = createUpstreamForwarder({
      identityUrl: IDENTITY_URL,
      billingUrl: BILLING_URL,
      fetchImpl,
    });

    const response = await forward(new Request("https://parlor.test/v1/me"), ["me"]);

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain("10.0.3.7");
    expect(body).not.toContain(IDENTITY_URL);
    expect(body).not.toContain("ECONNREFUSED");
  });

  it("refuses a body over the ceiling rather than buffering it", async () => {
    // identity bounds its own bodies at 4 KiB. A forwarder that reads the body
    // first and then complains is a memory ceiling one layer too high, because
    // the read already happened.
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/session", {
        method: "POST",
        body: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
      }),
      ["session"],
    );

    expect(response.status).toBe(413);
    expect(hops).toHaveLength(0);
  });

  it("only ever forwards the headers on the list", async () => {
    // A header the forwarder does not name cannot be a smuggling channel. This
    // asserts the complement of the allow-list, because a leak is invisible
    // unless you look for it.
    const { forward, hops } = forwarder();

    await forward(
      new Request("https://parlor.test/v1/me", {
        headers: {
          Authorization: "Bearer t",
          "X-Trace-Id": "trace_1",
          "X-Smuggled": "yes",
          "X-Forwarded-For": "1.2.3.4",
        },
      }),
      ["me"],
    );

    // Lower-case keys, because that is what a `Headers` iterates as. HTTP header
    // names are case-insensitive and the platform normalises them, so asserting
    // on `Authorization` would be asserting on a spelling nothing promises.
    expect(hops[0].headers).toEqual({ authorization: "Bearer t", "x-trace-id": "trace_1" });
  });

  it("only ever answers with the response headers on the list", async () => {
    const { forward } = forwarder(
      () =>
        new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": "trace_1",
            // On the list, so it crosses: the 423 lockout window is the one fact
            // a person needs from a locked second factor, and it travels as a
            // header rather than in the body.
            "Retry-After": "900",
            "X-Powered-By": "identity-internal-2",
            Server: "identity/1.0 (internal)",
          },
        }),
    );

    const response = await forward(new Request("https://parlor.test/v1/me"), ["me"]);

    const names = [...response.headers.keys()].map((name) => name.toLowerCase()).sort();
    const expected = [...FORWARDED_RESPONSE_HEADERS, "cache-control"].sort();
    expect(names).toEqual(expected);
    // The name crossing is not the value crossing: the wait is the fact, and a
    // forwarder that relayed the header name with a mangled value would have
    // passed the assertion above and broken the lockout sentence downstream.
    expect(response.headers.get("retry-after")).toBe("900");
    expect(await response.text()).not.toContain("identity-internal-2");
  });
});

// ---------------------------------------------------------------------------
// 5. The cross-file claim: the table and the clients agree.
//
// `src/lib/identity.ts` and `src/lib/billing.ts` build their URLs from literal
// paths. A route added to a client and not to the table is a 404 that no unit
// test in this repository would otherwise catch, because every client test
// injects a transport and never reaches a socket. This walks both clients, calls
// every method, and asks the table about each URL they produce.
// ---------------------------------------------------------------------------

describe("the table and the clients agree", () => {
  it("forwards exactly what the clients call", async () => {
    const { forward, hops } = forwarder();

    // Every method on the identity client, with arguments of the right shape.
    const id = "8f2c1a44-0000-4000-8000-000000000001";
    const { createIdentityClient } = await import("./identity");
    const { createBillingClient } = await import("./billing");

    /**
     * Turns a client URL into what the route handler sees.
     *
     * The clients build `${base}/v1/...` and the router hands over the segments
     * BELOW `/v1`, so the prefix is stripped here. Getting that wrong is the
     * difference between this test exercising the table and exercising nothing:
     * every path would carry a leading `v1` and match no route at all.
     */
    const through = (url: string, method: string) => {
      const [path, query] = url.split("?");
      const segments = path.split("/").filter(Boolean).slice(1);
      return forward(
        new Request(`https://parlor.test/${segments.join("/")}${query ? `?${query}` : ""}`, {
          method,
          headers: { Authorization: "Bearer t" },
          body: method === "GET" || method === "DELETE" ? undefined : "{}",
        }),
        segments,
      );
    };

    /** Throws with the offending call, so a failure names the route not a line. */
    const checked = async (url: string, method: string) => {
      const response = await through(url, method);
      if (response.status === 404 || response.status === 405) {
        throw new Error(`the table refuses ${method} ${url}`);
      }
      return response;
    };

    const client = createIdentityClient({
      baseUrl: "",
      transport: ({ url, method }) => checked(url, method),
    });
    const billing = createBillingClient({
      baseUrl: "",
      transport: ({ url, method }) => checked(url, method),
    });

    await client.mintSignupTimestamp();
    await client.register({
      email: "kaka@example.com",
      password: "correct horse",
      timestamp: 1759843200,
      signature: "minted-signature",
      website: "",
    });
    await client.login({ email: "kaka@example.com", password: "correct horse" });
    // The second-factor login leg, walked through the same door. It resolves
    // on `{}` like the management routes do — `send` reads the body and finds
    // no token, which is a type lie the walk does not care about — so the
    // assertion is the same one every other entry makes: the URL reached an
    // upstream through the table rather than being refused.
    await client.completeSecondFactor({ challenge: "ch_1", code: "482913" });
    await client.logout("t");
    await client.me("t");
    await client.updateMyDisplayName("t", { display_name: "Kaka" });
    await client.listSessions("t");
    await client.revokeSession("t", id);
    await client.deleteMyAccount("t");
    await client.listAccounts("t");
    await client.createAccount("t", { name: "Acme" });
    await client.getAccount("t", id);
    await client.renameAccount("t", id, { name: "Acme 2" });
    await client.deleteAccount("t", id);
    await client.listMembers("t", id);
    await client.inviteMember("t", id, { email: "kaka@example.com", role: "member" });
    await client.acceptInvitation("t", { token: "tok" });
    await client.changeMemberRole("t", id, id, { role: "admin" });
    await client.removeMember("t", id, id);
    await client.requestPasswordReset("kaka@example.com");
    await client.redeemPasswordReset({ token: "tok", password: "correct horse" });
    await client.requestEmailVerification("kaka@example.com");
    await client.redeemEmailVerification({ token: "tok" });
    await client.verificationStatus("t");
    // The two social routes, walked through the same door as everything else.
    //
    // Both are `.catch`ed, and the reason is specific rather than defensive: this
    // stub answers every hop with `200 "{}"`, and for BOTH of these methods a 200
    // is deliberately a failure — `startSocialLogin` throws because the document
    // promises no 2xx for a redirect operation and there is no `Location` to
    // report, and `completeSocialLogin` throws because `{}` carries neither
    // `token` nor `linked_provider`. So the calls throw by design here, and a
    // walk that asserted they resolved would be asserting something untrue.
    //
    // What the walk actually proves is the thing this test exists for: each
    // method's URL reached an upstream through the table rather than being
    // refused. A 404 or 405 from `checked` would have thrown with the URL named,
    // and `checked` runs BEFORE the method's own response handling — so a table
    // missing either route is still a failure here, which is the whole safety net.
    await client.startSocialLogin("github").catch(() => undefined);
    await client
      .completeSocialLogin("github", { state: "st_1", code: "the-code" })
      .catch(() => undefined);
    // The four MFA management routes, walked through the same door. None of
    // them throws on `{}` — a status with `enabled: false` is a valid answer
    // and the other three read their fields as undefined — so the walk asserts
    // the same thing the social pair's does: each URL reached an upstream
    // through the table rather than being refused.
    await client.mfaStatus("t");
    await client.startMfaEnrollment("t");
    await client.confirmMfaEnrollment("t", id, { code: "482913" });
    await client.regenerateMfaRecoveryCodes("t", { code: "482913" });
    // The four operator routes, walked through the same door. `me` and
    // `searchUsers` throw on `{}` by design here — the stub answers every hop
    // with `200 "{}"`, and a gate answer with no `user` and a user list with
    // no `users` are both unreadable — so both are `.catch`ed like the social
    // pair: what the walk proves is that each URL reached an upstream through
    // the table rather than being refused, and `checked` runs before the
    // method's own response handling.
    const { createOperatorClient } = await import("./operator");
    const operator = createOperatorClient({
      baseUrl: "",
      transport: ({ url, method }) => checked(url, method),
    });
    await operator.me("t").catch(() => undefined);
    await operator.searchUsers("t", "kaka@example.com").catch(() => undefined);
    await operator.disableUser("t", id);
    await operator.enableUser("t", id);

    await billing.listPlans({ limit: 2 });
    await billing.getPlanBySlug("pro");
    await billing.listCustomers({ cursor: "c" });
    await billing.getCustomer("4d5e6f70-0000-4000-8000-000000000002");
    await billing.createCustomer({ owner: { type: "User", id }, processor: "stripe" });

    // Every hop landed on an upstream, and every one of them was a hop the table
    // approved. A refusal would have thrown above rather than reached this line.
    expect(hops.length).toBeGreaterThanOrEqual(24);
    for (const hop of hops) {
      expect([IDENTITY_URL, BILLING_URL].some((base) => hop.url.startsWith(base))).toBe(true);
    }
  });
});

describe("the upstream names", () => {
  it("are the two services and nothing else", () => {
    // A typo in a service name would be `undefined` at runtime and a fetch to
    // the string "undefined", so the union is asserted rather than inferred.
    const names: UpstreamName[] = ["identity", "billing"];
    expect(names).toEqual(["identity", "billing"]);
  });
});

// ---------------------------------------------------------------------------
// 6. The account boundary, at the forwarder.
//
// THE THIRD OF THE THREE THINGS A CROSS-TENANT READ NEEDS, and the only one
// that leaves this process.
//
// `parlor` holds no rows. The account boundary is enforced by `identity`, in
// SQL, and it is measured there — `identity/tenancy.yml` declares one entry
// point and `identity/internal/tenancy/tenancy_test.go` proves the three-way
// denial on real rows. So nothing in this file can prove that account A is
// refused account B's data, and this section does not claim to. What it proves
// is the half this repository is responsible for and can therefore go wrong on
// its own:
//
//   a forwarder is the one place in the deployment that decides WHICH ACCOUNT a
//   request is about, and it decides it from a string a caller sent. Three ways
//   it can hand `identity` somebody else's account, all of them invisible from
//   the client side because the client call is still correct:
//
//     * SUBSTITUTION — the upstream path is rebuilt from the caller's own
//       segments, so the account id `identity` scopes by is the account id the
//       caller named. A refactor that resolved the account from a header, a
//       query parameter or the token's claims would be correct-looking and
//       would hand every request to the wrong tenant.
//     * CREDENTIAL SWAPPING — the account id travels with the CALLER'S token. A
//       forwarder that relayed a service credential, or none, would ask
//       `identity` a question it answers from a different subject's membership.
//     * REFUSAL SWALLOWING — `identity` answers 404 for "not one of yours" on
//       purpose, so that a guessed id cannot be used to enumerate accounts. A
//       forwarder that turned that into a 200, or retried it somewhere else,
//       would hand back exactly the information the refusal exists to withhold.
//
// The other two are in `src/lib/accounts.test.ts` (the cache) and in
// `identity` itself (the rows). Together the three are the boundary; each of
// the three is somebody else's to break alone.
//
// THE ENUMERATION IS DECLARED, NOT GREPPED. `ACCOUNT_SCOPED_ROUTES` below is
// the list, and `tests/validate-ci.sh`-style drift is caught by the count and
// by the whole-set tests rather than by a pattern that would read `darkroom`
// has no routes. Adding a tenth account-scoped route means adding a line here,
// which is the obligation D18 asks for and the reason the list is data.
// ---------------------------------------------------------------------------

/** A real uuid, because `SEGMENT_KINDS` value-matches `:accountId` as one. */
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
/** Another account's id. The one that must never appear in a hop for `ACCOUNT_A`. */
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";

/**
 * The eight account-scoped routes in the table, declared.
 *
 * Every one of these carries a `:accountId`, which is what makes it
 * account-scoped: the account is named in the request rather than derived from
 * the credential alone. `GET /v1/accounts` and `POST /v1/accounts` are scoped
 * too — by the token, which is the whole of their scope — and are covered
 * separately below, because the failure they can suffer is a different one.
 *
 * `operation` is the class of read or write, and it is here so a row that
 * covers the wrong class cannot be satisfied by the wrong assertion.
 */
const ACCOUNT_SCOPED_ROUTES = [
  { id: "get-account", operation: "read-by-id", method: "GET", tail: [], expected: `/v1/accounts/${ACCOUNT_A}` },
  { id: "rename-account", operation: "update", method: "PATCH", tail: [], expected: `/v1/accounts/${ACCOUNT_A}` },
  { id: "delete-account", operation: "delete", method: "DELETE", tail: [], expected: `/v1/accounts/${ACCOUNT_A}` },
  { id: "list-members", operation: "list", method: "GET", tail: ["members"], expected: `/v1/accounts/${ACCOUNT_A}/members` },
  { id: "invite-member", operation: "create", method: "POST", tail: ["invitations"], expected: `/v1/accounts/${ACCOUNT_A}/invitations` },
  {
    id: "change-member-role",
    operation: "update",
    method: "PATCH",
    tail: ["members", USER_B],
    expected: `/v1/accounts/${ACCOUNT_A}/members/${USER_B}`,
  },
  {
    id: "remove-member",
    operation: "delete",
    method: "DELETE",
    tail: ["members", USER_B],
    expected: `/v1/accounts/${ACCOUNT_A}/members/${USER_B}`,
  },
] as const satisfies readonly {
  id: string;
  operation: string;
  method: string;
  tail: readonly string[];
  expected: string;
}[];

function accountRoute(route: (typeof ACCOUNT_SCOPED_ROUTES)[number], accountId = ACCOUNT_A) {
  return ["accounts", accountId, ...route.tail];
}

describe("the account boundary at the forwarder", () => {
  it("declares every account-scoped route the table holds, and no others", () => {
    // The declaration is the thing D18 asks for and the thing a grep cannot
    // give. If this goes red, a ninth or tenth `:accountId` route exists and
    // nothing in this file is watching it — so the fix is a line here, not a
    // new suite. Seven, not eight: `GET`/`PATCH`/`DELETE /accounts/{id}` are
    // three routes over one shape and are all three listed, and
    // `POST /accounts/{id}/invitations` is the seventh.
    expect(ACCOUNT_SCOPED_ROUTES).toHaveLength(7);
    expect(new Set(ACCOUNT_SCOPED_ROUTES.map((r) => r.id)).size).toBe(ACCOUNT_SCOPED_ROUTES.length);
  });

  describe.each(ACCOUNT_SCOPED_ROUTES)("$id ($operation)", (route) => {
    it("asks identity about the account the caller named, and no other", async () => {
      const { forward, hops } = forwarder();

      await forward(
        new Request(`https://parlor.test/${route.expected}`, {
          method: route.method,
          headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
          body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}",
        }),
        accountRoute(route),
      );

      // SUBSTITUTION. The URL is built by rebuilding the path from the table's
      // own shape and the caller's segments, so this is byte-for-byte the
      // account the caller named. The second assertion is the one that matters:
      // `ACCOUNT_B` appearing here would mean the forwarder resolved the
      // account from somewhere other than the request.
      expect(hops).toHaveLength(1);
      expect(hops[0].url).toBe(`${IDENTITY_URL}${route.expected}`);
      expect(hops[0].url).not.toContain(ACCOUNT_B);
      expect(hops[0].method).toBe(route.method);
    });

    it("carries the caller's own credential, and nothing that could stand in for it", async () => {
      const { forward, hops } = forwarder();

      await forward(
        new Request(`https://parlor.test/${route.expected}`, {
          method: route.method,
          headers: {
            Authorization: "Bearer alice",
            Cookie: "__Host-session=alice-cookie",
            "Content-Type": "application/json",
          },
          body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}",
        }),
        accountRoute(route),
      );

      // CREDENTIAL SWAPPING. `identity` prefers the `Authorization` header over
      // the cookie (`presentedToken`), so the header is the credential being
      // used and the header is the caller's. A forwarder that minted, cached or
      // pooled one would ask the same question about a different subject's
      // memberships, and every request would still be 200.
      expect(hops[0].headers.authorization).toBe("Bearer alice");
      expect(hops[0].headers.cookie).toBe("__Host-session=alice-cookie");
    });

    it("relays a refusal as a refusal, status and body, with nothing added", async () => {
      // The answer `identity` gives for "no such account" AND for "an account
      // you are not a member of", on purpose, so a guessed id cannot enumerate
      // accounts. RELAYED, not re-authored: this repository has no business
      // inventing a different answer, and a forwarder that mapped 404 to 200
      // would hand back the very rows the refusal withholds.
      const refusal = JSON.stringify({
        type: "https://errors.cafaye.com/not_found",
        title: "Account not found.",
        status: 404,
        code: "not_found",
      });
      const { forward, hops } = forwarder(
        () =>
          new Response(refusal, {
            status: 404,
            headers: { "Content-Type": "application/problem+json" },
          }),
      );

      const response = await forward(
        new Request(`https://parlor.test/${route.expected}`, {
          method: route.method,
          headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
          body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}",
        }),
        accountRoute(route),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(JSON.parse(refusal));
      // One hop and one hop only. A retry here would be the interesting bug: a
      // forwarder that "helpfully" tried the caller's other accounts, or asked
      // again with a different credential, would turn a refusal into a search.
      expect(hops).toHaveLength(1);
    });

    it("refuses an account id that is not an account id, before any address is contacted", async () => {
      // The value check, on every account-scoped route rather than the one the
      // allow-list tests happened to use. `%2e%2e%2f` is one segment by the time
      // it arrives (`matchesShape`'s comment), so a check that only counted
      // positions would splice `../../` into an upstream URL — and a traversal
      // out of `/v1/accounts/` is a way to reach a route the table never
      // listed, under an account the caller never named.
      for (const forged of ["../../v1/me", "x", ACCOUNT_A.slice(0, -1), "", "%2e%2e%2fme"]) {
        const { forward, hops } = forwarder();

        const response = await forward(
          new Request(`https://parlor.test/v1/accounts/${forged}`, {
            method: route.method,
            headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
            body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}",
          }),
          accountRoute(route, forged),
        );

        expect(response.status, `${route.id} with ${JSON.stringify(forged)}`).toBe(404);
        expect(hops, `${route.id} with ${JSON.stringify(forged)}`).toHaveLength(0);
      }
    });
  });

  it("asks identity once per account route and never reaches billing with one", async () => {
    // billing has no account in its contract at all, so an account path that
    // resolved to the billing base would be a request to the wrong service with
    // somebody else's account id in it.
    for (const route of ACCOUNT_SCOPED_ROUTES) {
      const { forward, hops } = forwarder();
      await forward(
        new Request(`https://parlor.test/${route.expected}`, {
          method: route.method,
          headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
          body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}",
        }),
        accountRoute(route),
      );

      // `startsWith` and not a matcher: this repository has no `jest-extended`,
      // and `expect(url).toMatch(/^http:\/\/identity\.test/)` would be a
      // pattern — the thing D18 says already reads like an answer when it is
      // broken.
      expect(hops[0].url.startsWith(`${IDENTITY_URL}/v1/accounts/`), route.id).toBe(true);
      expect(hops[0].url, route.id).not.toContain(BILLING_URL);
    }
  });

  it("cannot be turned into a fetch-by-id with a query parameter on the collection", async () => {
    // `GET /v1/accounts` and `POST /v1/accounts` are the two account-scoped
    // routes with no `:accountId` segment: they are scoped by the token alone.
    // The failure they can suffer is therefore not substitution but WIDENING —
    // a query parameter that names the account turns "everything I belong to"
    // into "this one account", which is a read of somebody else's rows wearing
    // the shape of a list. Neither route declares a `query`, so the parameter
    // cannot survive.
    for (const method of ["GET", "POST"]) {
      const { forward, hops } = forwarder();
      await forward(
        new Request(`https://parlor.test/v1/accounts?account_id=${ACCOUNT_B}&accountId=${ACCOUNT_B}&id=${ACCOUNT_B}`, {
          method,
          headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        }),
        ["accounts"],
      );

      expect(hops, method).toHaveLength(1);
      expect(hops[0].url, method).toBe(`${IDENTITY_URL}/v1/accounts`);
      expect(hops[0].url, method).not.toContain(ACCOUNT_B);
    }
  });

  it("takes the account from the path only, and not from the body", async () => {
    // The mirror of the collection arm, for the write. A body carrying
    // `account_id` is data the service may or may not read; the forwarder must
    // not treat it as a second address for the request, because a request about
    // `ACCOUNT_A` that also says `ACCOUNT_B` is ambiguous and the answer to an
    // ambiguous tenancy question is which one the forwarder happened to pick.
    const { forward, hops } = forwarder();

    await forward(
      new Request(`https://parlor.test/v1/accounts/${ACCOUNT_A}/members/${USER_B}`, {
        method: "PATCH",
        headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
        body: JSON.stringify({ role: "owner", account_id: ACCOUNT_B }),
      }),
      accountRoute(ACCOUNT_SCOPED_ROUTES[5]),
    );

    // The body crosses verbatim, because that is property 4 — the service is
    // the one that decides what a request body means. What must not happen is
    // the ADDRESS moving: one account in the path, one account in the URL.
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/accounts/${ACCOUNT_A}/members/${USER_B}`);
    expect(hops[0].url).not.toContain(ACCOUNT_B);
    expect(hops).toHaveLength(1);
  });

  it("refuses a forged member id on both per-member routes", async () => {
    // `:userId` is the second wildcard and the narrower one: it addresses a
    // person INSIDE an account the caller has already named, so a forged value
    // here is a forged membership. Two routes, both refused before a hop.
    // The two routes that address a person inside the account, named rather
    // than matched on `tail`: `ACCOUNT_SCOPED_ROUTES` is `as const`, so
    // `tail` is a tuple of literal types and `tail.includes(USER_B)` narrows to
    // `never` rather than to a boolean.
    const perMember: readonly string[] = ["change-member-role", "remove-member"];
    for (const route of ACCOUNT_SCOPED_ROUTES.filter((r) => perMember.includes(r.id))) {
      const { forward, hops } = forwarder();
      const response = await forward(
        new Request(`https://parlor.test/${route.expected}`, {
          method: route.method,
          headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
          body: route.method === "DELETE" ? undefined : "{}",
        }),
        ["accounts", ACCOUNT_A, "members", "../../me"],
      );

      expect(response.status, route.id).toBe(404);
      expect(hops, route.id).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The social surface — the one place in this table whose success is a
//    REDIRECT.
//
// `GET /v1/auth/oauth/{provider}` answers 302 with a `Location` and no body
// (`identity/internal/httpapi/oauth.go`, `oauthRedirect`), and sets
// `__Host-oauth-state` for the callback to compare against. The provider then
// brings the browser back to `/v1/auth/oauth/{provider}/callback`, which is a
// TOP-LEVEL NAVIGATION rather than a `fetch` from this app: it arrives carrying
// cookies and it leaves carrying `Set-Cookie`.
//
// That makes this section different from every other one, in one specific way.
// Every other route in the table can be proved by asserting on the hop and the
// body. This one cannot: the header that IS the answer is a response header, and
// a forwarder that forwarded the request perfectly and dropped `Location` would
// return a 302 to nowhere. The browser would sit on a blank page and nothing
// would say why. So the tests below assert on the headers crossing back, not on
// the request reaching identity.
//
// `location` is NOT on `FORWARDED_RESPONSE_HEADERS`, and one route declares
// itself a browser redirect with `browserRedirect: true`. Both halves of that
// are asserted here: the start leg's `Location` crossing, and a 302 on a route
// that did not declare itself one arriving at the browser with no `Location` at
// all. A test for the first alone would pass on a forwarder that forwards every
// upstream redirect, which is the arrangement the omission exists to prevent.
// ---------------------------------------------------------------------------

describe("the social surface", () => {
  it("forwards a social-start GET to identity under the provider the caller named", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(new Request("https://parlor.test/v1/auth/oauth/github"), [
      "auth",
      "oauth",
      "github",
    ]);

    expect(response.status).toBe(200);
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/auth/oauth/github`);
    expect(hops[0].method).toBe("GET");
  });

  it("delivers the start leg's redirect and its state cookie", async () => {
    // THE FIRST HALF OF THE TRAP. A 302 is the whole success of this route, and
    // `Location` is the only thing in the answer that says where to go — so a
    // forwarder whose response allow-list named `content-type` and `x-trace-id`
    // and nothing else would relay a perfect 302 with no destination on it. The
    // `oauth-state` cookie matters for the same test because the callback
    // compares `state` against it and a flow with no cookie cannot finish.
    const { forward } = forwarder(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&state=xyz",
            "Set-Cookie": "__Host-oauth-state=st_1; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax",
          },
        }),
    );

    const response = await forward(new Request("https://parlor.test/v1/auth/oauth/google"), [
      "auth",
      "oauth",
      "google",
    ]);

    // The status survives, because `relay` passes it through untouched.
    expect(response.status).toBe(302);
    // The destination survives, which is the assertion that fails without
    // `browserRedirect` on the route's entry in the table.
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&state=xyz",
    );
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("__Host-oauth-state=st_1");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    // The attribute a forwarder adds to "make it work" and which makes the
    // browser reject the whole thing. Same rule as `__Host-session`, same test.
    expect(cookie).not.toContain("Domain=");
  });

  it("relays no Location on a route that did not declare itself a redirect", async () => {
    // THE TEST THAT HOLDS THE RULE THE MARK RELAXES, and the reason this section
    // is not simply "`location` is forwarded now". A 302 from a route the table
    // does NOT declare as a browser redirect reaches the browser as a 302 with
    // nowhere to go: the status survives, the `Location` does not, and nothing is
    // followed.
    //
    // It is written as an upstream that REDIRECTS rather than as one that answers
    // normally, because that is the case the omission exists for. `POST
    // /v1/session` is not a route any service should ever answer with a 302 — a
    // redirect there is a misconfiguration — and the point is that a
    // misconfiguration on the far side of this hop cannot become a move the
    // browser makes on a stranger's behalf, with `__Host-session` riding it.
    // A version of this that asserted on a 200 would pass with `location` on the
    // global allow-list and would prove nothing at all.
    //
    // The sibling test is `../site`'s, by almost this name: "does not follow a
    // redirect, and does not hand its Location to the browser". Same assertion,
    // reached from the other side of the declaration.
    const { forward } = forwarder(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://elsewhere.test/steal",
            "Set-Cookie": "__Host-session=someone-elses; Path=/; Secure; HttpOnly; SameSite=Lax",
          },
        }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBeNull();
    // And the refusal is not "drop everything on an unusual status": the cookie
    // still crosses, because `Set-Cookie` is not conditioned on either the route's
    // mark or the status. That is the other half of the trap, and a version of
    // this test that only asserted the status would have let it regress silently.
    expect(response.headers.get("set-cookie")).toContain("__Host-session=");
  });

  it("relays no Location it was not given", async () => {
    // The complement of the test above, because a header allow-list is only a
    // claim about what crosses if something asserts what does NOT cross. A 200
    // from `POST /v1/session` has no `Location`, and this file does not invent
    // one.
    const { forward } = forwarder(
      () =>
        new Response(JSON.stringify({ token: "t" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/session", { method: "POST", body: "{}" }),
      ["session"],
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("hands no Location to the browser on the CALLBACK, which is the other half of the flow", async () => {
    // The callback route carries no `browserRedirect`, and this is what that
    // omission buys. The provider's trip to this path happened inside the
    // `Location` the START leg handed over, so anything arriving here as a 302 is
    // a move upstream proposed AFTER the browser had already been handed the
    // provider's page — and this table has no opinion about it. Dropping it is
    // the same dead end as above, and it is the correct dead end here.
    const { forward } = forwarder(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://elsewhere.test/steal" },
        }),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/auth/oauth/github/callback?state=s&code=c"),
      ["auth", "oauth", "github", "callback"],
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBeNull();
  });

  it("forwards the callback's code and state, in the route's declared order", async () => {
    // WITHOUT the route's `query` declaration, `buildQuery` returns "" and the
    // callback arrives at identity with no `state` at all — which the service
    // answers with a 400 that deliberately does not say why. So this asserts the
    // parameter SURVIVED, because a social sign-in that cannot finish looks
    // exactly like a social sign-in the person never started.
    const { forward, hops } = forwarder();

    await forward(
      new Request("https://parlor.test/v1/auth/oauth/github/callback?state=st_1&code=the-code"),
      ["auth", "oauth", "github", "callback"],
    );

    expect(hops[0].url).toBe(
      `${IDENTITY_URL}/v1/auth/oauth/github/callback?code=the-code&state=st_1`,
    );
  });

  it("forwards the callback's error parameter, which is a refusal and not a missing code", async () => {
    // Somebody who said no at the provider is sent back with `error` and no
    // `code`. identity answers that as a 400 refusal precisely so the client can
    // say "you declined" rather than "you presented something invalid" — which is
    // only possible if `error` survives the hop.
    const { forward, hops } = forwarder();

    await forward(
      new Request(
        "https://parlor.test/v1/auth/oauth/google/callback?error=access_denied&state=st_1",
      ),
      ["auth", "oauth", "google", "callback"],
    );

    expect(hops[0].url).toContain("error=access_denied");
  });

  it("drops a callback parameter the route does not declare", async () => {
    // The same rule every other route obeys, and the one that matters most here:
    // `redirect_uri` and `client_id` are parameters the PROVIDER sends to
    // identity, and this app is not the provider. Forwarding a caller's
    // `redirect_uri` is how a code would be delivered somewhere the caller chose.
    const { forward, hops } = forwarder();

    await forward(
      new Request(
        "https://parlor.test/v1/auth/oauth/github/callback?state=st_1&redirect_uri=https%3A%2F%2Fevil.example%2Fsteal",
      ),
      ["auth", "oauth", "github", "callback"],
    );

    expect(hops[0].url).not.toContain("redirect_uri");
    expect(hops[0].url).not.toContain("evil.example");
  });

  it("delivers the callback leg's session cookie, with its attributes untouched", async () => {
    // THE SECOND HALF OF THE TRAP, and the one the brief names: on the sign-in
    // path the callback's 200 sets `__Host-session` exactly as `POST /v1/session`
    // does, and that cookie is the entire result of the round trip. A browser
    // that got a 200 and no cookie has signed in to nothing.
    const { forward } = forwarder(
      () =>
        new Response(
          JSON.stringify({ token: "tok_social", expires_at: "2026-10-30T12:00:00Z" }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": "__Host-session=tok_social; Path=/; Secure; HttpOnly; SameSite=Lax",
            },
          },
        ),
    );

    const response = await forward(
      new Request("https://parlor.test/v1/auth/oauth/github/callback?state=st_1&code=c"),
      ["auth", "oauth", "github", "callback"],
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("__Host-session=tok_social");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
    // And the body is not dropped on the way, because the client reads the
    // `token` out of it.
    expect(await response.json()).toMatchObject({ token: "tok_social" });
  });

  it("carries both cookies of a round trip without folding them together", async () => {
    // THE WHOLE ROUND TRIP AS THE BROWSER EXPERIENCES IT, and the single test
    // that would catch the silent failure. It walks the two legs through the
    // forwarder and asserts three things a per-leg test cannot see at once:
    //
    //   * the `__Host-oauth-state` cookie identity SET on leg one reaches the
    //     caller (and so can be sent back), because a flow whose state cookie
    //     never arrived cannot finish at all;
    //   * that same cookie is what identity RECEIVES on leg two, so the round
    //     trip identity compares is the round trip this forwarder proxied;
    //   * the `__Host-session` cookie from leg two reaches the caller as its own
    //     header value.
    //
    // `headers.get("set-cookie")` would return "a, b" for two cookies — the
    // joined value that lands inside one cookie's `Expires` and destroys both,
    // which is the same trap the MFA test above is written for. This asserts on
    // `getSetCookie()` and on the string the browser would actually parse.
    let jar = "";
    const { forward, hops } = forwarder((hop) => {
      // `includes`, not `endsWith`: the callback's URL carries a query string,
      // so it ends in `…&state=st_1` rather than in `/callback`. A predicate that
      // only looked at the tail answered leg two with the start leg's 302 — which
      // is a reminder that the query string is part of the route, and that the
      // tests below are as dependent on it surviving as the browser is.
      if (hop.url.includes("/callback")) {
        return new Response(
          JSON.stringify({ token: "tok_social", expires_at: "2026-10-30T12:00:00Z" }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": "__Host-session=tok_social; Path=/; Secure; HttpOnly; SameSite=Lax",
            },
          },
        );
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://github.com/login/oauth/authorize?state=st_1",
          "Set-Cookie": "__Host-oauth-state=st_1; Path=/; Max-Age=600; Secure; HttpOnly",
        },
      });
    });

    // Leg one: the button.
    const started = await forward(new Request("https://parlor.test/v1/auth/oauth/github"), [
      "auth",
      "oauth",
      "github",
    ]);
    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toBe(
      "https://github.com/login/oauth/authorize?state=st_1",
    );

    // What the browser stored from leg one.
    const stateCookie = started.headers.getSetCookie();
    expect(stateCookie).toHaveLength(1);
    const state = stateCookie[0].split(";")[0];
    expect(state).toBe("__Host-oauth-state=st_1");
    jar = state;

    // Leg two: the provider sends the browser back, with that cookie.
    const finished = await forward(
      new Request(
        `https://parlor.test/v1/auth/oauth/github/callback?code=the-code&state=st_1`,
        { headers: { Cookie: jar } },
      ),
      ["auth", "oauth", "github", "callback"],
    );

    expect(hops).toHaveLength(2);
    // The state cookie crossed to identity on the leg that compares against it.
    expect(hops[1].headers.cookie).toBe("__Host-oauth-state=st_1");
    // And the session came back as its own cookie, unjoined.
    const session = finished.headers.getSetCookie();
    expect(session).toHaveLength(1);
    expect(session[0]).toContain("__Host-session=tok_social");
    expect(finished.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a provider segment that is not one, before any address is contacted", async () => {
    // The value check on the new wildcard, written as attacks for the same
    // reason the tenancy ones are. `matchesShape`'s comment explains why the
    // segment is value-matched at all: the router has already percent-decoded it,
    // so `oauth/%2e%2e%2f%2e%2e` arrives as ONE segment reading `../../`, and a
    // check that only counted positions would splice it into the upstream URL.
    // `Google` is in the list because the pattern is lower-case: the enum in the
    // document is `[google, github]` and a case-insensitive match here would be
    // this app guessing at a service's configuration.
    for (const forged of ["../../me", "Google", "goo gle", "", "google/callback", "google%2Fme"]) {
      const { forward, hops } = forwarder();

      const response = await forward(
        new Request(`https://parlor.test/v1/auth/oauth/${forged}`),
        ["auth", "oauth", forged],
      );

      expect(response.status, JSON.stringify(forged)).toBe(404);
      expect(hops, JSON.stringify(forged)).toHaveLength(0);
    }
  });

  it("refuses a callback whose provider segment is forged, on both social routes", async () => {
    // The callback is a wildcard route too, so the same traversal reaches it. Two
    // routes, both refused before a hop: a `/callback` that answered for a forged
    // provider would be a second door into whatever identity does with a
    // mismatched provider and state.
    for (const [route, segments] of [
      ["/v1/auth/oauth/github/callback", ["auth", "oauth", "../../me", "callback"]],
      ["/v1/auth/oauth/github/callback", ["auth", "oauth", "", "callback"]],
      ["/v1/auth/oauth/google", ["auth", "oauth", "a/b"]],
    ] as const) {
      const { forward, hops } = forwarder();

      const response = await forward(new Request(`https://parlor.test${route}`), [
        ...segments,
      ]);

      expect(response.status, `${route} ${JSON.stringify(segments)}`).toBe(404);
      expect(hops, `${route} ${JSON.stringify(segments)}`).toHaveLength(0);
    }
  });

  it("asks identity about a provider this app does not narrow to the document's enum", async () => {
    // THE ENUMERATION DEFENCE IS IDENTITY'S, AND THIS FILE MUST NOT WIDEN IT.
    // The document says a name this deployment has no credentials for and a name
    // that does not exist are BOTH 404, "because telling them apart is a way to
    // enumerate a deployment's configuration". So `:provider` is value-matched
    // against a shape and the request is forwarded: whatever identity answers is
    // the answer, and this table holds no list of which providers exist. Narrowing
    // it here to `[google, github]` would not be wrong in isolation — but it would
    // make the two answers distinguishable at the forwarder, and the whole point
    // is that they are not distinguishable anywhere.
    const { forward, hops } = forwarder(
      () =>
        new Response(JSON.stringify({ code: "not_found", title: "Not found." }), {
          status: 404,
          headers: { "Content-Type": "application/problem+json" },
        }),
    );

    const response = await forward(new Request("https://parlor.test/v1/auth/oauth/gitlab"), [
      "auth",
      "oauth",
      "gitlab",
    ]);

    // It reached identity, and identity's own 404 came back untouched.
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/auth/oauth/gitlab`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
  });

  it("never relays a Location that names an upstream address", async () => {
    // The response allow-list grew by one header, and a header that crosses is a
    // header that can leak. This is the assertion that `Location` is safe to
    // relay: identity writes it in exactly two places in the whole service —
    // `oauthRedirect` in `internal/httpapi/oauth.go` (the route above) and the
    // OIDC authorization endpoint in `internal/httpapi/oidc.go`, which is not in
    // this table — and both write a PROVIDER's public address, never their own.
    // So the one header that could name a host is not one either route can emit.
    const { forward } = forwarder(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://accounts.google.com/o/oauth2/v2/auth?state=xyz" },
        }),
    );

    const response = await forward(new Request("https://parlor.test/v1/auth/oauth/google"), [
      "auth",
      "oauth",
      "google",
    ]);

    expect(response.headers.get("location")).not.toContain(IDENTITY_URL);
    expect(response.headers.get("location")).not.toContain(BILLING_URL);
  });

  it("refuses a method on either social route, and does not contact upstream", async () => {
    // Both routes are GET and nothing else. A `POST` to either is a 405 with an
    // `Allow` that names only GET — and, as with every other method refusal in
    // this file, with no request leaving this process.
    for (const segments of [
      ["auth", "oauth", "github"],
      ["auth", "oauth", "github", "callback"],
    ]) {
      const { forward, hops } = forwarder();

      const response = await forward(
        new Request(`https://parlor.test/${segments.join("/")}`, {
          method: "POST",
          body: "{}",
        }),
        segments,
      );

      expect(response.status, segments.join("/")).toBe(405);
      expect(response.headers.get("allow"), segments.join("/")).toBe("GET");
      expect(hops, segments.join("/")).toHaveLength(0);
    }
  });

  it("sends neither a session token nor a cookie it was not given on the start leg", async () => {
    // `GET /v1/auth/oauth/{provider}` is `security: []`. It reads a session
    // cookie, but only to record an INTENTION — if the caller happens to hold one
    // that resolves, the flow becomes a LINK rather than a sign-in. That is the
    // service's decision to make from the credential, so the forwarder relays
    // whatever the browser sent and invents nothing; what it must not do is ADD
    // one, which is the same property the billing test above asserts.
    const { forward, hops } = forwarder();

    await forward(new Request("https://parlor.test/v1/auth/oauth/github"), [
      "auth",
      "oauth",
      "github",
    ]);

    expect(hops[0].headers.authorization).toBeUndefined();
    expect(hops[0].headers.cookie).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. The operator surface: the four human-session system-admin routes.
//
// The machine-key disable/enable pair stays refused — no client here holds a
// machine key — and these four are allowed because the operator client can
// perform them and the `/admin` screen drives them. The 401/403 answers pass
// through untouched (property 4), because the screen tells "anonymous" from
// "not staff" by the status.
// ---------------------------------------------------------------------------

describe("the operator surface", () => {
  const userId = "8f2c1a44-0000-4000-8000-000000000001";

  it("forwards the staff gate to identity", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/operator/me", {
        headers: { Authorization: "Bearer t" },
      }),
      ["operator", "me"],
    );

    expect(response.status).toBe(200);
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/operator/me`);
    expect(hops[0].headers.authorization).toBe("Bearer t");
  });

  it("forwards a user search with its declared query, and drops what is not declared", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/operator/users?query=kaka&limit=25&redirect_uri=https://evil.test", {
        headers: { Authorization: "Bearer t" },
      }),
      ["operator", "users"],
    );

    expect(response.status).toBe(200);
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toBe(`${IDENTITY_URL}/v1/operator/users?query=kaka&limit=25`);
  });

  it("forwards disable and enable on the contract paths", async () => {
    const { forward, hops } = forwarder();

    for (const action of ["disable", "enable"] as const) {
      const response = await forward(
        new Request(`https://parlor.test/v1/operator/users/${userId}/${action}`, {
          method: "POST",
          headers: { Authorization: "Bearer t" },
        }),
        ["operator", "users", userId, action],
      );

      expect(response.status).toBe(200);
    }

    expect(hops.map((hop) => hop.url)).toEqual([
      `${IDENTITY_URL}/v1/operator/users/${userId}/disable`,
      `${IDENTITY_URL}/v1/operator/users/${userId}/enable`,
    ]);
  });

  it("refuses a non-uuid user id before an address is contacted", async () => {
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request("https://parlor.test/v1/operator/users/not-a-uuid/disable", { method: "POST" }),
      ["operator", "users", "not-a-uuid", "disable"],
    );

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("refuses an unlisted disable-shaped path outside /operator", async () => {
    // Only the four `/operator` entries above are allowed. A disable-shaped
    // path anywhere else — whatever service owns it — is refused here, before
    // an address is contacted, and identity never sees the request.
    const { forward, hops } = forwarder();

    const response = await forward(
      new Request(`https://parlor.test/v1/users/${userId}/disable`, { method: "POST" }),
      ["users", userId, "disable"],
    );

    expect(response.status).toBe(404);
    expect(hops).toHaveLength(0);
  });

  it("passes a 403 through rather than turning it into a success", async () => {
    const { forward } = forwarder(
      () =>
        new Response(
          JSON.stringify({
            type: "https://errors.cafaye.com/forbidden",
            title: "Staff only.",
            status: 403,
            code: "forbidden",
          }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } },
        ),
    );

    const response = await forward(new Request("https://parlor.test/v1/operator/me"), [
      "operator",
      "me",
    ]);

    expect(response.status).toBe(403);
  });
});
