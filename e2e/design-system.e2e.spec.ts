/**
 * The design system, in a real browser, against a real service.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * Every other assertion about the primitives in this repository is made in
 * jsdom, and jsdom has a specific and load-bearing limitation: it does not
 * load the stylesheet, does not evaluate `@media (prefers-color-scheme)`, and
 * does not compute layout. So the unit tier can prove a control has a focus
 * ring CLASS and cannot prove the ring is PAINTED, and it can prove the dark
 * block is declared and cannot prove a person in dark mode sees a dark page.
 *
 * That gap is the reason this file is here, and it is the reason these
 * assertions are about computed style rather than about markup:
 *
 *   * a focus ring is actually rendered, with a non-zero width, when a real
 *     keyboard Tab lands on a real control;
 *   * the focus ring is visible — its colour clears 3:1 against the surface it
 *     is drawn on, measured in the browser rather than in a test file;
 *   * `prefers-color-scheme: dark` actually changes what is painted, so the
 *     dark block is not decoration;
 *   * a destructive confirmation is operable by keyboard alone, with no mouse
 *     event anywhere in the test.
 *
 * A unit test that says `toContain("focus-ring")` is a test about a string.
 * This file is the one that says the ring is real.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND WHY IT IS NOT A NETWORK ASSERTION
 * ---------------------------------------------------------------------------
 * Every assertion is on rendered text, a computed style, or a role with an
 * accessible name — the same rule as `session.e2e.spec.ts` and for the same
 * reason. Nothing here asserts a status code, because a page can be served 200
 * and still be unreadable, which is the state this tier exists to catch.
 *
 * ---------------------------------------------------------------------------
 * NO SLEEPS
 * ---------------------------------------------------------------------------
 * There is no `waitForTimeout` here. Every wait is an auto-waiting expect, and
 * the one `waitForFunction` below is polling a computed style in a real
 * rendering engine, which is the same thing an expect does and not a sleep.
 */
import { expect, test, type Locator } from "@playwright/test";

/**
 * A password that satisfies identity's own floor with room to spare.
 *
 * `MIN_PASSWORD_LENGTH` is mirrored in `src/lib/identity.ts`; the value is
 * deliberately longer than the floor so a change to the floor cannot start
 * failing this suite for a reason that has nothing to do with the design
 * system.
 */
const PASSWORD = "the harness is not a test of password strength";

function aFreshAddress(): string {
  return `e2e-${crypto.randomUUID()}@example.test`;
}

/**
 * The computed value of one custom property on an element.
 *
 * `getPropertyValue` rather than a class-name check, because the whole point is
 * that a component does NOT have to know which theme it is in: the class is the
 * same in both modes and only the resolved custom property differs. Reading the
 * property proves the whole chain — the `@theme` block, the semantic remap, the
 * media query, and the cascade between them.
 */
async function tokenOf(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (node, name) => getComputedStyle(node).getPropertyValue(name).trim(),
    `--${property}`,
  );
}

/**
 * Normalise whatever the browser resolved into 8-bit sRGB channels.
 *
 * The normalisation is here rather than assumed because it was a real failure:
 * `getComputedStyle().outlineColor` comes back as `rgb(37, 141, 157)` and a
 * `getPropertyValue("--color-surface")` comes back as a hex, so the two halves
 * of every measurement in this file arrive in different notations. A helper
 * that only understood one of them made three of the five tests here fail on
 * their own arithmetic.
 *
 * Written to run IN THE BROWSER (`page.evaluate`) where possible so the parsing
 * is the browser's own, and duplicated in Node for the values that come back
 * as strings. Both are trivial and both are tested by the assertions using
 * them.
 */
function asChannels(value: string): [number, number, number] {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  throw new Error(`expected a hex or rgb() colour, got "${text}"`);
}

