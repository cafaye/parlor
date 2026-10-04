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

import { Route } from "./callback";

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
  next(): { isNext: true };
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

function identityReturning(hops: Hop[]) {
  return createUpstreamForwarder({
    identityUrl: "https://identity.test",
    billingUrl: "https://billing.test",
    fetchImpl: async (input, init) => {
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
        return new Response(JSON.stringify({ token: "tok_social", expires_at: "2026-10-01T00:00:00Z" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "__Host-session=tok_social; Path=/; Secure; HttpOnly",
          },
        });
      }
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://github.com/login/oauth/authorize?client_id=x",
          "set-cookie": "__Host-oauth-state=st_1; Path=/; Secure; HttpOnly",
        },
      });
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
    } as never);

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
    } as never);

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
    } as never);

    expect(next).not.toHaveBeenCalled();
    // Not a Response here: with no reachable identity the forwarder answers its
    // own 502, which is the property that matters — it is a failure and not a
    // page, and it is the forwarder's failure rather than this route's.
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(502);
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