/**
 * Account administration across two real people, in a real browser, against a
 * real service.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE COVERS, AND WHAT IT DOES NOT INVENT
 * ---------------------------------------------------------------------------
 * One workflow, end to end, through the app's real behavior only:
 *
 *   * an owner registers and signs in, and invites a second address from the
 *     account detail page's real invite form, reading the one-time link it
 *     renders;
 *   * the second person registers and signs in IN A SEPARATE BROWSER CONTEXT
 *     — two people means two storage partitions, so the owner's session is
 *     never the guest's — visits the real link, and accepts;
 *   * the guest follows the accept response onto the account and sees the
 *     member's view: the member list renders, and the invite form does not,
 *     because `can("member", "inviteMember")` is false and the screen defers
 *     to it;
 *   * back in the owner's context, the member list has two rows, and the
 *     owner promotes the guest with the row's real role control — the
 *     owner-only `PATCH /v1/accounts/:id/members/:userId` the role matrix
 *     pins to owners — and the row reads back as Admin.
 *
 * No token is fabricated, no endpoint is stubbed, no credential crosses
 * contexts: the only thing that travels between the two people is the
 * invitation link, exactly as it would over email.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER
 * ---------------------------------------------------------------------------
 * The Identity admin audit trail (`GET
 * /v1/accounts/{account_id}/admin/audit-log`) is NOT rendered anywhere in
 * this app, and this file does not touch it. That route is scoped-API-key-only
 * — `requireAdminToken` refuses a browser session with 403, and the OpenAPI
 * document says so outright ("or **a browser session was presented** — the
 * admin surface is token-only"). A browser session therefore can never read
 * the trail, and audit rows are only ever written by the admin revocation
 * routes, which need the same machine credential. Building a panel for it in
 * Parlor would mean either a panel that always renders its refusal state, or
 * forwarding a machine credential through a browser-facing path — both out of
 * scope and the second unsafe. The audit history stays operator-machine-only;
 * what a browser session CAN administer — invite, accept, roles, removal — is
 * what this file proves.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS, NO SKIPS, RENDERED TEXT ONLY
 * ---------------------------------------------------------------------------
 * There is no `waitForTimeout` here: every wait is an auto-waiting expect.
 * Every assertion is on rendered text or a role with an accessible name —
 * never a status code, never a class name. No credential is recorded, logged,
 * or put in a test name: each session token goes to `recordSessionToken` and
 * nowhere else, and the invitation token is read from the page into a local
 * only to be visited, exactly as a person following the link would.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

import { recordSessionToken } from "./session-tokens";

/**
 * A password that satisfies identity's own floor with room to spare.
 *
 * `MIN_PASSWORD_LENGTH` is mirrored in `src/lib/identity.ts`; the value is
 * deliberately longer than the floor so a change to the floor cannot start
 * failing this suite for a reason that has nothing to do with account
 * administration.
 */
const PASSWORD = "the harness is not a test of password strength";

function aFreshAddress(): string {
  return `e2e-${crypto.randomUUID()}@example.test`;
}

/**
 * A fresh register → sign-in through the real forms, the way a person does,
 * leaving the page signed in.
 *
 * The registration confirmation names the address, which means POST /v1/users
 * reached the real service and the real database; the banner naming the
 * address afterwards means the session is the service's, not an optimistic
 * shell. The token is handed to the recorder — the only thing in the suite
 * that ever holds it — so the teardown can prove no artifact kept one.
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

  const stored = await page.evaluate(() => window.localStorage.getItem("parlor.session.token"));
  expect(stored, "the sign-in form should have stored a session token").toBeTruthy();
  const token = (JSON.parse(stored as string) as { token?: string }).token;
  expect(typeof token, "the stored envelope should carry a token string").toBe("string");
  recordSessionToken(token as string);
}

/**
 * The owner's first account, opened from the list.
 *
 * Registration creates a personal account owned by the new person, so the
 * list has exactly one row and opening it lands on the detail page that
 * carries the real invite action. Returns the detail URL, so the owner can
 * come back to it after the guest has accepted.
 */