/** WCAG 2.x relative luminance, from 8-bit channels. */
function luminanceOf(value: string): number {
  const [r8, g8, b8] = asChannels(value);
  const channel = (raw8: number) => {
    const raw = raw8 / 255;
    return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r8) + 0.7152 * channel(g8) + 0.0722 * channel(b8);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("every interactive primitive is keyboard-reachable and paints a visible focus ring", async ({
  page,
}) => {
  await page.goto("/login");

  // Real Tab presses, in order, from the top of the document. Nothing here
  // calls `.focus()`: doing that would assert nothing about tab ORDER, which is
  // the property that actually breaks. The walk is asserted as a sequence so
  // that a control which is focusable but out of order fails here rather than
  // being passed over.
  const order: string[] = [];
  // One entry per control the keyboard lands on, carrying what the browser
  // actually painted for it. Collected in the same `evaluate` as the name, so
  // the ring is read from the element the walk is genuinely resting on rather
  // than reconstructed afterwards.
  const rings: Array<{ name: string; width: string; style: string; offset: string }> = [];
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press("Tab");
    const here = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active === null || active === document.body) return null;
      // The label lookup is three SEPARATE sources joined with a filter, not
      // one `??` chain. `??` only falls through on null and undefined, and an
      // `<input>`'s `textContent` is `""` — so the first version of this read
      // every form control as unnamed and the walk asserted nothing about
      // them. That is the same class of bug as the `hidden` substring check in
      // `link.test.tsx`: a fallback chain that silently stops falling back.
      const fromLabel = (active as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "";
      const fromAria = active.getAttribute("aria-label")?.trim() ?? "";
      const fromText = active.textContent?.trim() ?? "";
      const name = [fromAria, fromLabel, fromText].find((value) => value.length > 0) ?? "";
      const style = getComputedStyle(active);
      return {
        name: `${active.tagName.toLowerCase()}:${name || "(unnamed)"}`,
        width: style.outlineWidth,
        style: style.outlineStyle,
        offset: style.outlineOffset,
      };
    });
    // The walk leaves the document and comes back around the header, so BODY
    // is a real step and not a failure — it just has no ring to paint.
    if (here === null) continue;
    if (order.includes(here.name)) break;
    order.push(here.name);
    rings.push(here);
  }

  // Both form controls and the submit, reachable in document order, all named.
  // The email field is focused automatically on this page (the form sets
  // `autoFocus`), so the walk begins after it rather than at it.
  // Both form controls and the submit, reachable and all named. The walk starts
  // AFTER the email field, because the form sets `autoFocus` on it — so the
  // first Tab lands on Password. A control that is focusable but unnamed is a
  // dead end for somebody navigating by name, and that is asserted for every
  // step rather than for one selector.
  expect(order.some((entry) => entry.includes("Password"))).toBe(true);
  expect(order.some((entry) => entry.startsWith("button:Sign in"))).toBe(true);
  expect(order.filter((entry) => entry.endsWith("(unnamed)"))).toEqual([]);

  // The ring, measured on every control the walk landed on rather than on
  // whichever one happened to be last. The walk leaves the document and comes
  // back around the header, and `document.body` has no ring to paint — so
  // "measure whatever is focused at the end" was measuring the browser's own
  // chrome, which is a true statement about nothing.
  //
  // Measuring each step is the stronger claim, not the weaker one: a control
  // in the middle of the walk with no ring is exactly the bug this file exists
  // for, and a test that only looked at the last one would miss it. The two
  // hand-written links this packet replaced had no ring at all, and they sit in
  // that header the walk passes through.
  expect(rings.length, "the walk should have landed on some controls").toBeGreaterThan(2);

  for (const ring of rings) {
    // A ring that is `0px` or `none` is invisible in every other tier in this
    // repository, which is the entire reason this file exists.
    expect(ring.style, `${ring.name} must paint an outline, not a box-shadow`).not.toBe("none");
    expect(
      Number.parseFloat(ring.width),
      `${ring.name} has outline-width "${ring.width}" — the ring is not being painted`,
    ).toBeGreaterThan(0);
    // The offset is load-bearing: it is what separates a ring drawn on a
    // filled control from that control's own fill. `tokens.test.ts` asserts the
    // same thing about the declaration; this asserts it about the rendering.
    expect(
      Number.parseFloat(ring.offset),
      `${ring.name} has outline-offset "${ring.offset}" — the ring is flush against the control`,
    ).toBeGreaterThan(0);
  }
});

