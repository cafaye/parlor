/**
 * Social sign-in, end to end, against a REAL identity process and a REAL provider
 * at the far end of the wire.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS THE ONLY ONE OF ITS KIND IN THIS REPOSITORY
 * ---------------------------------------------------------------------------
 * Social login had never been run here. Every other test of the path — in this
 * repository, in `identity`, in `site` — stubs the upstream inside identity's own
 * package with an `httptest` server. That is the right way to test identity's
 * client, and it is structurally incapable of testing a DEPLOYMENT, because the
 * one thing a deployment gets wrong is not in identity's code at all.
 *
 * It is `OAUTH_REDIRECT_BASE_URL`. identity builds every provider callback from
 * that value and never from the request's `Host` — deliberately, so an attacker
 * cannot choose where a code is delivered (`oauth.Provider.RedirectURI` says so).
 * The consequence is that a deployment pointing it at identity's own address is
 * not obviously broken: the authorize leg works, the provider round trip
 * completes, the code is exchanged, the userinfo call lands, identity mints a
 * session — and the session cookie is set on an origin the app is not on, so the
 * person is not signed in. No unit test in any repository can see that, because
 * the stub is handed the redirect URI identity computed and answers to it.
 *
 * Here the browser goes to the real thing: click, bounce off a real provider,
 * come back through a real callback route, and end up signed in on the app's own
 * origin. If `OAUTH_REDIRECT_BASE_URL` were wrong, this file fails. That is the
 * whole return on the packet.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DIFFERENT HERE FROM `site`'s COPY OF THIS PATH, and why
 * ---------------------------------------------------------------------------
 * The three tests are the same three behaviours and the reasoning comments are
 * carried over, because a comment that records WHY a line exists is the part a
 * future reader needs. The assertions are not the same, and the differences are
 * not accidents:
 *
 *   * **There is no `/account` route in this repository.** `site` has one and
 *     asserts on it. `parlor`'s signed-in landing screen is `/` and its tenancy
 *     screen is `/accounts`, so the URL assertion is on `/` and the session is
 *     read out of the HEADER. Writing `/account` here would be writing a route
 *     this app does not render — the assertion would fail on a locator error
 *     that says nothing about the session, which is the exact failure mode
 *     `session.e2e.spec.ts` records for a page-wide locator.
 *   * **The LINK outcome's copy is this app's.** `parlor` renders "That provider
 *     is now linked" and says the person "are still signed in as you were — no
 *     new session was created" (`SocialCallbackScreen`, the `linked` landing).
 *     `site` says something else. Asserting the other's sentence would assert a
 *     product this repository deliberately does not have.
 *   * **The browser is on the EDGE, and the whole flow hangs off that.** The
 *     edge is what gives the browser one origin for the app and for `/v1/*`, so
 *     `OAUTH_REDIRECT_BASE_URL` is the edge's published port. A spec that
 *     pointed at `parlor`'s own port would be testing a second topology that
 *     this tier does not run.
 *
 * ---------------------------------------------------------------------------
 * EVERY ASSERTION IS ON RENDERED TEXT, and there is not one
 * `expect(response.status()).toBe(200)` here
 * ---------------------------------------------------------------------------
 * The same discipline as `session.e2e.spec.ts`, for the same reason. A test that
 * asserts an API returned 200 while the page shows an error has tested nothing,
 * and this path has an unusually large number of ways to be 200-and-broken: the
 * authorize leg redirecting to an origin the browser cannot resolve; the
 * `__Host-oauth-state` cookie dropped so the callback refuses its own CSRF check;
 * the exchange run twice on a spent code; a provider answering 200 with an
 * address nobody verified. Each of those produces HTTP the whole way through and a
 * person staring at a sentence that says nothing was signed in.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS, NO SKIPS, AND NEITHER WILL BE ADDED
 * ---------------------------------------------------------------------------
 * There is no `waitForTimeout`. Every wait is `expect(...).toBeVisible()` or
 * `toHaveURL()`, which re-poll until the condition holds or the expect timeout
 * expires. A sleep is a flake waiting for a bad day, and a suite that gets
 * blamed for one has its assertions loosened to "fix" it.
 *
 * There is also no `test.skip` and no `test.fixme`, and `bin/e2e` reads the JSON
 * report and fails the run if fewer than the declared floor of tests passed or if
 * any test was skipped. A green exit code with nothing in it is a failure, not a
 * pass — see `tests/assert-e2e-ran.mjs` and the global teardown.
 *
 * ---------------------------------------------------------------------------
 * THE PROVIDER'S ADDRESS IS NOT IN THIS FILE, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * No URL, no port, no host for the fake IdP appears below. The browser arrives
 * there because identity's own start leg sent a 302 whose `Location` came out of
 * `OAUTH_GOOGLE_AUTHORIZE_URL` — deployment configuration this repository does
 * not own and must not restate. A spec that hardcoded the provider's address
 * would be measuring its own constant, and would keep passing on a deployment
 * that pointed the authorize URL somewhere nobody is listening.
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * The session header, as a locator.
 *
 * Scoped through here for the reason `session.e2e.spec.ts` gives, and that file
 * hit it twice: the pages carry links with the same names as the header's, so a
 * page-wide `getByRole("link", { name: "Sign in" })` is ambiguous on exactly the
 * pages where the header matters most, and the failure it produces is a locator
 * error rather than a statement about the session.
 */
