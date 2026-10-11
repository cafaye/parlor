/**
 * The callback route's own contract, which is one question and one hop.
 *
 * The route sits at `/v1/auth/oauth/$provider/callback` and the forwarder sits
 * at `/v1/$`, and this file is about which of the two answers a given request.
 * Two properties are load-bearing and both are invisible in a rendered string:
 *
 *   1. **A document navigation never reaches identity.** The page has to render
 *      without spending the authorization code, because the code is ONE-SHOT:
 *      the page's own request and the page's own `fetch` of the same URL would
 *      be two exchanges, and the second fails on a spent code.
 *   2. **A programmatic request is the forwarder's, unchanged.** Same URL, same
 *      allow-list, same cookie relay, same redirect decision — this route adds
 *      nothing to what crosses and takes nothing away.
 *
 * The round trip is walked end to end through the forwarder rather than
 * described, because the trap is in the leg that is easy to forget: the state
 * cookie is set on the START leg's 302, and the CALLBACK is the request that has
 * to present it. A callback that forwards without the cookie is refused by
 * identity with a 400 that says the flow "did not start in this browser".
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createUpstreamForwarder } from "@/lib/upstream";
import { socialCallbackPath } from "@/lib/social";

import { Route } from "./callback";

/**
 * THE ADDRESS THIS FILE ASSUMES NOTHING IS LISTENING ON, PINNED BEFORE ANY IMPORT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HERE AT ALL: THE TEST WAS RED FOR A REASON THAT WAS NOT A DEFECT
 * ---------------------------------------------------------------------------
 * The subtest "a programmatic request to the callback / is delegated to the
 * forwarder rather than rendered" asserts a 502 and its own comment says why:
 * "with no reachable identity the forwarder answers its own 502, which is the
 * property that matters — it is a failure and not a page, and it is the
 * forwarder's failure rather than this route's." The 502 is the PROOF. A 200
 * with a rendered document would mean this route answered, and the property
 * under test would be gone; the forwarder failing closed is what tells the two
 * apart without a spy (and the file header explains at length why a spy cannot
 * work here — `createUpstreamForwarder` resolves its transport once, at
 * construction).
 *
 * So the assertion needs identity to be UNREACHABLE, and it needs that to be
 * true on the machine running it rather than by luck. It was not, and the
 * consequence was a red suite whose message pointed somewhere else entirely:
 *
 *   * `src/app/v1/[...path]/route.ts` reads `IDENTITY_URL` at MODULE SCOPE and
 *     falls back to `DEFAULT_IDENTITY_URL` — `http://localhost:8080`, the
 *     compose stack's address. So with nothing set, this suite's forwarder aims
 *     at whatever a developer happens to have running on 8080.
 *   * A developer running `bin/e2e-stack up` has exactly that: an identity on
 *     8080 with NO OAuth provider configured, because `registerSocialRoutes`
 *     returns before registering either route when no provider is configured.
 *   * That identity therefore answers `GET /v1/auth/oauth/github/callback` with
 *     ITS OWN 404, and the test read it as the router's.
 *
 * Measured here, before this line existed, on a machine with the stack up:
 *
 *   AssertionError: expected 404 to be 502
 *
 * and the 404 body is not parlor's. `notFound()` in the route handler answers
 * `{"title": "No such route.", "code": "not_found"}` with no `detail`, no
 * `instance` and no `trace_id`; the observed body was
 *
 *   {"type": "https://docs.cafaye.com/errors/not_found", "title": "Not found",
 *    "detail": "no route matches this request",
 *    "instance": "/v1/auth/oauth/github/callback", "trace_id": "..."}
 *
 * which is IDENTITY's envelope, `trace_id` and all. Asking that identity the
 * same question with `curl` answered the identical body, and pointing
 * `IDENTITY_URL` at a closed port made all ten tests in this file pass
 * unchanged — which is what located the cause in the environment rather than in
 * the delegation.
 *
 * THE MISDIAGNOSIS THIS PREVENTS, because it is the one the packet was written
 * from. A 404 from this route reads as "the path is not in the forwarder's
 * allow-list", and the obvious fix is to add the callback to `ROUTES`. IT IS
 * ALREADY THERE — `src/lib/upstream.ts`, `["auth", "oauth", ":provider",
 * "callback"]`, added by `b3dc1f5` ("the social routes are reachable through
 * the forwarder") — and the subtests below that inject their own forwarder, the
 * "agrees, for the provider this app offers" one in particular, walk the whole
 * round trip and pass. Adding a second copy of the entry would have produced a
 * green suite by making a change to the security table of a deployment over a
 * test that was measuring the wrong thing.
 *
 * ---------------------------------------------------------------------------
 * WHY `vi.hoisted` AND NOT A LINE IN THE BODY
 * ---------------------------------------------------------------------------
 * Because ES imports are HOISTED and evaluated before any statement in this
 * file runs. `import { Route } from "./callback"` above pulls in the route
 * handler, which builds its forwarder at module scope, which reads
 * `IDENTITY_URL` — so `process.env.IDENTITY_URL = …` written after the imports
 * would be a line that provably does nothing, and the bug would come back the
 * next time somebody tidied the imports. `vi.hoisted` is the documented way to
 * run code BEFORE the imports of the file that contains it, and it is hoisted
 * above them for exactly this reason.
 *
 * `127.0.0.1:1` rather than `localhost:<some port>` for two reasons. It is not
 * the compose stack's address, so no stack configuration can make this suite
 * talk to a real service; and port 1 is privileged and unbound on every machine
 * this runs on, so the refusal is `ECONNREFUSED` immediately rather than a
 * timeout that would turn a broken assertion into a slow one. The port is not
 * checked in `tests/validate-ci.sh` because nothing PUBLISHES it — it is only
 * connected to, once, by a test that asserts the connection fails.
 *
 * The other tests in this file are unaffected: each builds its own forwarder
 * with an injected `fetchImpl` and an explicit `identityUrl`, so none of them
 * reads this value, and the two document-navigation subtests never reach the
 * forwarder at all. Vitest isolates per file, so nothing here reaches a
 * neighbouring suite's environment either.
 */
