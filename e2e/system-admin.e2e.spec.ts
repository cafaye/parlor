/**
 * The system-admin console, in a real browser, against the real stack.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE COVERS, AND WHAT IT DOES NOT INVENT
 * ---------------------------------------------------------------------------
 * Two tests, both through the app's real behavior only:
 *
 *   1. A fresh non-staff account signs in, opens `/admin`, and is refused:
 *      the page shell renders ("System admin") with the app's flat refusal
 *      ("Not available") rather than the console, the staff-only header link
 *      is absent, and the normal routes (Accounts) still work.
 *
 *   2. A separately registered staff candidate is granted staff with the
 *      operator command identity SHIPS IN ITS OWN IMAGE
 *      (`bin/e2e-stack grant-staff`, which runs
 *      `/app/identity-staff grant <email>` inside the identity container) —
 *      the one writer of `users.is_staff`, so there is no HTTP route a spec
 *      could call instead and no backdoor invented here. Signed in as staff,
 *      the browser opens `/admin`, searches the directory for a separately
 *      created user, and the one matching row renders that user's address
 *      from Identity. The existing confirm disable/enable flow then runs:
 *      disable reads back Disabled, a page reload plus a fresh search still
 *      reads Disabled (the status is the service's, not optimistic local
 *      state), and re-enable reads back Active.
 *
 * No token is fabricated, no endpoint is stubbed, no credential crosses
 * contexts: the only fixture action is the staff grant, an operator step a
 * deployment performs by hand, run after the candidate registered through
 * the real form.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER
 * ---------------------------------------------------------------------------
 * User deletion, staff grants from the UI, impersonation, billing, and audit
 * scope: the `/admin` screen offers none of them (its header says so), so
 * there is nothing here to drive. The grant above is a container exec, not
 * a UI path, and it stays one.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS, NO SKIPS, RENDERED TEXT ONLY, NO SECRETS IN OUTPUT
 * ---------------------------------------------------------------------------
 * There is no `waitForTimeout` here: every wait is an auto-waiting expect.
 * Every assertion is on rendered text or a role with an accessible name —
 * never a status code, never a class name. No credential is recorded, logged,
 * or put in a test name: each session token goes to `recordSessionToken` and
 * nowhere else, and the grant command's own output (a fixture address plus a
 * boolean) is discarded rather than printed. Addresses are fresh per test
 * (`crypto.randomUUID`), so nothing depends on reused container state, and no
 * user id is ever named: rows are found by address text.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { recordSessionToken } from "./session-tokens";

/**
 * A password that satisfies identity's own floor with room to spare.
 *
 * `MIN_PASSWORD_LENGTH` is mirrored in `src/lib/identity.ts`; the value is
 * deliberately longer than the floor so a change to the floor cannot start
 * failing this suite for a reason that has nothing to do with system
 * administration.
 */
const PASSWORD = "the harness is not a test of password strength";

function aFreshAddress(): string {
  return `e2e-${crypto.randomUUID()}@example.test`;
}

/** An address inside a button's accessible name, matched literally. */
function literalAddress(address: string): RegExp {
  return new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
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
 * The one writer of `users.is_staff`, run as the explicit fixture action.
 *
 * `bin/e2e-stack grant-staff` execs `/app/identity-staff` — the operator
 * command identity packages in its own image — inside the running identity
 * container, where DATABASE_URL is the container's own. Nothing secret
 * crosses to the host, and the command's own stdout (a fixture address plus
 * a boolean) is discarded rather than printed or asserted on: the proof that
 * the grant landed is the browser rendering the console afterwards, not the
 * fixture narrating itself.
 */
function grantStaff(email: string): void {
  execFileSync(join(process.cwd(), "bin", "e2e-stack"), ["grant-staff", email], {
    encoding: "utf8",
    timeout: 120_000,
  });
}

/**
 * Search the console's directory for one address and open its row.
 *
 * Returns the detail region for the selected user. The row being there at
 * all — with exactly one match for a full address — is Identity's answer
 * rendered, not the form's optimism: the list only appears after the
 * `operator/users` round trip resolves.
 */