const header = (page: Page) => page.getByRole("banner");

/**
 * A password that satisfies identity's own floor with room to spare — the same
 * value and the same reasoning as `session.e2e.spec.ts`, restated rather than
 * imported so this file does not acquire a dependency on another spec.
 */
const PASSWORD = "the harness is not a test of password strength";

/**
 * The address the fake provider minted, as it must appear in the header.
 *
 * **NOT A CONSTANT, AND THAT IS LOAD-BEARING.** identity refuses a social
 * sign-in for an address that already has an account here (`ErrSocialEmailInUse`,
 * a 409), so a fixed fixture address would make the second run of this file fail
 * on a collision rather than on anything real. The fake mints a fresh address per
 * authorization and the app shows it back, so this asserts a SHAPE rather than a
 * value — which is also the stronger claim: nothing but the fake's userinfo can
 * produce an address of this shape, so matching it proves the provider's identity
 * document arrived through the exchange, a session and a `/v1/me`, and that the
 * account on screen belongs to the person who clicked the button.
 *
 * The shape is the published repository's: `social-<16 hex>@<domain>`, from
 * oauth-stub's userinfo handlers. It is a shape rather than a value precisely
 * because it is read out of a repository this one may not modify — if the double
 * changes its minting, the pin in `bin/e2e-stack` moves with it and this line
 * moves with the pin.
 */
const MINTED_ADDRESS = /^social-[0-9a-f]{16}@example\.test$/;

/** The address the header is showing, which is the only one a person can read. */
function theAddressInTheHeader(page: Page) {
  // The header renders the signed-in person's address beside "Sign out"
  // (`src/components/shell/header.tsx` passes `session.user.email` through),
  // which is why this is the locator: it is the same element
  // `session.e2e.spec.ts` already asserts the password path through, so a failure
  // here is about the social path and not about a locator nobody has run before.
  return header(page).getByText(MINTED_ADDRESS);
}

/**
 * Signs in with a provider, the way a person does, and waits for the landing
 * screen.
 *
 * Four documents and one address bar changing: `/login`, the start route on this
 * origin, the provider's authorize endpoint, and the callback route back here.
 * There is nothing to click on the far side — the fake answers the authorize leg
 * with a 302, as a provider that needs no interaction does — so the only
 * interaction is the one a person makes.
 *
 * `toHaveURL` rather than a wait on the heading, because the URL is what proves
 * the callback landed on the APP's origin and not somewhere else: that is the
 * assertion this whole file exists to make, and asserting it through the URL is
 * the only place it is visible. The landing is `/` and not `/accounts` because
 * `SocialCallbackScreen` navigates to `/` on a minted session
 * (`router.push("/")`) — the same destination the password form uses.
 */
async function signInWith(page: Page, provider: "Google" | "GitHub") {
  await page.goto("/login");
  await page.getByRole("link", { name: `Continue with ${provider}` }).click();
  await expect(page).toHaveURL(/\/v1\/auth\/oauth\/(google|github)\/callback\?/);
  // The callback route renders a page and then forwards ONE programmatic request
  // to identity (`social-callback-screen.tsx`, "WHY THE ROUTE SERVES THE PAGE
  // AND DOES NOT DO THE EXCHANGE"). So the heading is visible before the exchange
  // has happened, and the navigation to `/` is what says it finished.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Signing you in");
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
}