vi.hoisted(() => {
  process.env.IDENTITY_URL = "http://127.0.0.1:1";
});

const ROUTE_SOURCE = readFileSync(
  "src/routes/v1/auth/oauth/$provider/callback.tsx",
  "utf8",
);

/**
 * The handler, typed and narrowed.
 *
 * `server.handlers` may be declared as a record OR as a function that builds one,
 * so `tsc` cannot see through it to `GET`. This narrows it once and throws
 * rather than skipping, because a test that quietly had no handler to call would
 * assert on nothing at all.
 */
type CallbackHandler = (ctx: {
  request: Request;
  params: { provider: string };
  next(): { isNext: true } | Record<string, unknown>;
}) => unknown;

const declared = Route.options?.server?.handlers;
const handler = (typeof declared === "function" ? undefined : declared?.GET) as
  | CallbackHandler
  | undefined;
if (typeof handler !== "function") {
  throw new Error("the callback route must declare a GET handler, and it must be a function");
}

/** A browser top-level navigation, which is what the provider's redirect is. */
const DOCUMENT_HEADERS = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9" };

/** What the one programmatic caller sends, transcribed from the client. */
const JSON_HEADERS = { accept: "application/json, application/problem+json" };

type Hop = { url: string; headers: Headers; method: string };

/** What the router hands the forwarder for a path: its segments after `/v1`. */
function segmentsOf(path: string): string[] {
  return path.replace(/^\/v1\//, "").split("/");
}

function identityReturning(hops: Hop[]) {
  return createUpstreamForwarder({
    identityUrl: "https://identity.test",
    billingUrl: "https://billing.test",
    // NOT `async`, and the seam is typed as returning a promise, so each exit
    // produces one explicitly. See `recordingFetch` in `src/lib/upstream.test.ts`
    // for the same stub in its own file, and the comment on it.
    fetchImpl: (input, init) => {
      const request = new Request(input, init);
      hops.push({
        url: request.url,
        headers: request.headers,
        method: request.method,
      });

      // The start leg is a 302 that sets the state cookie; the callback is a
      // 200 with the session. They are different bodies and this stub has to tell
      // them apart, which is the same thing identity's own handler does.
      if (request.url.includes("/callback")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "tok_social", expires_at: "2026-10-01T00:00:00Z" }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "__Host-session=tok_social; Path=/; Secure; HttpOnly",
            },
          }),
        );
      }
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://github.com/login/oauth/authorize?client_id=x",
            "set-cookie": "__Host-oauth-state=st_1; Path=/; Secure; HttpOnly",
          },
        }),
      );
    },
  });
}

/**
 * The round trip, walked with the FORWARDER the route delegates to.
 *
 * The route builds its own forwarder from the environment, so this cannot inject
 * a transport into it. What it CAN do — and what matters — is walk the two legs
 * through a forwarder configured the same way and assert the shape of the hop
 * the callback makes, which is the thing the route's delegation has to
 * reproduce: the same path, the same declared query, and the cookie the start
 * leg set.
 */
