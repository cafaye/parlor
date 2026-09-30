/**
 * The whole stack, seen from a browser: what an operator sees when they ask each
 * service whether it is ready, and what a caller sees when they arrive at the
 * gateway with nothing to prove who they are.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SMALLER THAN THE BRIEF ASKED FOR
 * ---------------------------------------------------------------------------
 * The packet names `parlor → guard → identity` as the path to prove, and says so
 * for a good reason: three processes and three trust boundaries is exactly what a
 * unit test inside one repository cannot see. It is worth being precise about
 * which parts of that chain exist in the code today, because guessing at it
 * produced a version of this file that asserted things that are true for the
 * wrong reasons:
 *
 *   * **parlor does not call guard.** `parlor`'s browser client calls identity
 *     directly (`src/lib/identity.ts`, base URL from `NEXT_PUBLIC_IDENTITY_URL`),
 *     and guard's BFF surface answers `/auth/register`, `/auth/login`,
 *     `/auth/logout` and `/auth/me` — four different paths with a cookie and no
 *     token in the body. There is no configuration in which one is a drop-in for
 *     the other, so there is no page in this app whose traffic passes through
 *     the gateway.
 *   * **The session token cannot reach guard's `/v1/*`.** Those routes want an
 *     RS256 JWT verified against identity's JWKS. What the sign-in form gets is
 *     identity's opaque session token. There is no exchange for it: minting a
 *     JWT means registering an OIDC client as an account owner and running the
 *     authorization-code flow, which is a different packet with its own fixtures.
 *   * **identity publishes no key set in this stack.** Its config refuses to boot
 *     unless `OIDC_ISSUER`, `OIDC_SIGNING_KEY` and `OIDC_SIGNING_KEY_ID` are all
 *     set or all unset, and the issuer has to be https. Turning OIDC on for a
 *     test fixture would mean an https origin and a PEM key checked into a test
 *     harness, which is worse than not having one.
 *
 * So this file asserts the two hops that are real, and the packet report says
 * which hop is missing and why. A test that cannot be true is worse than a test
 * that is smaller: it either fails for a reason nobody can act on, or it passes
 * for a reason nobody can find.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND WHY IT IS NOT A NETWORK ASSERTION
 * ---------------------------------------------------------------------------
 * The browser navigates to each endpoint and the assertion is on the text the
 * browser rendered. A JSON body in a page is what the user sees — it is the same
 * bytes a `curl` would print, reached the way a person reaches them, in a real
 * user agent, with a real network stack. The difference from `curl` is not
 * cosmetic: it is that these assertions fail if the service is unreachable, if
 * it answers something else, or if the answer is not renderable — and a
 * readiness endpoint that returns 200 with the wrong body is a failure here and
 * would be a pass in a status-code-only test. AGENTS.md says exactly that about
 * `/readyz` ("a probe that returns 200 with the wrong shape is a failure, not a
 * pass"), and this is the tier that holds every service to it.
 */
import { expect, test, type Page } from "@playwright/test";

import { edgeBaseUrl, guardBaseUrl, identityBaseUrl, parlorBaseUrl } from "../playwright.config";

/** The text of a response, as the browser rendered it. */
const rendered = (page: Page) => page.locator("body");

test("every service in the stack reports itself ready, from the outside", async ({ page }) => {
  // The origin a browser actually loads, through the edge. This is the one that
  // matters for a person: the app is reachable *and* the same origin the app's
  // own client is configured to call identity on, which is the configuration
  // fact session.e2e.spec.ts depends on and cannot check directly.
  await page.goto(`${edgeBaseUrl}/readyz`);
  await expect(page).toHaveURL(/\/readyz$/);
  await expect(rendered(page)).toContainText('"status":"ok"');

  // The app itself, on its own published port, so "the edge can reach it" and
  // "it is up" are two facts and not one. Two because they fail for two
  // reasons: a bad route in the proxy, and a process that is not answering.
  //
  // Note what this does NOT prove: parlor's /readyz reports `deps: "none"`
  // because nothing has wired a real identity probe into it yet (AGENTS.md,
  // "Health surfaces" — "a real check is its own packet, because a slow identity
  // must not necessarily mean not ready, and that is a decision rather than a
  // default"). A harness that trusted `/readyz` alone would have called this
  // stack ready on the first run, when it was up and could not sign a single
  // person in. session.e2e.spec.ts is what proves the dependency.
  await page.goto(`${parlorBaseUrl}/readyz`);
  await expect(rendered(page)).toContainText('"status":"ok"');

  // identity. Note the shape: `deps` is a *string* here and an object in guard's
  // and parlor's answers. The platform contract fixes the keys (`status`,
  // `deps`) and each service's own manifest fixes its body, so the assertion
  // is on what this service says rather than on one fleet-wide shape — but it
  // is on the exact bytes, because a `/readyz` that returns 200 with the wrong
  // body is a failure and not a pass (AGENTS.md, "Health surfaces"). It names
  // postgres, which means the ping actually reached the database.
  await page.goto(`${identityBaseUrl}/readyz`);
  await expect(rendered(page)).toContainText('"status":"ok"');
  await expect(rendered(page)).toContainText('"deps":"postgres"');

  // guard. This is the three-process hop that exists: guard answered *from
  // inside its own container*, having opened a socket to identity on the compose
  // network and a socket to Redis on the compose network. Both names in this
  // body are the result of a real round trip from another process. Change
  // `IDENTITY_URL` or `REDIS_URL` in e2e/docker-compose.yml and this goes to
  // 503, which is the misconfiguration the packet asked the harness to catch.
  await page.goto(`${guardBaseUrl}/readyz`);
  await expect(rendered(page)).toContainText('"identity":"ok"');
  await expect(rendered(page)).toContainText('"redis":"ok"');
});

