/**
 * The headline end-to-end path: a person, in a real browser, creates an account,
 * signs in, and reaches the screen that only a signed-in person can see.
 *
 * Why this path and not a longer one is the subject of the packet report. The
 * short version: `parlor`'s browser client calls `identity` directly and nothing
 * proxies it, so `parlor → guard → identity` is not a path that exists in the
 * code today (see `stack.e2e.spec.ts` for the parts of it that do). What this
 * file proves is the part that a unit test inside one repository structurally
 * cannot see:
 *
 *   * three processes that were built from three different checkouts are talking
 *     to each other over real HTTP, on ports nothing else on the machine owns;
 *   * the sign-in path works with the browser on ONE origin. This is the headline
 *     claim, and it is new: `src/app/v1/[...path]/route.ts` answers `/v1/*` on
 *     parlor's own origin and forwards to identity from the server. The `identity`
 *     service in this stack is reachable only as `http://identity:8080` — a name
 *     the compose network resolves and a browser cannot — and the only address
 *     in the parlor container is that one, in `IDENTITY_URL`. A browser that
 *     still called identity directly would fail here, which is the point;
 *   * identity's migrations ran against a real Postgres and its argon2id
 *     password hashing, its session rows and its `/v1/me` all work over a
 *     socket;
 *   * the session survives a full document load, which is `localStorage` and the
 *     React Query cache key `["session", token]` doing their job.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND WHY IT IS NOT A NETWORK ASSERTION
 * ---------------------------------------------------------------------------
 * Every assertion is on rendered text: a role and an accessible name, or a
 * heading. There is not one `expect(response.status()).toBe(200)` in this file,
 * and that is the point of the tier. A test that asserts an API returned 200
 * while the page shows an error has tested nothing — and this stack has at
 * least three ways to be 200-and-broken: an `IDENTITY_URL` that resolves nowhere
 * (every request fails in the app, so the *service* never sees a 200), a
 * session token that does not survive the page transition, and a `GET /v1/me`
 * that succeeds while the header renders the signed-out state.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS
 * ---------------------------------------------------------------------------
 * There is no `waitForTimeout` in this file and there never will be. Every wait
 * is `expect(...).toBeVisible()` / `toHaveText()` / `toHaveURL()`, which
 * re-poll until the condition holds or the expect timeout expires. A sleep is a
 * flake waiting for a bad day, and a suite that is blamed for one gets its
 * assertions loosened to "fix" it.
 */
import { expect, test, type Page } from "@playwright/test";

import { recordSessionToken } from "./session-tokens";

/**
 * A password that satisfies identity's own floor with room to spare.
 *
 * `MIN_PASSWORD_LENGTH` is mirrored in `src/lib/identity.ts` so the form can
 * refuse it locally; the value here is deliberately longer than the floor so
 * that a change to the floor cannot start failing this suite for a reason that
 * has nothing to do with the stack.
 */
const PASSWORD = "the harness is not a test of password strength";

/**
 * The site header, as a locator.
 *
 * Every session assertion in this file is scoped through here, and the reason is
 * a strict-mode violation this file hit twice: the pages themselves carry links
 * with the same names as the header's — the signed-out `/accounts` screen has a
 * "Sign in" link in `main`, and the landing page has cards for every section. A
 * page-wide `getByRole("link", { name: "Sign in" })` is ambiguous on exactly the
 * pages where the header matters most, and the failure it produces is a locator
 * error rather than a statement about the session.
 */
const header = (page: Page) => page.getByRole("banner");

/**
 * A fresh address for every run.
 *
 * The stack is torn down with its volumes, so the database starts empty each
 * run — but a re-run against a surviving stack would otherwise hit identity's
 * 409 and this file would fail on a duplicate rather than on anything real. The
 * random suffix also means a failed run's leftovers cannot poison the next one.
 * `example.test` is reserved by RFC 6761 and can never be a real address.
 */
function aFreshAddress(): string {
  return `e2e-${crypto.randomUUID()}@example.test`;
}