async function walkRoundTrip(): Promise<Hop[]> {
  const hops: Hop[] = [];
  const forward = identityReturning(hops);

  const start = await forward(
    new Request("https://parlor.test/v1/auth/oauth/github", { headers: { accept: "text/html" } }),
    ["auth", "oauth", "github"],
  );

  const stateCookie = start.headers.getSetCookie()[0];
  expect(start.status, "the start leg is a redirect the browser follows").toBe(302);
  expect(stateCookie, "the start leg is the leg that sets the state cookie").toContain(
    "__Host-oauth-state=st_1",
  );

  await forward(
    new Request(
      "https://parlor.test/v1/auth/oauth/github/callback?code=the-code&state=st_1",
      { headers: { accept: "application/json, application/problem+json", cookie: stateCookie } },
    ),
    ["auth", "oauth", "github", "callback"],
  );

  return hops;
}

describe("a document navigation to the callback", () => {
  it("defers to the router's own render", async () => {
    const next = vi.fn(() => ({ isNext: true as const }));

    await handler({
      request: new Request("https://parlor.test/v1/auth/oauth/github/callback?code=c&state=st_1", {
        headers: DOCUMENT_HEADERS,
      }),
      params: { provider: "github" },
      next,
    });

    // The mechanism matters as much as the outcome: a handler that returned
    // `undefined` instead of calling `next()` would leave the chain with no
    // response at all, and the person would get nothing rather than a page.
    expect(next).toHaveBeenCalledOnce();
  });

  it("spends nothing, because the page's own request is not the exchange", async () => {
    // The whole reason this route exists in this shape, and the assertion is on
    // the RETURNED VALUE rather than on a spy over `fetch`.
    //
    // A spy cannot work here, and that is worth saying because a test that
    // cannot fail is worse than no test: `createUpstreamForwarder` resolves
    // `options.fetchImpl ?? fetch` ONCE, when the forwarder is constructed, so a
    // later `globalThis.fetch = …` is invisible to it and a spy would record zero
    // hops whether the branch forwarded or not. The first version of this test
    // did exactly that and passed against a handler that forwarded on every
    // request.
    //
    // What is left is stronger anyway: the handler's answer to a document is the
    // very object `next()` returned. A branch that also forwarded would return
    // the forwarder's `Response` — 502, since nothing is reachable here — and
    // identity is what distinguishes them.
    const nextResult = { isNext: true as const };
    const next = vi.fn(() => nextResult);

    const result = await handler({
      request: new Request("https://parlor.test/v1/auth/oauth/github/callback?code=the-code&state=st_1", {
        headers: DOCUMENT_HEADERS,
      }),
      params: { provider: "github" },
      next,
    });

    expect(next).toHaveBeenCalledOnce();
    expect(result).toBe(nextResult);
    expect(result, "a forwarded answer would be a Response, not the router's next result").not.toBeInstanceOf(
      Response,
    );
  });
});

describe("a programmatic request to the callback", () => {
  it("is delegated to the forwarder rather than rendered", async () => {
    // The other half of the asymmetry: this URL is still the forwarder's for
    // every caller that is not a browser address bar. `completeSocialLogin`
    // parses the body of this response, so rendering a page instead would break
    // the only caller this app has.
    const next = vi.fn(() => ({ isNext: true as const }));

    const result = await handler({
      request: new Request("https://parlor.test/v1/auth/oauth/github/callback?code=the-code&state=st_1", {
        headers: JSON_HEADERS,
      }),
      params: { provider: "github" },
      next,
    });

    expect(next).not.toHaveBeenCalled();
    // Not a Response here: with no reachable identity the forwarder answers its
    // own 502, which is the property that matters — it is a failure and not a
    // page, and it is the forwarder's failure rather than this route's.
    expect(result).toBeInstanceOf(Response);

    // The address is pinned closed at the top of this file, so a 502 here means
    // the forwarder reached its transport and it refused. Anything else means
    // the delegation did not happen as designed — and the extra assertions below
    // say WHICH, because a bare status is what made this subtest point at the
    // allow-list when the real cause was a live identity answering its own 404.
    const response = result as Response;

    // A body this app wrote, as opposed to one relayed from an upstream. A
    // relayed answer carries identity's `trace_id`; the forwarder's own failures
    // — `problem()` in `src/lib/upstream.ts` and `notFound()` in the route
    // handler — do not. This is the discriminator that separates "the delegation
    // worked and identity answered" from "the delegation worked and the
    // forwarder refused", and it is asserted rather than left to a reader: it is
    // the assertion whose absence is why a live identity's 404 read here as a
    // missing allow-list entry.
    const body = await response.text();
    expect(body, "no upstream's trace_id in a forwarder-authored answer").not.toContain("trace_id");
    expect(
      response.headers.get("cache-control"),
      "both of the forwarder's own failures are no-store",
    ).toBe("no-store");

    expect(response.status).toBe(502);
  });
});

