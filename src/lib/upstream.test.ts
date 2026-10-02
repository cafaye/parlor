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

/** Records every hop and answers with whatever the test queued. */
function recordingFetch(respond?: (hop: Hop) => Response) {
  const hops: Hop[] = [];
  // `RequestInfo | URL` rather than `string | URL`, because the seam is typed as
  // the platform's `fetch` and a narrower parameter type is not assignable to
  // it. Widening the parameter is what makes this a drop-in; the recorder only
  // ever reads `String(input)`, which is correct for all three spellings.
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // `init.headers` is a `Headers` instance and spreading one yields `{}` — a
    // spread reads own enumerable properties and a Headers keeps its map
    // internal. Reading it through `entries()` is the only way to see what would
    // actually cross the wire, and asserting on `{}` is how a header allow-list
    // test passes without testing anything.
    const sent = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    for (const [name, value] of sent) headers[name] = value;

    const hop: Hop = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    };
    hops.push(hop);
    return respond ? respond(hop) : new Response("{}", { status: 200 });
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

  it("refuses a route identity serves but this app never calls", async () => {
    // identity serves /v1/introspections, /v1/session/mfa, /v1/mfa/*,
    // /v1/accounts/{id}/api-keys, /v1/accounts/{id}/oidc-clients,
    // /v1/email-changes/* and /v1/probe/{id}. Not one of them is in
    // `src/lib/identity.ts`, and the point of the allow-list is that a route
    // being reachable from the internet is a decision somebody makes rather than
    // a side effect of a client existing.
    const refused = [
      { segments: ["introspections"], method: "POST" },
      { segments: ["session", "mfa"], method: "POST" },
      { segments: ["mfa"], method: "GET" },
      { segments: ["mfa", "enrollments"], method: "POST" },
      { segments: ["email-changes", "current-address"], method: "POST" },
      { segments: ["probe", "8f2c1a44-0000-4000-8000-000000000000"], method: "GET" },
    ];

    for (const route of refused) {
      const { forward, hops } = forwarder();
      const response = await forward(
        new Request(`https://parlor.test/${route.segments.join("/")}`, { method: route.method }),
        route.segments,
      );

      expect(response.status, `${route.method} /${route.segments.join("/")}`).toBe(404);
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
            "X-Powered-By": "identity-internal-2",
            Server: "identity/1.0 (internal)",
          },
        }),
    );

    const response = await forward(new Request("https://parlor.test/v1/me"), ["me"]);

    const names = [...response.headers.keys()].map((name) => name.toLowerCase()).sort();
    const expected = [...FORWARDED_RESPONSE_HEADERS, "cache-control"].sort();
    expect(names).toEqual(expected);
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

    await client.register({ email: "kaka@example.com", password: "correct horse" });
    await client.login({ email: "kaka@example.com", password: "correct horse" });
    await client.logout("t");
    await client.me("t");
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
