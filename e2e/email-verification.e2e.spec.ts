/**
 * The email-verification surface, in a real browser, against a real identity.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE PROVES SOMETHING THE UNIT TIER CANNOT
 * ---------------------------------------------------------------------------
 *
 * `src/app/verify-email/page.test.tsx` and
 * `src/app/verify-email/confirm/page.test.tsx` assert the anti-enumeration
 * property and the stale-token state against a STUB. A stub is the right place
 * to prove what a screen does with a status it was handed. It cannot prove the
 * service hands out that status, and both halves of each property live on
 * opposite sides of the socket:
 *
 *   * the service answers `503` for a request this deployment cannot mail and
 *     `404` for a token it has never heard of; and
 *   * the screen renders one sentence for each, and the wrong sentence never.
 *
 * Either half alone is a screen that might be an oracle, or a screen that
 * strands somebody. Here both come from the same identity build these other
 * specs sign in against, over HTTP.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE ACTUALLY ABOUT, AND IT IS NOT THE HAPPY PATH
 * ---------------------------------------------------------------------------
 *
 * **This stack has no courier.** `e2e/docker-compose.yml` does not run it, and
 * identity's `buildMailer` returns `recovery.Unavailable{}` when
 * `COURIER_BASE_URL` is unset, which makes `POST /v1/email-verifications` answer
 * **503**. That is not a gap in this file — it is the subject of it, exactly as
 * it is for `password-reset.e2e.spec.ts`.
 *
 * A 503 is safe to render distinctly here for the reason identity's contract
 * gives: `Service.RequestVerification` calls `deliverable` BEFORE it looks the
 * address up, so 503-against-202 cannot become an existence oracle. The
 * consequence on this side is equally concrete — the screen must NOT say a link
 * is on its way, because no message was sent and none is coming.
 *
 * **The 409 is not reachable in this stack and is not asserted.** It needs an
 * account whose address is already proved, which needs a real token, which needs
 * a real mail. Its rendering is covered in the unit tier against the transcribed
 * handler shape, and the residual enumeration question it opens is written up in
 * the packet report rather than papered over here.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 *
 * **A completed verification.** Proving it needs a real token, and a real token
 * needs a real mail, and this stack has no courier — the same wall
 * `password-reset.e2e.spec.ts` documents. Minting one by writing to the database
 * from a test would be a test that proves the harness can insert a row.
 *
 * **A 409.** See above.
 *
 * What IS here is everything a person actually hits when this deployment cannot
 * mail: the request screen refusing to promise a message, the confirmation screen
 * answering a token that never existed, the link that arrives with no code in it,
 * and the register screen refusing to un-say that the account was created when
 * the mail request behind it fails.
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

/** A password satisfying identity's `MinPasswordLength`. */
const PASSWORD = "the harness is not a test of password strength";