describe("the path this app builds and the path the table serves", () => {
  it("agrees, for the provider this app offers", async () => {
    // Two files know this path: `socialCallbackPath` in `src/lib/social.ts`, which
    // builds what the browser and the client ask for, and the `ROUTES` table in
    // `src/lib/upstream.ts`, which decides whether anything is forwarded at all.
    // They are separate by construction — one is a screen's URL and the other is
    // the security property of the deployment — so nothing makes them agree except
    // a test that asks. A path the table refuses is a callback that renders this
    // app's own 404 while a person waits to be signed in.
    //
    // THE SEGMENTS COME FROM THE URL rather than being written out beside it,
    // which is the only version of this that can fail. A first version passed the
    // segments as a literal and asserted on the hop the forwarder built FROM those
    // segments, so a `socialCallbackPath` that spelled the last segment wrongly
    // passed: the forwarder never saw the URL, and the hop it built agreed with
    // itself. Deriving one from the other is what makes the two files comparable.
    const hops: Hop[] = [];
    const forward = identityReturning(hops);
    const path = socialCallbackPath("github");

    const response = await forward(
      new Request(`https://parlor.test${path}?code=the-code&state=st_1`, { headers: JSON_HEADERS }),
      segmentsOf(path),
    );

    expect(response.status, `${path} is not a route the table serves`).toBe(200);
    expect(hops).toHaveLength(1);
    expect(hops[0].url).toContain("/v1/auth/oauth/github/callback");
  });

  it("refuses a provider name that is not a name at all", async () => {
    // The screen accepts whatever the URL says and the TABLE decides. A callback
    // for `..%2Fme` reaches the forwarder, which rebuilds the path from its own
    // shapes rather than forwarding what it was handed — so a traversal is not
    // filtered here, it is not expressible.
    const hops: Hop[] = [];
    const forward = identityReturning(hops);

    const response = await forward(
      new Request("https://parlor.test/v1/auth/oauth/..%2Fme/callback?code=c&state=st_1", {
        headers: JSON_HEADERS,
      }),
      ["auth", "oauth", "..%2Fme", "callback"],
    );

    expect(response.status).toBe(404);
    expect(hops, "refused before an address is contacted").toHaveLength(0);
  });
});

describe("the round trip, walked through the forwarder", () => {
  it("makes the callback present the cookie the start leg set", async () => {
    const hops = await walkRoundTrip();

    const callback = hops[1];
    expect(callback.url).toContain("/v1/auth/oauth/github/callback");
    expect(
      callback.headers.get("cookie"),
      "identity refuses a callback that does not carry the state cookie, and the symptom is a 400 that says the flow never started",
    ).toContain("__Host-oauth-state=st_1");
  });

  it("carries the code and the state, and nothing the caller added", async () => {
    const hops = await walkRoundTrip();

    const url = new URL(hops[1].url);
    expect(url.searchParams.get("code")).toBe("the-code");
    expect(url.searchParams.get("state")).toBe("st_1");
  });

  it("makes exactly two requests: the start and the exchange", async () => {
    // The count is the property. A third hop for the callback URL is a second
    // attempt at a one-shot code, and it fails in a way that reads to a person
    // as "this did not work".
    const hops = await walkRoundTrip();

    expect(hops).toHaveLength(2);
    expect(hops.filter((hop) => hop.url.includes("/callback"))).toHaveLength(1);
  });
});

describe("what the route must not have become", () => {
  it("names no service address in the route's own source", () => {
    // The forwarder is a server-only module, and this route imports it for the
    // server handler. If this file were reachable from a component, the import
    // graph would pull a service address into the browser. `Accept` sniffing is
    // the only thing on the client side of this boundary.
    expect(ROUTE_SOURCE).not.toContain("IDENTITY_URL");
    expect(ROUTE_SOURCE).not.toContain("BILLING_URL");
    expect(ROUTE_SOURCE).toContain("isDocumentNavigation");
  });

  it("does not reach for a second answer of its own on a document", () => {
    // A document navigation that both rendered AND returned a Response would be
    // the double-delivery this route exists to prevent, in the shape that is
    // easiest to write by accident. The handler's whole document branch is one
    // expression.
    const documentBranch = ROUTE_SOURCE.slice(
      ROUTE_SOURCE.indexOf("isDocumentNavigation(request)"),
      ROUTE_SOURCE.indexOf("forwardGet(request"),
    );
    expect(documentBranch).toContain("next()");
    expect(documentBranch).not.toContain("forwardGet(request");
  });
});