test("the gateway refuses a caller that cannot prove who they are", async ({ page }) => {
  // No credential, and no key set to fetch one against. guard's auth gate is
  // mounted on `/v1/*`, so this is answered before anything else happens: a
  // rejected token never reaches the rate limiter, and a rejected token costs no
  // key fetch (guard/AGENTS.md, "The bucket is the strongest identity the
  // request has"). The rendered body is core's problem document, which is the
  // contract `cafaye.yml` and core's conventions fix and which a stubbed test
  // in guard's own suite asserts against a fake identity.
  await page.goto(`${guardBaseUrl}/v1/me`);
  await expect(rendered(page)).toContainText('"status":401');
  await expect(rendered(page)).toContainText('"type"');
});

test("the gateway's browser surface is pointed at this stack's identity", async ({ page }) => {
  // The one assertion in this tier that is API-shaped, and it is here because
  // the surface under test has no page: guard's BFF is a JSON API that a
  // browser form would call. Saying that is more useful than pretending
  // otherwise — the rule "assert on what the user sees" exists to stop a test
  // passing on a 200 that the screen contradicts, and there is no screen here to
  // contradict. What replaces it is a sharper assertion: the status alone cannot
  // tell you guard reached identity, because 401 and 503 are both refusals, and
  // only 401 means "identity answered and said no".
  //
  // So the assertion is the *distinction*, which no test inside one repository
  // can make:
  //
  //   401  guard called identity's POST /v1/session, identity refused, guard
  //        restated it as one generic sentence (guard/src/bff/auth.ts,
  //        `loginRefusal` — and the sentence names no field, or the gateway
  //        would be the account-existence oracle its own source warns about).
  //   503  guard could not reach identity, or identity answered with something
  //        this contract does not cover. A stack that is "up" but misconfigured
  //        produces exactly this, and it is the failure this tier exists for.
  //
  // `page.request` rather than a bare `request` fixture: it shares the browser
  // context's cookie jar and base URL, so the request is made by the same
  // context that loaded the stack. The `Origin` header is what guard's
  // same-origin gate accepts from a client that sends no fetch metadata
  // (`isSameOrigin`, and the comment on it says curl and the test suite state
  // their origin).
  const response = await page.request.post(`${guardBaseUrl}/auth/login`, {
    headers: { origin: guardBaseUrl, "content-type": "application/json" },
    data: {
      email: `e2e-${crypto.randomUUID()}@example.test`,
      password: "a password of a plausible length that was never registered",
    },
  });

  expect(
    response.status(),
    "guard answered 503, which means it could not reach identity in this stack — " +
      "check IDENTITY_URL in e2e/docker-compose.yml and that identity is healthy",
  ).toBe(401);

  // core's problem document, and the sentence is guard's, not identity's. The
  // `type` is asserted as a URN rather than against a literal, because the
  // literal lives in `core` and moves when core moves; the shape and the
  // `detail` are what this file is about.
  const body = await response.json();
  expect(body.status).toBe(401);
  expect(body.code).toBe("unauthorized");
  expect(body.type).toEqual(expect.stringContaining(":"));
  expect(body.detail).toBe("email or password is not correct");
  // And the shape of the gateway's own house style: one sentence, no field
  // errors, nothing from the dependency leaked through.
  expect(body).not.toHaveProperty("errors");
  expect(JSON.stringify(body)).not.toContain("@example.test");
});
