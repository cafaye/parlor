/**
 * The password-reset surface, in a real browser, against a real identity.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE PROVES SOMETHING THE UNIT TIER CANNOT
 * ---------------------------------------------------------------------------
 *
 * `src/app/forgot-password/page.test.tsx` and
 * `src/app/reset-password/page.test.tsx` both assert the anti-enumeration
 * property against a STUB. A stub is the right place to prove what a screen does
 * with a status it was handed. It cannot prove the service hands out that status,
 * and the two halves of this property live on opposite sides of the socket:
 *
 *   * the service answers a CONSTANT `202 {"status":"accepted"}` for a
 *     registered address, an unregistered one, and one inside the cooldown; and
 *   * the screen renders one sentence for all three.
 *
 * Either half alone is a screen that might be an account-existence oracle. Here
 * both halves come from the same identity build these other specs sign in
 * against, over HTTP.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TWO TESTS ARE ACTUALLY ABOUT, AND IT IS NOT THE HAPPY PATH
 * ---------------------------------------------------------------------------
 *
 * **This stack has no courier.** `e2e/docker-compose.yml` does not run it, and
 * identity's `buildMailer` returns `recovery.Unavailable{}` when
 * `COURIER_BASE_URL` is unset, which logs a warning and makes
 * `POST /v1/password-resets` answer **503**. That is not a gap in this file — it
 * is the subject of it.
 *
 * A 503 is the one failure on this route that is safe to render distinctly, and
 * the reason is in identity's contract: the mailer is checked BEFORE the address
 * is looked up, so "503 against 202" cannot become an existence oracle. The
 * consequence on this side is equally concrete — the screen MUST NOT say "check
 * your inbox", because no mail is coming and a person told to wait for one waits
 * forever. So the assertion below is a negative one: the 503 sentence appears,
 * and the acceptance sentence does not. It is the same security property as the
 * login refusal spec, pointed at the other screen.
 *
 * The second test spends a token that never existed, which is the 404 branch of
 * `ErrTokenNotFound` and the failure a person hits most often after they let a
 * link go stale. It proves two things a stub cannot: that a real identity
 * really does answer 404 for a token it has never seen, and that the screen's
 * "ask for a new one" path renders rather than leaving a form that could only
 * ever fail again.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 *
 * **A completed reset.** Proving it needs a real token, and a real token needs
 * a real mail, and this stack has no courier. Minting one by writing to the
 * database from a test would be a test that proves the harness can insert a row.
 * That flow is covered in the unit tier against the shapes transcribed from
 * `identity/internal/httpapi/recovery.go`, and what is missing here is stated in
 * the packet report rather than faked.
 *
 * **Email verification.** identity's `RequestVerification` needs a session and
 * the verification link, and parlor has no unverified state to render one from.
 * See the packet report: there is nothing to build there yet, so there is
 * nothing to assert.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS, NO SKIPS
 * ---------------------------------------------------------------------------
 *
 * Every wait is Playwright's own auto-waiting assertion. There is no
 * `waitForTimeout` and no `test.skip` in this file, and `tests/validate-ci.sh`
 * fails the build if either appears anywhere in `e2e/`.
 */
import { expect, test } from "@playwright/test";

/** A password satisfying identity's `MinPasswordLength`, for the 422 branch. */
const PASSWORD = "the harness is not a test of password strength";

/**
 * A token that has never existed.
 *
 * The shape is a real 256-bit base62 token, because the point is not that this
 * string is invalid — it is that identity has never heard of it, which is one of
 * the four cases behind its single `ErrTokenNotFound`. A deliberately malformed
 * value would be refused by the same 404 for a different reason, and would
 * prove less.
 */
const NEVER_MINTED = "0Kq3Zs1oQw7bXn0K9dLpR2vT4yE6hJ8cF1gM5nA2qU0";

function aFreshAddress(): string {
  return `e2e-${crypto.randomUUID()}@example.test`;
}

/**
 * The alert region, scoped to `main`.
 *
 * Next.js renders its own `role="alert"` route announcer outside the page, and
 * `session.e2e.spec.ts` hit exactly that: a page-wide locator matched the
 * announcer, `toBeVisible()` passed against an element with no text, and the
 * failure read as a screen that reported nothing. The scoping is the fix and it
 * belongs in every spec in this tier.
 */