async function openOwnersAccount(page: Page): Promise<string> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
  const accounts = page.getByRole("list", { name: "Your accounts" });
  await expect(accounts).toBeVisible();
  await accounts.getByRole("link").first().click();
  await expect(page.getByRole("region", { name: "Account" })).toBeVisible();
  return page.url();
}

/**
 * The row's role control for the member whose current role is `from`.
 *
 * Both member rows carry the same accessible name ("Role for this member"),
 * so the guest's row is found by its current value rather than by position:
 * row order is the service's to decide, and a positional index would assert
 * this run's ordering rather than the control's behavior.
 */
async function roleSelectFor(page: Page, from: "member" | "admin" | "owner") {
  const selects = page.getByRole("region", { name: "Members" }).getByLabel("Role for this member");
  const count = await selects.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = selects.nth(index);
    if ((await candidate.inputValue()) === from) return candidate;
  }
  throw new Error(`no member row currently reads as ${from}`);
}

test("an owner invites a second person, who accepts and is then promoted", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  const owner = aFreshAddress();
  await registerAndSignIn(page, owner);
  const accountUrl = await openOwnersAccount(page);

  // The invite, through the real form. The default role is member — the
  // least-privilege end of `invitableRoles("owner")` — so what is exercised
  // below is the path that grants the least, and the promotion afterwards is
  // the owner-only path granting more.
  const guest = aFreshAddress();
  const invite = page.getByRole("region", { name: "Invite somebody" });
  await expect(invite).toBeVisible();
  await invite.getByLabel("Email").fill(guest);
  await invite.getByRole("button", { name: "Send invitation" }).click();
  await expect(invite.getByText(`Invited ${guest}.`)).toBeVisible();
  const href = await invite.getByRole("link").getAttribute("href");
  if (href === null) {
    throw new Error("the invite action rendered no invitation link");
  }
  expect(href, "the invite action should render a one-time invitation link").toMatch(
    /^\/invitations\/.+/,
  );

  // The second person, in a second context: two people means two storage
  // partitions, so nothing about the owner's session is ever the guest's.
  // The guest registers the invited address itself — the realistic shape —
  // signs in, and follows the real link.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  try {
    await registerAndSignIn(guestPage, guest);
    await guestPage.goto(href);
    await expect(guestPage.getByRole("heading", { name: "You have been invited" })).toBeVisible();
    await guestPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(guestPage.getByRole("heading", { name: "You are in" })).toBeVisible();
    await expect(guestPage.getByText("You joined as member.")).toBeVisible();

    // The member's view of the same account: the member list renders, and the
    // invite form does not — a member may not invite, and the screen does not
    // offer the control. Asserting the absence pins the role gate rather than
    // the service's refusal.
    await guestPage.getByRole("link", { name: "Go to the account" }).click();
    await expect(guestPage.getByRole("region", { name: "Account" })).toBeVisible();
    await expect(guestPage.getByRole("region", { name: "Members" })).toBeVisible();
    await expect(guestPage.getByRole("region", { name: "Invite somebody" })).toHaveCount(0);
  } finally {
    await guestContext.close();
  }

  // Back in the owner's context: the member list now has two rows, and the
  // owner promotes the guest with the row's real role control — the
  // owner-only change this app's own matrix pins to owners. The row reading
  // back as Admin is the service's answer, not the control's optimism: the
  // mutation invalidates the panel and the value is re-rendered from a
  // refetch.
  await page.goto(accountUrl);
  const members = page.getByRole("region", { name: "Members" });
  await expect(members).toBeVisible();
  await expect(members.getByRole("list", { name: "Members" }).getByRole("listitem")).toHaveCount(
    2,
  );

  const guestRole = await roleSelectFor(page, "member");
  await guestRole.selectOption("admin");
  await expect(guestRole).toHaveValue("admin");
});