/**
 * A token that has never existed.
 *
 * The shape is a real 256-bit base62 token, because the point is not that this
 * string is invalid — it is that identity has never heard of it, which is one of
 * the four cases behind its single `ErrTokenNotFound`. A deliberately malformed
 * value would be refused by a 422 for a different reason and would prove less.
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

test("asking for a verification link never promises a mail this deployment cannot send", async ({
  page,
}) => {
  await page.goto("/verify-email");

  // The screen names itself, so a 503 cannot be read as some other page's failure.
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();

  await page.getByLabel("Email").fill(aFreshAddress());
  await page.getByRole("button", { name: "Send verification link" }).click();

  // A real identity, over a socket, with no courier configured, answers 503 —
  // `recovery.Unavailable{}` reaching `writeRecoveryError`'s `ErrNoMailer`
  // branch. The screen must render THAT and not the acceptance sentence.
  //
  // The assertion that matters is the second one: "a link is on its way" here
  // would be safe against enumeration and useless to every person who reads it,
  // because no message was sent and none is coming.
  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("cannot send email");
  await expect(alert).not.toContainText("on its way");

  // And the form is still there: retrying is the actual next step for a
  // deployment that gets its courier configured.
  await expect(page.getByRole("button", { name: "Send verification link" })).toBeEnabled();
});

test("a verification link that cannot be used says so and offers a new one, for a real 404", async ({
  page,
}) => {
  await page.goto(`/verify-email/confirm?token=${NEVER_MINTED}`);

  // It does not verify on load, so the button is what the link lands on — a mail
  // client or link scanner fetching this URL must not spend the token.
  await expect(page.getByRole("button", { name: "Verify my email" })).toBeVisible();

  await page.getByRole("button", { name: "Verify my email" }).click();

  // A real identity answers 404 for a token it has never seen, expired, spent, or
  // minted for another flow — one sentinel, four cases, and no way for a client to
  // tell them apart.
  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("cannot be used");

  // Never "expired", and never "already used". Naming either of the four would
  // tell anybody probing tokens that the one they held had once been a good one,
  // which turns a guess into a probe.
  await expect(alert).not.toContainText("expired");
  await expect(alert).not.toContainText("already");

  // And the way forward is a real control that goes somewhere real.
  const again = page.getByRole("button", { name: "Request a new link" });
  await expect(again).toBeVisible();
  await again.click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
});

test("a verification link with no code in it explains itself rather than rendering a button that cannot work", async ({
  page,
}) => {
  // `RECOVERY_LINK_TEMPLATE` is deployment configuration. A deployment can point
  // it at a path segment instead of `?token=`, and then this page is what a person
  // arrives at with nothing to redeem. It has to say so.
  await page.goto("/verify-email/confirm");

  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("missing its verification code");
  await expect(page.getByRole("button", { name: "Verify my email" })).toHaveCount(0);
});

test("a created account is never un-said when the verification mail cannot be sent", async ({
  page,
}) => {
  // THE REGRESSION THIS FILE IS MOST ABOUT, and the one the 503 branch of the
  // register screen exists for.
  //
  // `POST /v1/users` creates the account and sends nothing; the link is a second,
  // separable call. If that second call's failure were reported as a failed
  // registration, a person who believed it would register again — into a 409 for
  // an address they have just proved they own. So the sentence that announces the
  // account has to survive the mail request failing.
  await page.goto("/register");
  await page.getByLabel("Email").fill(aFreshAddress());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  const status = page.getByRole("main").getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Account created");

  // The mail half is the truthful half: this deployment sent nothing, so the
  // screen says so and does not send anybody to an inbox.
  await expect(status).toContainText("cannot send email");
  await expect(status).not.toContainText("on its way");

  // And the resend stays reachable, because the link is still worth asking for
  // once the deployment can mail.
  await expect(page.getByRole("link", { name: /send it again/i })).toBeVisible();
});

test("the sign in screen offers the way to ask for a link, without saying anything about the address", async ({
  page,
}) => {
  await page.goto("/login");

  // Rendered unconditionally rather than after a failed attempt. A link that
  // appeared only once the form had refused you would be saying something about
  // the address, and this is the one screen that must never say it.
  const ask = page.getByRole("main").getByRole("link", { name: /verify your email/i });
  await expect(ask).toBeVisible();

  await ask.click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
});

test("an address that has no account and one that does are answered identically", async ({
  page,
}) => {
  // The security control for this surface, and the reason the 202 constant in
  // identity exists at all. In this stack both addresses get the same 503, because
  // the mailer is checked first — so the stronger claim this file can make is the
  // one about the screen: whatever the service said, the rendering is
  // byte-identical.
  //
  // Registering one of the two is what makes the pair meaningful: without a real
  // account on one side, "both got the same answer" would also be true of a screen
  // that never asked anybody anything.
  await page.goto("/register");
  const registered = aFreshAddress();
  await page.getByLabel("Email").fill(registered);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  const askFor = async (address: string) => {
    await page.goto("/verify-email");
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Send verification link" }).click();
    const alert = alertIn(page);
    await expect(alert).toBeVisible();
    return alert.innerText();
  };

  const forRegistered = await askFor(registered);
  const forUnknown = await askFor(aFreshAddress());

  expect(
    forRegistered,
    "a verification request must not distinguish an address that has an account",
  ).toBe(forUnknown);
  // Neither rendering may echo the address back, which would confirm it exists
  // whatever the service's status code was.
  expect(forRegistered).not.toContain(registered);
});