/**
 * Signs in through the real form, the way a person does, and leaves the browser
 * signed in.
 *
 * The token is read out of the page's own storage and handed to the recorder,
 * which is the only thing in the suite that ever holds it. It is never put in a
 * test name, an assertion message, or a `console.log` — see e2e/session-tokens.ts
 * for why that is checked rather than promised.
 */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The header is the only place a signed-in person can see that they are. The
  // email is the assertion, because "the button says Sign out" is also what a
  // shell that renders the button optimistically looks like.
  await expect(header(page).getByText(email, { exact: true })).toBeVisible();

  const stored = await page.evaluate(() =>
    window.localStorage.getItem("parlor.session.token"),
  );
  expect(stored, "the sign-in form should have stored a session token").toBeTruthy();
  // The envelope is `{token: "..."}`; the key is in src/lib/token-store.ts and
  // is renamed by the BFF packet, so this is the one place that has to move.
  const token = (JSON.parse(stored as string) as { token?: string }).token;
  expect(typeof token, "the stored envelope should carry a token string").toBe("string");
  recordSessionToken(token as string);
}

test("a person can create an account and sign in to it", async ({ page }) => {
  const email = aFreshAddress();

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // The confirmation names the address, which means the POST /v1/users reached
  // the real service and the real database. A stack that is up but cannot reach
  // identity renders "Something went wrong. Try again." here instead, and that
  // is the whole difference the suite exists to catch.
  //
  // The rest of the sentence is about the SECOND call — the verification request
  // `POST /v1/users` does not make. In this stack there is no courier, so it is
  // the "cannot send" branch, and the address still leads it: the account exists
  // in both. See e2e/email-verification.e2e.spec.ts for the 503 branch as its own
  // subject.
  await expect(page.getByRole("status")).toHaveText(
    `Account created for ${email}. This deployment cannot send email right now, so no verification link was sent.`,
  );

  await signIn(page, email);

  // The signed-in state, and the signed-out affordances gone. Asserting only
  // the first would pass on a header that shows both.
  await expect(header(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(header(page).getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(header(page).getByRole("link", { name: "Create account" })).toHaveCount(0);
});

test("the session survives a page load, so a signed-in person can reach their accounts", async ({
  page,
}) => {
  const email = aFreshAddress();

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await signIn(page, email);

  // A navigation, not a client-side link swap. This is the assertion that the
  // token is in storage and that the session it names is still good: a new
  // document, a fresh React Query cache, a fresh GET /v1/me. A test that
  // asserted the header right after signing in would pass with a session that
  // does not survive a reload, which is the bug this tier is most likely to be
  // the first to see.
  //
  // Scoped to the header, because the landing page also links to /accounts and
  // a page-wide locator matched two elements — a strict-mode error, which is the
  // right outcome and one this file hit.
  await header(page).getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // identity gives every new person a personal account, and it is the owner of
  // it. Asserting the row rather than an empty state is the stronger claim: it
  // says the service created the account, derived a handle from the address,
  // resolved the role, and that this app rendered all three — over HTTP, with
  // the session this test just signed in with.
  const accounts = page.getByRole("list", { name: "Your accounts" });
  await expect(accounts.getByRole("listitem")).toHaveCount(1);
  const personal = accounts.getByRole("listitem").first();
  await expect(personal).toContainText("Personal account");
  await expect(personal).toContainText("Owner");
  // The address is truncated in the row and NOT the full string: identity names
  // the personal account after the address and truncates the name to the same
  // 63 characters the handle is limited to (identity/AGENTS.md, on `Slugify`).
  // Asserting a prefix rather than the whole address is asserting the fact
  // rather than working around it — a future change that stopped truncating
  // would still pass, and one that truncated at a different boundary would
  // still be checked against the leading characters.
  await expect(personal).toContainText(email.slice(0, 20));
  // And the row is a link to a real account: the id in the href is the service's
  // UUID, not anything this app made up.
  await expect(personal.getByRole("link")).toHaveAttribute(
    "href",
    /^\/accounts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  // The signed-out alternative, so the assertion above cannot pass because both
  // states render something with an "Accounts" in it.
  await expect(page.getByText("Sign in to see your accounts")).toHaveCount(0);

  // A write through the form, then a read back only the service could have
  // answered. The name carries a random suffix so a re-run against a surviving
  // stack cannot collide on the derived handle and fail on a 409 that is not what
  // this test is about.
  const name = `Harness ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("Account name").fill(name);
  await page
    .getByRole("region", { name: "New account" })
    .getByRole("button", { name: "Create account" })
    .click();

  // The list grows, and the new row carries the name that was typed. Counting
  // the rows *after* the click is what makes this an assertion about the write:
  // without the count, "the name is on the page" is also true of the value still
  // sitting in the input.
  await expect(accounts.getByRole("listitem")).toHaveCount(2);
  const created = accounts.getByRole("link", { name: new RegExp(name) });
  await expect(created).toBeVisible();
  await expect(created).not.toContainText("Personal account");

  // And the round trip closes: sign out puts the signed-out chrome back and
  // takes the token with it, so a reload does not restore the session.
  await header(page).getByRole("button", { name: "Sign out" }).click();
  await expect(header(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(header(page).getByText(email, { exact: true })).toHaveCount(0);

  // A reload, so "signed out" means the token is gone rather than that one
  // render said so. Without this, a sign-out that only cleared the React Query
  // cache would pass.
  await page.reload();
  await expect(header(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to see your accounts" })).toBeVisible();
});

/**
 * The refusal path, which is a security property and not a copy property.
 *
 * A wrong password and an address that was never registered must produce
 * *byte-identical* screen output, or the form is an account-existence oracle:
 * somebody can enumerate who has an account here by trying addresses and
 * reading which sentence comes back. AGENTS.md makes this non-negotiable and
 * says a test exists for it — and there is one, in
 * `src/app/login/page.test.tsx`, with a stubbed identity client.
 *
 * A stub cannot see the part that matters. The 401 has to arrive from the real
 * service over a socket, and identity's own 401 has to arrive for BOTH cases:
 * a form that renders one sentence for both is only safe while the service
 * answers the same for both, and nothing in the unit tier can tell whether
 * identity distinguishes them. This is the one test here that is a security
 * control rather than a smoke test, and it is the reason the tier is worth its
 * wall-clock.
 */
test("a wrong password and an unknown address say exactly the same thing", async ({ page }) => {
  const email = aFreshAddress();

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  // Case one: the address exists, the password does not.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("this is not the password, and it is long");
  await page.getByRole("button", { name: "Sign in" }).click();
  // `FieldSummary` is the one `role="alert"` per form (src/components/ui/field.tsx),
  // and it is the region the refusal is supposed to be announced in. Reading
  // the region is reading what a screen reader would read, not reading the DOM.
  //
  // Scoped to `main` because Next.js renders its own `role="alert"` route
  // announcer outside the page, and it is empty. This file matched that one
  // first: `toBeVisible()` passed against an element with no text, `innerText()`
  // returned "", and the failure looked like a form that reported nothing rather
  // than a locator that pointed at the wrong alert. A region that exists, is
  // visible, and is empty is a fact about the DOM that only the scoping catches.
  const refusal = page.getByRole("main").getByRole("alert");
  await expect(refusal).toBeVisible();
  const wrongPassword = await refusal.innerText();
  // The form is usable again: a refusal that leaves the button disabled is a
  // refusal the person cannot try again from.
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();

  // Case two: an address nothing was ever registered for.
  await page.goto("/login");
  await page.getByLabel("Email").fill(aFreshAddress());
  await page.getByLabel("Password").fill("this is not the password, and it is long");
  await page.getByRole("button", { name: "Sign in" }).click();
  const secondRefusal = page.getByRole("main").getByRole("alert");
  await expect(secondRefusal).toBeVisible();
  const unknownAddress = await secondRefusal.innerText();

  // The assertion is equality between the two renderings, not the presence of a
  // sentence. A future edit that adds "no account with that address" to one of
  // them fails here even though every unit test still passes.
  expect(
    wrongPassword,
    "a refused sign-in must not name a field or distinguish the two cases",
  ).toBe(unknownAddress);
  expect(wrongPassword).toContain("Invalid email or password.");
});
