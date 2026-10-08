/**
 * Settings and invitations, in a real browser, against a real service.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE COVERS, AND WHAT IT DOES NOT INVENT
 * ---------------------------------------------------------------------------
 * Every scenario here reaches its state through the app's real behavior only:
 *
 *   * Settings scenarios use a fresh register → sign-in through the real
 *     forms (the same flow the design-system spec already drives) and then
 *     navigate to `/settings` to assert the existing headings and grouping
 *     render. No heading is renamed, none is regrouped.
 *
 *   * The unknown-token scenario visits `/invitations/<token>` with a token
 *     the service never issued. The token needs no fixture; the SESSION does
 *     — a signed-out visitor is offered sign-in, because the membership an
 *     accept would create belongs to the caller, so the pending state (and
 *     the button that leaves it) only renders for a signed-in person. The
 *     click then reaches the route's own unrecognised-token sentinel.
 *
 *   * The pending scenario drives the tree's real member-invite action — the
 *     invite form on the account detail page — through the real UI, reads the
 *     one-time link it renders, and visits it to assert the pending state.
 *     No token is fabricated, no endpoint is stubbed. The accept itself is
 *     NOT clicked there: which membership that click would create is the
 *     service's answer to give, and this file asserts only what the app
 *     renders up to the choice.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS, NO SKIPS, RENDERED TEXT ONLY
 * ---------------------------------------------------------------------------
 * There is no `waitForTimeout` here: every wait is an auto-waiting expect.
 * Every assertion is on rendered text or a role with an accessible name —
 * never a status code, never a class name. No credential is recorded, logged,
 * or put in a test name: the session token stays in the browser's storage,
 * and the invitation token is read from the page into a local only to be
 * visited, exactly as a person following the link would.
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * A password that satisfies identity's own floor with room to spare.
 *
 * `MIN_PASSWORD_LENGTH` is mirrored in `src/lib/identity.ts`; the value is
 * deliberately longer than the floor so a change to the floor cannot start
 * failing this suite for a reason that has nothing to do with settings or
 * invitations.
 */
const PASSWORD = "the harness is not a test of password strength";

function aFreshAddress(): string {
  return `e2e-${crypto.randomUUID()}@example.test`;
}

/**
 * A fresh register → sign-in through the real forms, the way a person does,
 * leaving the browser signed in.
 *
 * The registration confirmation names the address, which means POST /v1/users
 * reached the real service and the real database; the banner naming the
 * address afterwards means the session is the service's, not an optimistic
 * shell.
 */
async function registerAndSignIn(page: Page, email: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(`Account created for ${email}.`);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").getByText(email, { exact: true })).toBeVisible();
}

test("settings renders its existing sections after a real register and sign-in", async ({
  page,
}) => {
  const email = aFreshAddress();
  await registerAndSignIn(page, email);

  await page.goto("/settings");

  // The composed header: the page's own heading, with the product eyebrow the
  // refresh added above it. Scoped to `main`, because the shell brand in the
  // banner carries the same word and a page-wide lookup would be ambiguous.
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("main").getByText("parlor")).toBeVisible();

  // The existing grouping, in the existing order: who you are, your address,
  // your second factor, everywhere you are signed in, this session, and the
  // one irreversible thing last. Regions, because panels are landmarks.
  for (const section of [
    "Display name",
    "Email",
    "Second factor",
    "Sessions",
    "Session",
    "Delete account",
  ]) {
    await expect(page.getByRole("region", { name: section })).toBeVisible();
  }

  // And the Second factor panel is not only standing but ANSWERED: a fresh
  // account has no second factor, so identity's status route — mounted only
  // when the stack supplies MFA_ENCRYPTION_KEY — answers `{"enabled": false}`
  // and the panel renders the disabled state. Without the key the routes are
  // unmounted, the status read fails, and this panel renders its failure
  // sentence instead: a landmark alone would prove nothing about the surface.
  const second = page.getByRole("region", { name: "Second factor" });
  await expect(second.getByText("Not enabled")).toBeVisible();
  await expect(
    second.getByRole("button", { name: "Set up a second factor" }),
  ).toBeVisible();
});

test("an unknown invitation token reaches the route's own sentinel", async ({ page }) => {
  const email = aFreshAddress();
  await registerAndSignIn(page, email);

  // A token the service never issued. Nothing about it is real, so the only
  // honest answer is the route's own unrecognised state — and pending comes
  // first, because nothing happens until the person chooses to accept.
  await page.goto(`/invitations/e2e-unknown-${crypto.randomUUID()}`);
  await expect(page.getByRole("heading", { name: "You have been invited" })).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();

  await expect(
    page.getByRole("heading", { name: "Invitation not recognised" }),
  ).toBeVisible();
  // A 404 never says "expired": that word would confirm the token once
  // existed and turn a guessed link into a working probe.
  await expect(page.getByText(/expired/i)).toHaveCount(0);
});

test("a real member invite reaches the pending state", async ({ page }) => {
  const email = aFreshAddress();
  await registerAndSignIn(page, email);

  // Registration creates a personal account owned by the new person, so the
  // list has exactly one row and the detail carries the real invite action —
  // the form the account packet's own tests pin to the "Invite somebody"
  // region.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
  const accounts = page.getByRole("list", { name: "Your accounts" });
  await expect(accounts).toBeVisible();
  await accounts.getByRole("link").first().click();
  await expect(page.getByRole("region", { name: "Account" })).toBeVisible();

  const invite = page.getByRole("region", { name: "Invite somebody" });
  await expect(invite).toBeVisible();
  const guest = aFreshAddress();
  await invite.getByLabel("Email").fill(guest);
  await invite.getByRole("button", { name: "Send invitation" }).click();

  // The one-time link, rendered by the real action: the invitation it names
  // exists in the service's database, minted by this click and no other copy.
  await expect(invite.getByText(`Invited ${guest}.`)).toBeVisible();
  await expect(invite.getByText(/shown once/)).toBeVisible();
  const href = await invite.getByRole("link").getAttribute("href");
  if (href === null) {
    throw new Error("the invite action rendered no invitation link");
  }
  expect(href, "the invite action should render a one-time invitation link").toMatch(
    /^\/invitations\/.+/,
  );

  // Following it, the way the invited person would: the pending state, with
  // the choice still unmade.
  await page.goto(href);
  await expect(page.getByRole("heading", { name: "You have been invited" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
});