test.describe("social sign-in, against a real identity and a real provider", () => {
  /**
   * THE HEADLINE. A person clicks "Continue with Google", is bounced through a
   * provider that really is not us, lands back on the app's own origin and is
   * signed in.
   *
   * Four things have to be true at once for this to pass, and each is a
   * deployment fact rather than a unit-testable one:
   *
   *   * `OAUTH_REDIRECT_BASE_URL` is the origin the BROWSER is on — the edge's —
   *     so the `__Host-oauth-state` cookie set on the start 302 is the cookie the
   *     callback's top-level GET navigation sends back, and the callback lands on
   *     a route that exists here;
   *   * the state cookie survives that navigation, which is what `SameSite=Lax` is
   *     for and what `Strict` would break;
   *   * the code is spent exactly once, by the single request the callback page
   *     makes — the fake refuses a replay, so a double exchange fails here rather
   *     than passing;
   *   * the provider's identity document reaches `/v1/me` intact, address and all.
   */
  test("a person signs in with Google and reaches a screen that needs a session", async ({
    page,
  }) => {
    await signInWith(page, "Google");

    // The session is real, and this is the assertion that would fail if
    // `OAUTH_REDIRECT_BASE_URL` pointed anywhere but here: the cookie would have
    // been set on another origin, this header would render signed-out, and every
    // other assertion in the tier would still have passed.
    await expect(header(page).getByRole("button", { name: "Sign out" })).toBeVisible();

    // And the account on screen belongs to the person who clicked the button: an
    // address of the fake's shape, which nothing else in this stack can produce.
    await expect(theAddressInTheHeader(page)).toBeVisible();

    // A full document load, so the token is read back out of `localStorage` and
    // `["session", token]` is what makes the header render as this person rather
    // than as nobody. `session.e2e.spec.ts` proves the same property for the
    // password path; this proves it for the path where the token arrived in a
    // redirect's response and was adopted by `adoptSession`, because the code was
    // spent getting it and cannot be fetched again.
    await page.reload();
    await expect(header(page).getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(theAddressInTheHeader(page)).toBeVisible();
  });

  /**
   * GitHub, which is a DIFFERENT provider and not a flag on the same one.
   *
   * It gets its own test because it fails differently, and in two ways that are
   * about the service rather than about a screen. GitHub's token endpoint is
   * `/access_token` and answers `application/x-www-form-urlencoded`, where
   * Google's answers JSON — and `golang.org/x/oauth2` picks its parser from the
   * Content-Type, so this is the only path in the tier where that branch runs
   * against a server that gets it right. Its identity endpoint returns
   * `"email": null` for a private address, which is why identity dials
   * `EmailsURL` as a second call: `githubIdentity` only falls back when `/user`
   * returns an empty address, and the fake deliberately serves the null that
   * forces it. It also reports `id` as a number where Google's `sub` is a string,
   * and identity's column is text, so the coercion is exercised rather than
   * skipped.
   *
   * A single server behind one flag would have passed both of these while testing
   * one provider twice. So the stack runs TWO instances of the stub — see the
   * `oauth-stub` and `oauth-stub-github` blocks in e2e/docker-compose.yml, where
   * the other two answers (loosening the credential check, or pointing identity
   * at the stub's defaults) are argued and rejected.
   */
  test("a person signs in with GitHub, through the second address call", async ({ page }) => {
    await signInWith(page, "GitHub");

    await expect(header(page).getByRole("button", { name: "Sign out" })).toBeVisible();
    // Same shape as Google's, and minted separately: the two providers are
    // separate authorizations with separate accounts, so an address shared between
    // them would mean the fake handed out one person twice.
    await expect(theAddressInTheHeader(page)).toBeVisible();
  });

  /**
   * THE LINK PATH, and the cookie that decides it.
   *
   * This is the one behaviour in the surface that a stub cannot test at all, and
   * it is a security property rather than a feature. The callback must not decide
   * whether it is signing somebody in or attaching a provider identity to the
   * account they are already signed in as BY LOOKING AT THE SESSION COOKIE: a
   * browser holding a session presents it on the callback whether or not this flow
   * is the reason it holds one, and any page can cause a top-level GET of the
   * start route — so deciding from ambient cookie state would let a cross-site
   * link turn an attacker's provider account into a credential on the victim's
   * account.
   *
   * So the start route records what it saw in a second `HttpOnly` cookie the
   * browser will not let a page read or write, and the callback honours the
   * record. This test walks the path that record produces: a person who already
   * has an account here, signed in, attaches a provider — and gets a response with
   * no token in it, because linking is not signing in and this service does not
   * mint a second session because somebody completed a third-party round trip.
   *
   * The assertion is the pair, and neither half is sufficient alone: the callout
   * proves the link path was taken, and the still-signed-in header carrying THE
   * SAME ADDRESS proves the round trip did not quietly sign the person in as
   * somebody else on the way.
   */
  test("a person signed in already attaches a provider instead of being signed in", async ({
    page,
  }) => {
    // An account here first, with a password, because that is what makes the flow
    // a LINK rather than a sign-in: there is somebody to attach to. `example.test`
    // is reserved by RFC 6761 and can never be a real mailbox.
    const email = `e2e-link-${crypto.randomUUID()}@example.test`;
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // ---------------------------------------------------------------------------
    // REGISTERING DOES NOT SIGN YOU IN, AND THAT IS NOT A BUG IN THE SCREEN
    // ---------------------------------------------------------------------------
    // `register-form.tsx` reports the account and then says what it did and did
    // not do, with the address first on every branch: "Account created for
    // {email}. This deployment cannot send email right now, so no verification
    // link was sent." **No deployment signs somebody in by registering**, and that
    // is the point of email verification — an account nobody has proved is not a
    // session. A test that assumes otherwise is asserting a product this
    // repository deliberately does not have, and it fails UPSTREAM of the link
    // path it exists to test, so the one social behaviour a stub cannot test would
    // never be reached.
    //
    // So the session is established the way a person establishes one, and the
    // assertion below is on the HEADER rather than on a URL: "the button says Sign
    // out" is also what a shell rendering optimistically looks like, so the
    // address is the thing worth reading.
    await expect(page.getByText(`Account created for ${email}`)).toBeVisible();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(header(page).getByText(email, { exact: true })).toBeVisible();

    // Now attach a provider, from a screen this person is already signed in on.
    // `/login` rather than an account screen because `SocialProviderButtons` is
    // rendered by both `/login` and `/register` and this is where the session is
    // demonstrably present; the flow does not care which screen the button was
    // pressed on, and that is worth not assuming.
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Google" }).click();

    // NO `toHaveURL("/")` HERE, AND ITS ABSENCE IS THE POINT.
    //
    // `SocialCallbackScreen` navigates on exactly one outcome — a minted session —
    // and returns nowhere for any other, because every other outcome is a sentence
    // a person has to be able to READ: a decline and a service failure both have
    // something to say, and navigating away would replace that sentence. The link
    // outcome is one of those, and it renders a callout on this page.
    //
    // Measured on a real stack, that IS what the round trip produces: the header
    // still carrying this person's address and a Sign out button, next to a callout
    // saying nothing was connected. So a URL assertion would not be a weaker
    // version of the same claim — it would be a different claim, one the screen does
    // not make, and one that would fail on a correct implementation.
    //
    // What replaces it is the callout itself, in full and naming the provider,
    // which is strictly more than a bare URL was: it proves the link outcome AND
    // that it was Google's round trip.
    await expect(
      page.getByText(
        "Your google account is attached to the account you were already signed in to. You are still signed in as you were — no new session was created.",
      ),
    ).toBeVisible();
    await expect(page.getByText("That provider is now linked")).toBeVisible();

    // STILL the same person, at the SAME address. If the round trip had minted a
    // session instead of linking, the header would show a Sign out for a DIFFERENT
    // account and this assertion would be reading the wrong address — which is why
    // it is the registered address and not merely "some address".
    await expect(header(page).getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(header(page).getByText(email, { exact: true })).toBeVisible();
  });
});