const alertIn = (page: import("@playwright/test").Page) =>
  page.getByRole("main").getByRole("alert");

test("asking for a reset link never promises a mail this deployment cannot send", async ({
  page,
}) => {
  await page.goto("/forgot-password");

  // The affordance exists on the screen that asks, and the screen names itself.
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();

  await page.getByLabel("Email").fill(aFreshAddress());
  await page.getByRole("button", { name: "Send reset link" }).click();

  // A real identity, over a socket, with no courier configured, answers 503 —
  // `recovery.Unavailable{}` reaching `writeRecoveryError`'s `ErrNoMailer`
  // branch. The screen must render THAT and not the acceptance sentence.
  //
  // The assertion that matters is the second one. The service checks the mailer
  // before it looks the address up, so a screen that said "check your inbox" here
  // would be safe against enumeration and useless to every person who reads it:
  // no message was sent, and none is coming.
  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("cannot send email");
  await expect(alert).not.toContainText("on its way");

  // And the form is still there, because retrying is the actual next step for a
  // deployment that gets its courier configured.
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeEnabled();
});

test("a link that cannot be used says so and offers a new one, for a real 404", async ({
  page,
}) => {
  await page.goto(`/reset-password?token=${NEVER_MINTED}`);

  // It does not redeem on load, so the form is what the link lands on — a mail
  // client or link scanner fetching this URL must not spend the token.
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();

  // `exact: true` on the first one, and it is the second label that makes it
  // necessary: Playwright's `getByLabel` matches substrings by default, so
  // "New password" also matches "Confirm new password" and the locator resolves
  // to two elements. A strict-mode violation is the right outcome for an
  // ambiguous locator, but this one is fixable rather than worth keeping.
  await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();

  // A real identity answers 404 for a token it has never seen, expired, spent,
  // or minted for another flow — one sentinel, four cases, and no way for a
  // client to tell them apart.
  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("cannot be used");

  // Never "expired". Naming it would tell anybody probing tokens that the one
  // they held had once been a good one, which turns a guess into a probe.
  await expect(alert).not.toContainText("expired");

  // And the way forward is a real control that goes somewhere real.
  const again = page.getByRole("button", { name: "Request a new link" });
  await expect(again).toBeVisible();
  await again.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
});

test("a link with no token explains itself rather than rendering a form that cannot work", async ({
  page,
}) => {
  // `RECOVERY_LINK_TEMPLATE` is deployment configuration. A deployment can point
  // it at a path segment instead of `?token=`, and then this page is what a
  // person arrives at with nothing to redeem. It has to say so.
  await page.goto("/reset-password");

  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("missing its reset code");
  await expect(page.getByLabel("New password")).toHaveCount(0);
});

test("the sign in screen offers the way out, and nothing about it leaks an address", async ({
  page,
}) => {
  await page.goto("/login");

  // Rendered unconditionally rather than after a failed attempt. A link that
  // appeared only once the form had refused you would be saying something about
  // the address, and this is the one screen that must never say it.
  const forgot = page.getByRole("main").getByRole("link", { name: /forgot your password/i });
  await expect(forgot).toBeVisible();

  await forgot.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("an address that has no account and one that does are answered identically", async ({
  page,
}) => {
  // The security control for this surface, and the reason the 202 constant in
  // identity exists at all. In this stack both addresses get the same 503,
  // because the mailer is checked first — so the stronger claim this file can
  // make is the one about the screen: whatever the service said, the rendering
  // is byte-identical.
  //
  // Registering one of the two is what makes the pair meaningful: without a real
  // account on one side, "both got the same answer" would also be true of a
  // screen that never asked anybody anything.
  await page.goto("/register");
  const registered = aFreshAddress();
  await page.getByLabel("Email").fill(registered);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  const askFor = async (address: string) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Send reset link" }).click();
    const alert = alertIn(page);
    await expect(alert).toBeVisible();
    return alert.innerText();
  };

  const forRegistered = await askFor(registered);
  const forUnknown = await askFor(aFreshAddress());

  expect(
    forRegistered,
    "a reset request must not distinguish an address that has an account",
  ).toBe(forUnknown);
  // Neither rendering may echo the address back, which would confirm it exists
  // whatever the service's status code was.
  expect(forRegistered).not.toContain(registered);
});