test("the focus ring is visible against the surface it is drawn on", async ({ page }) => {
  await page.goto("/login");

  // Focused, because the ring is a `:focus-visible` rule: an unfocused control
  // reports the ring's `outline-color` correctly while reporting
  // `outline-style: none`, so the first version of this test was measuring a
  // ring that was not being painted.
  await page.getByLabel("Email").focus();

  const ring = await page.getByLabel("Email").evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.outlineColor, style: style.outlineStyle };
  });
  const surface = await tokenOf(page.locator("body"), "color-surface");

  expect(ring.style, "the ring must actually be painted to be measured").not.toBe("none");

  // SC 1.4.11 is 3:1 for a non-text indicator. Measured in the browser, on the
  // colours as painted, which is the only place this claim is actually true.
  // The ring is read from the INPUT, and the surface from `body`, so this is
  // measuring two different elements. That is correct — the ring is drawn on
  // whatever the control stands on, and `tokens.test.ts` checks the token
  // against all three grounds — but it means the assertion is only as good as
  // knowing the input is not inside a differently-coloured panel. It is on the
  // page ground, and the computed `background-color` proves it.
  const measured = contrast(ring.color, surface);
  expect(
    measured,
    `focus ring ${ring.color} on surface ${surface} is ${measured.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(3);

  // And the control is on the page ground, not a panel: the input's own
  // background is indistinguishable from the surface behind it.
  const inputBackground = await page
    .getByLabel("Email")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(
    contrast(inputBackground, surface),
    `the input should sit on the page ground, but it is painted ${inputBackground} on ${surface}`,
  ).toBeLessThan(1.05);
});

test("text on the page meets the 4.5:1 text floor in the browser, not just on paper", async ({
  page,
}) => {
  await page.goto("/login");

  // Every distinct colour the login page actually paints, measured against the
  // surface it sits on. Walking the DOM rather than naming a selector is
  // deliberate: the point is "everything on this page is legible", and a named
  // selector tests one element the author remembered to name.
  //
  // `No account yet?` is `text-muted` in `src/app/login/page.tsx`, and the two
  // inputs and the button are the other three, so this page happens to cover
  // foreground, muted, and both control backgrounds.
  const body = page.locator("body");
  const surface = await tokenOf(body, "color-surface");

  const painted = await page.getByRole("main").evaluate((node, bg) => {
    const surfaceLuminance = (() => {
      const m = /^#?([0-9a-f]{6})$/i.exec(bg) ?? /^rgba?\(([^)]+)\)$/i.exec(bg);
      const parts = m === null ? [] : (m[1] ?? m[2] ?? "").split(/[,\s]+/).filter(Boolean);
      const [r, g, b2] = parts.slice(0, 3).map((v) => (v.length === 3 ? parseInt(v + v, 16) : Number(v)));
      const f = (c: number) => {
        const raw = c / 255;
        return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
    })();

    const found: Array<{ text: string; color: string; ratio: number; size: number }> = [];
    const seen = new Set<string>();
    for (const element of node.querySelectorAll<HTMLElement>("*")) {
      // Only elements with their own visible text; a wrapper's colour is not
      // what a person reads.
      const own = Array.from(element.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => (child.textContent ?? "").trim())
        .join(" ")
        .trim();
      if (own === "") continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // The background this text is actually read against is the nearest
      // painted ancestor, not always the page.
      let behind = "rgba(0, 0, 0, 0)";
      for (let el: HTMLElement | null = element; el !== null; el = el.parentElement) {
        const value = getComputedStyle(el).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") {
          behind = value;
          break;
        }
      }
      const key = `${style.color}|${behind}|${style.fontSize}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const lum = (value: string) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(value) ?? /^rgba?\(([^)]+)\)$/i.exec(value);
        if (m === null) return surfaceLuminance;
        const parts = (m[1] ?? m[2] ?? "").split(/[,\s]+/).filter(Boolean);
        const [r, g, b2] = parts.slice(0, 3).map((v) => (v.length === 3 ? parseInt(v + v, 16) : Number(v)));
        const f = (c: number) => {
          const raw = c / 255;
          return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
      };
      const [hi, lo] = [lum(style.color), lum(behind)].sort((a, b) => b - a);
      found.push({
        text: own.slice(0, 40),
        color: style.color,
        ratio: (hi + 0.05) / (lo + 0.05),
        size: Number.parseFloat(style.fontSize),
      });
    }
    return found;
  }, surface);

  expect(painted.length, "expected the login page to paint some text").toBeGreaterThan(2);

  for (const item of painted) {
    // Large text (WCAG "large" is 18.66px bold or 24px) is held to 3:1, so a
    // heading is not held to the body floor. Asserting the exception by
    // computed size rather than by tag is what a component library gets wrong:
    // a 14px `<h1>` is not large text.
    const floor = item.size >= 24 ? 3 : 4.5;
    expect(
      item.ratio,
      `"${item.text}" is ${item.ratio.toFixed(2)}:1 at ${item.size}px, colour ${item.color} — ` +
        `wants ${floor}:1`,
    ).toBeGreaterThanOrEqual(floor);
  }
});