async function searchAndOpen(page: Page, email: string) {
  await page.getByLabel("Search users").fill(email);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const list = page.getByRole("list", { name: "Matching users" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await list.getByRole("button", { name: literalAddress(email) }).click();
  const detail = page.getByRole("region", { name: email });
  await expect(detail).toBeVisible();
  return detail;
}

test("a signed-in non-staff account is refused the console while normal routes still work", async ({
  page,
}: {
  page: Page;
}) => {
  const plain = aFreshAddress();
  await registerAndSignIn(page, plain);

  // The refusal: the shell names the area, the gate names nothing — no role,
  // no reason, no staff list. That flatness is the property: a 403 that
  // enumerated staff would be an oracle about the team.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "System admin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
  await expect(
    page.getByText("This area is for system administrators.", { exact: false }),
  ).toBeVisible();

  // The staff-only header link stays hidden: hiding is not authorization, but
  // offering the control to someone the service will refuse would be worse
  // than no control.
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(main.getByRole("link", { name: "System admin" })).toHaveCount(0);

  // And the refusal cost nothing else: the account's own routes still render
  // from the service.
  await main.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("list", { name: "Your accounts" })).toBeVisible();
});

test("staff can search the directory and disable then re-enable a user", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  // The subject, registered the realistic way in a second context: two
  // people means two storage partitions, so nothing about the staff
  // candidate's session is ever the subject's. Registration alone creates
  // the row the directory later returns.
  const subject = aFreshAddress();
  const subjectContext = await browser.newContext();
  try {
    await registerAndSignIn(await subjectContext.newPage(), subject);
  } finally {
    await subjectContext.close();
  }

  // The operator, registered through the same real form and then granted
  // staff by the packaged CLI — the deployment's own step, after the fact.
  // No re-sign-in: the console's gate is a fresh `operator/me` read, so the
  // existing session picks up the grant on its next request.
  const operator = aFreshAddress();
  await registerAndSignIn(page, operator);
  grantStaff(operator);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "System admin" })).toBeVisible();
  // The grant landed if and only if the console renders: the search panel is
  // behind the staff gate, so this is the service's answer, not the
  // fixture's.
  await expect(page.getByRole("region", { name: "Find a user" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "System admin" }),
  ).toBeVisible();

  // The directory search: one full address in, one row out, carrying the
  // service's own status for that user.
  const detail = await searchAndOpen(page, subject);
  await expect(detail.getByText("Active", { exact: true })).toBeVisible();

  // Disable, through the existing confirm flow. The dialog names the action
  // twice (title and confirming button) and the detail button names it once,
  // so every control below is scoped to exactly the control it means.
  await detail.getByRole("button", { name: "Disable", exact: true }).click();
  const disableDialog = page.getByRole("dialog", { name: "Disable this user?" });
  await expect(disableDialog).toBeVisible();
  await disableDialog.getByRole("button", { name: "Disable this user" }).click();
  await expect(page.getByText("That user is now disabled.")).toBeVisible();
  await expect(detail.getByText("Disabled", { exact: true })).toBeVisible();

  // Server-backed, not optimistic: a reload throws away every local query
  // cache, and a fresh search still reads Disabled for the same address.
  await page.reload();
  await expect(page.getByRole("region", { name: "Find a user" })).toBeVisible();
  const reopened = await searchAndOpen(page, subject);
  await expect(reopened.getByText("Disabled", { exact: true })).toBeVisible();

  // Re-enable, which leaves the fixture subject exactly as found: able to
  // sign in, with no other trace of the run on its row.
  await reopened.getByRole("button", { name: "Re-enable", exact: true }).click();
  const enableDialog = page.getByRole("dialog", { name: "Re-enable this user?" });
  await expect(enableDialog).toBeVisible();
  await enableDialog.getByRole("button", { name: "Re-enable this user" }).click();
  await expect(page.getByText("That user is now enabled.")).toBeVisible();
  await expect(reopened.getByText("Active", { exact: true })).toBeVisible();
});