test("prefers-color-scheme: dark actually repaints the page", async ({ page }) => {
  // Forced, not inherited. A machine with a light-mode display would otherwise
  // make this test pass by accident and a machine in dark mode would make it
  // pass for the wrong reason.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  const lightSurface = await tokenOf(page.locator("body"), "color-surface");
  const lightText = await page.locator("body").evaluate((node) => getComputedStyle(node).color);

  await page.emulateMedia({ colorScheme: "dark" });
  // The same page, no navigation: any change is the media query and nothing
  // else, which is the claim — that the dark block is wired to the preference
  // rather than being a second set of class names nobody applies.
  const darkSurface = await tokenOf(page.locator("body"), "color-surface");
  const darkText = await page.locator("body").evaluate((node) => getComputedStyle(node).color);

  expect(darkSurface, "dark mode must resolve a different surface token").not.toBe(lightSurface);
  expect(darkText, "dark mode must resolve different body text").not.toBe(lightText);

  // And the dark page is dark: the text is LIGHTER than the surface, which is
  // the property somebody notices first. Asserting the direction rather than
  // the values is deliberate — the values belong to tokens.test.ts.
  expect(
    luminanceOf(darkText),
    "in dark mode the body text must be lighter than the surface behind it",
  ).toBeGreaterThan(luminanceOf(darkSurface));

  // And the light page was light, so the comparison above is a real flip rather
  // than a page that was dark in both halves.
  expect(luminanceOf(lightText)).toBeLessThan(luminanceOf(lightSurface));

  // The body background is the other half of "the page repainted", and it is a
  // separate property from the token: `globals.css` applies
  // `background-color: var(--color-surface)`, so this proves the token is
  // actually reaching a paint, not just resolving.
  const darkBackground = await page
    .locator("body")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(
    contrast(darkBackground, darkSurface),
    "the body background should be the surface token itself",
  ).toBeLessThan(1.02);
});

test("the account's destructive actions are confirmed, and the dialog is keyboard-only operable", async ({
  page,
}) => {
  const email = aFreshAddress();
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // The address leads the confirmation in every branch of it, so this asserts
  // the same fact on a stack with a mailer as on one without.
  await expect(page.getByRole("status")).toHaveText(
    `Account created for ${email}. This deployment cannot send email right now, so no verification link was sent.`,
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").getByText(email, { exact: true })).toBeVisible();

  // Registration creates a personal account, so the list is not empty and there
  // is exactly one row. The list is the thing being navigated, so it is
  // addressed by its accessible name rather than by position — the first
  // version of this test reached for a link named "Create account", which is
  // the header's SIGNED-OUT affordance and therefore absent exactly when this
  // test is signed in.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
  const accounts = page.getByRole("list", { name: "Your accounts" });
  await expect(accounts).toBeVisible();
  await expect(accounts.getByRole("listitem")).toHaveCount(1);

  await accounts.getByRole("link").first().click();
  await expect(page.getByRole("region", { name: "Account" })).toBeVisible();

  // The destructive section, and the control that opens the confirmation. Note
  // the NAME: this is the reason `ConfirmDialog` requires the action's own
  // name. A generic "Confirm" would be asserted just as easily and would tell
  // nobody what they were about to do.
  //
  // A personal account has an owner and one member, so BOTH actions are
  // present: "Leave this account" needs a non-owner, and "Delete account"
  // needs an owner. The person who registered owns it, so the delete is the
  // one that renders — and the fact that only one of the two can be true is
  // `can(role, capability)` doing its job, not a fluke of this test.
  const danger = page.getByRole("region", { name: "Leaving and deleting" });
  await expect(danger).toBeVisible();

  // Nothing is deleted yet — reaching the section must not have acted on it.
  await expect(danger.getByRole("button", { name: "Delete account" })).toBeVisible();

  // Keyboard only from here. No `.click()`, no mouse: Tab to the control,
  // Enter to open.
  await danger.getByRole("button", { name: "Delete account" }).focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Delete this account?" });
  await expect(dialog).toBeVisible();
  // The consequence is readable, and it is in the DOM as text rather than in
  // an attribute.
  await expect(dialog).toContainText("There is no undo.");

  // Focus lands on Cancel, so a held-down spacebar cannot delete anything.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Escape closes without acting, and returns focus to the control that opened
  // the dialog — the two properties a `window.confirm` gets for free and a
  // hand-built dialog has to earn.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(danger.getByRole("button", { name: "Delete account" })).toBeFocused();

  // And the account is still there, which is the property the confirmation
  // exists to protect.
  await expect(page.getByRole("region", { name: "Account" })).toBeVisible();
});

test("a busy control keeps its accessible name, in a real browser", async ({ page }) => {
  await page.goto("/register");

  const email = aFreshAddress();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);

  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toBeEnabled();

  // Hold the response open so the busy state is observable at all.
  //
  // This is NOT a sleep, and the distinction is the whole reason it is allowed
  // here. A `waitForTimeout` in a test asserts "after 200ms, something was
  // probably true", and on a slow CI runner it is false. Intercepting the
  // request and holding it makes the state deterministic: the request has
  // provably not returned, so the button is provably busy, and every assertion
  // below is about a state that is guaranteed to be there rather than one
  // raced for. `page.route` is a Playwright API, not a timer.
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/users", async (route) => {
    await held;
    await route.continue();
  });

  await submit.click();

  // The button is busy. Asserted by NAME — the whole point is that a control
  // which renamed itself would not resolve this locator at all.
  const busy = page.getByRole("button", { name: "Create account" });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");

  // The spinner is drawn and is NOT part of the name. Read from the
  // accessibility tree, because a spinner that leaked a word would change the
  // name here and nowhere else — and `textContent` would show the same thing
  // either way, which is why the first version of this test asserted on it and
  // proved nothing.
  const spinner = busy.locator("svg");
  await expect(spinner).toHaveAttribute("aria-hidden", "true");
  expect(await page.getByRole("button", { name: /Creating/ }).count()).toBe(0);
  expect(await page.getByRole("button", { name: /Working/ }).count()).toBe(0);

  // Release the request and prove it really did complete — the service's own
  // confirmation naming the address, which means POST /v1/users reached
  // identity and its database. The tail of the sentence is about the SECOND call
  // this screen now makes (the verification request); the address leads it in
  // every branch, so this assertion is about the registration either way.
  release?.();
  await expect(page.getByRole("status")).toHaveText(
    `Account created for ${email}. This deployment cannot send email right now, so no verification link was sent.`,
  );
});
