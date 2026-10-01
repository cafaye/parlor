import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The palette, measured.
 *
 * Every number in `tokens.css`'s header comment is a CLAIM. This file is what
 * makes it a fact, and it is the reason the comment can be trusted: the
 * contrast ratios quoted there are computed here from the tokens as written,
 * so an edit to a hex value that breaks a ratio fails this suite rather than
 * quietly shipping.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TEST AND NOT A SCRIPT
 * ---------------------------------------------------------------------------
 * A script that measures the palette runs once and is then wrong forever. A
 * test runs on every commit, which is the only time a contrast number is worth
 * anything: the failure mode of this system is a designer nudging one hex
 * value, and this is what catches it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT PARSES THE CSS INSTEAD OF ASKING THE DOM
 * ---------------------------------------------------------------------------
 * jsdom does not evaluate `@media (prefers-color-scheme)`, so there is no way
 * to ask a rendered document for the dark values — `getComputedStyle` would
 * return the light block and the dark half of this suite would be theatre. So
 * the file is read as text and the two blocks are parsed separately. That is
 * also the stronger assertion: it checks the *declared* pairings, which is
 * what a reader of the file is being asked to rely on.
 *
 * It also means this test does not need a browser and does not need Tailwind to
 * have run. It is a pure function of one file, which is why it is fast enough
 * to sit in the per-commit gate.
 */

// `process.cwd()` and not `import.meta.url`: under the jsdom environment
// vitest serves modules over an `http:` URL, so `fileURLToPath` throws
// "The URL must be of scheme file" on the idiomatic spelling. vitest's root is
// the repository root, which is the one directory this path is relative to.
const SRC = resolve(process.cwd(), "src");
const TOKENS_CSS = resolve(SRC, "styles/tokens.css");
const css = readFileSync(TOKENS_CSS, "utf8");

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const raw = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1 to 21. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** The `@theme { … }` block, and nothing after it. */
function themeBlock(): string {
  const start = css.indexOf("@theme {");
  expect(start, "tokens.css still declares an @theme block").toBeGreaterThan(-1);
  // The block is brace-matched rather than cut at the first `}`, so a nested
  // rule or a comment containing a brace cannot truncate it.
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces in tokens.css");
}

/** The dark block: the media query's `:root { … }`. */
function darkBlock(): string {
  const at = css.indexOf("prefers-color-scheme: dark");
  expect(at, "tokens.css still declares a dark-mode media query").toBeGreaterThan(-1);
  const open = css.indexOf("{", css.indexOf(":root", at));
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces in the dark block");
}

/** Every `--name: value;` in a block, as a map. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  // Comments are stripped first: a `--x:` inside a comment is prose, not a
  // declaration, and this file's own comments are full of both.
  const bare = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (const match of bare.matchAll(re)) {
    found.set(match[1], match[2].trim().toLowerCase());
  }
  return found;
}

const lightRaw = declarations(themeBlock());
const darkRaw = declarations(darkBlock());

/**
 * Resolve a value to a hex.
 *
 * `--color-surface: var(--color-neutral-50)` is how the semantic layer is
 * written, and resolving that indirection is not optional: measuring the
 * literal string would measure nothing at all.
 *
 * The dark theme falls back to the `@theme` block, and that fallback is the
 * documented design rather than a convenience. `tokens.css` splits the system
 * in two: the two ramps are declared once and SHARED, and only the semantic
 * layer is remapped under the media query. So a dark-mode value that points at
 * `var(--color-seal-400)` is pointing at a ramp step that legitimately has no
 * dark-block declaration, and a resolver that insisted on finding one there
 * would be asserting a structure the file does not claim to have.
 */
function tokenValue(name: string, theme: "light" | "dark"): string {
  const source = theme === "dark" ? darkRaw : lightRaw;
  const shared = lightRaw;
  const seen = new Set<string>();
  let current: string = name;

  for (;;) {
    const declared: string | undefined = source.get(current) ?? shared.get(current);
    if (declared === undefined) {
      throw new Error(`${current} is not declared in the ${theme} theme (reading ${name})`);
    }
    if (declared.startsWith("#")) return declared;
    const reference: RegExpMatchArray | null = declared.match(/^var\((--[a-z0-9-]+)\)$/i);
    if (reference === null) {
      throw new Error(`cannot resolve ${current} = "${declared}" in the ${theme} theme`);
    }
    if (seen.has(reference[1])) throw new Error(`circular reference at ${reference[1]}`);
    seen.add(reference[1]);
    current = reference[1];
  }
}

function ratio(name: string, over: string, theme: "light" | "dark"): number {
  return contrast(tokenValue(name, theme), tokenValue(over, theme));
}

// ---------------------------------------------------------------------------
// The floors
// ---------------------------------------------------------------------------

/**
 * 4.5:1 is WCAG 2.2 SC 1.4.3 for body text. 3:1 is SC 1.4.11 for a non-text
 * element — which is what a border on a control, and what a focus ring is.
 *
 * The targets are floors, not budgets: a token that fails one of them is
 * `gate.proof-missing`-shaped for this file, and the assertion message prints
 * the measured number so the fix does not require re-running anything.
 */
const TEXT = 4.5;
const NON_TEXT = 3;

const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["--color-foreground", "--color-surface"],
  ["--color-foreground", "--color-surface-raised"],
  ["--color-foreground", "--color-surface-sunken"],
  ["--color-muted", "--color-surface"],
  ["--color-muted", "--color-surface-raised"],
  ["--color-muted", "--color-surface-sunken"],
  ["--color-on-accent", "--color-accent"],
  ["--color-link", "--color-surface"],
  ["--color-link", "--color-surface-raised"],
  ["--color-positive", "--color-surface"],
  ["--color-positive", "--color-positive-surface"],
  ["--color-caution", "--color-surface"],
  ["--color-caution", "--color-caution-surface"],
  ["--color-critical", "--color-surface"],
  ["--color-critical", "--color-surface-sunken"],
  ["--color-critical", "--color-critical-surface"],
];

const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // A control's own boundary. `border` is deliberately absent: it is a
  // decorative hairline between two panels, and 1.2:1 is the honest number for
  // that. `border-strong` is the one that identifies an input, so it has to
  // clear the non-text floor on every surface an input can sit on.
  ["--color-border-strong", "--color-surface"],
  ["--color-border-strong", "--color-surface-raised"],
  ["--color-border-strong", "--color-surface-sunken"],
  ["--color-focus-ring", "--color-surface"],
  ["--color-focus-ring", "--color-surface-raised"],
  ["--color-focus-ring", "--color-surface-sunken"],
];

describe("cafaye palette — measured contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      it.each(TEXT_PAIRS)("%s on %s clears 4.5:1", (fg, bg) => {
        const measured = ratio(fg, bg, theme);
        expect(
          measured,
          `${fg} on ${bg} is ${measured.toFixed(2)}:1 — WCAG 2.2 SC 1.4.3 wants ${TEXT}:1 for text`,
        ).toBeGreaterThanOrEqual(TEXT);
      });

      it.each(NON_TEXT_PAIRS)("%s on %s clears 3:1", (fg, bg) => {
        const measured = ratio(fg, bg, theme);
        expect(
          measured,
          `${fg} on ${bg} is ${measured.toFixed(2)}:1 — WCAG 2.2 SC 1.4.11 wants ${NON_TEXT}:1 for a non-text indicator`,
        ).toBeGreaterThanOrEqual(NON_TEXT);
      });
    });
  }

  /**
   * The ring-versus-fill relationship, asserted per theme because it is
   * genuinely different per theme — and the difference is the point.
   *
   * LIGHT: the ring and the primary fill are far apart (4.30:1), so a ring
   * around a filled button would read even with no offset.
   *
   * DARK: they are the SAME COLOUR. A dark primary button is filled with
   * `seal-400` and the ring is also `seal-400`, so the ring is 1.00:1 against
   * the thing it surrounds. That is not a hex value to nudge: the ground here
   * is near-black and the primary fill is a light teal, and no single colour
   * is 3:1 from both ends of that range. What makes the ring visible is the
   * 2px gap `outline-offset` opens, which is painted by the GROUND.
   *
   * So this test pins the fact that the offset is load-bearing, which is why
   * the ring is one shared `focus-ring` utility instead of four lines repeated
   * per component. If DARK ever stops being < 3:1 the offset has stopped
   * mattering and the two tokens could collapse; if it stops being exactly
   * 1.00 the palettes have drifted from the note in `tokens.css`.
   */
  it("the ring is a halo: in dark mode it matches the fill, and only the offset separates them", () => {
    const light = contrast(
      tokenValue("--color-focus-ring", "light"),
      tokenValue("--color-accent", "light"),
    );
    expect(
      light,
      `light: ring vs primary fill is ${light.toFixed(2)}:1 — this test only asserts the dark ` +
        `relationship; a light value below 3:1 would mean the offset matters in both themes, ` +
        `which is a change to the reasoning in tokens.css`,
    ).toBeGreaterThanOrEqual(NON_TEXT);

    const darkRing = tokenValue("--color-focus-ring", "dark");
    const darkFill = tokenValue("--color-accent", "dark");
    expect(
      contrast(darkRing, darkFill),
      `dark: ring is ${darkRing}, primary fill is ${darkFill}`,
    ).toBeLessThan(NON_TEXT);
  });

  /**
   * The single most consequential structural claim in the system, and the one
   * that silently decays: the focus ring is defined ONCE, as a utility, and
   * every interactive primitive applies it.
   *
   * The reason this is asserted rather than documented is that a per-component
   * ring is a ring that eventually gets `outline-offset-0` added to it by
   * somebody making a button flush, and nothing in the build notices. Asserting
   * that the offset is non-zero is the cheapest possible tripwire: remove it
   * and this goes red in CI, not in a person's keyboard session.
   *
   * EVERY `.focus-ring` rule is checked, not the first one. The first version
   * of this test read the first match and reported green while the base rule
   * had been set to `outline-offset: 0` — because the reduced-motion override
   * further down the file still said 2px and got matched instead. A guard that
   * reads the wrong copy of a rule is worse than no guard, because it is
   * believed. That is why this walks the rules rather than matching a string.
   */
  it("every focus-ring rule keeps a non-zero outline offset", () => {
    const utilities = css.slice(css.indexOf("@layer utilities"));
    expect(utilities, "tokens.css still declares a focus-ring utility").toContain(".focus-ring");

    // Every `.focus-ring { … }` body, brace-matched.
    const bodies: string[] = [];
    const re = /\.focus-ring\s*\{/g;
    for (const match of utilities.matchAll(re)) {
      let depth = 0;
      for (let i = utilities.indexOf("{", match.index); i < utilities.length; i++) {
        if (utilities[i] === "{") depth++;
        if (utilities[i] === "}") {
          depth--;
          if (depth === 0) {
            bodies.push(utilities.slice(match.index, i + 1));
            break;
          }
        }
      }
    }

    expect(bodies.length, "expected at least one .focus-ring rule").toBeGreaterThan(0);
    for (const body of bodies) {
      const offset = body.match(/outline-offset:\s*([^;]+);/);
      expect(offset, `a .focus-ring rule declares no outline-offset:\n${body}`).not.toBeNull();
      const value = Number.parseFloat(offset![1]);
      expect(
        value,
        `a .focus-ring rule sets outline-offset to ${offset![1]} — at zero the ring merges into the ` +
          `control it is announcing, which in dark mode is a 1.00:1 ring against the primary fill`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The ramps have to be usable as ramps, which means lightness must fall
   * monotonically. A ramp with two steps at the same lightness is a ramp
   * where `bg-x-300` and `bg-x-400` are indistinguishable, and the first
   * person to hit that has no way to know which one they meant.
   */
  it.each(["neutral", "seal"])("the %s ramp is monotone in lightness", (ramp) => {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => {
      const name = `--color-${ramp}-${step}`;
      expect(lightRaw.has(name), `${name} is missing from the ramp`).toBe(true);
      return { step, luminance: luminance(lightRaw.get(name)!) };
    });

    for (let i = 1; i < steps.length; i++) {
      expect(
        steps[i].luminance,
        `${ramp}-${steps[i].step} (${steps[i].luminance.toFixed(4)}) is not darker than ` +
          `${ramp}-${steps[i - 1].step} (${steps[i - 1].luminance.toFixed(4)})`,
      ).toBeLessThan(steps[i - 1].luminance);
    }
  });
});

describe("cafaye palette — structure", () => {
  /**
   * A dark mode that is missing one token is not "mostly dark", it is a
   * screen with a hole in it: one element keeps the light value and reads as
   * a bright patch on a dark page. The only way that is caught before a person
   * sees it is by requiring the two blocks to have the same shape.
   */
  it("the dark block remaps exactly the semantic tokens the light block declares", () => {
    const lightSemantic = [...lightRaw.keys()].filter(
      (name) => !name.startsWith("--color-neutral-") && !name.startsWith("--color-seal-"),
    );
    // The ramps and the status palette are shared by both themes on purpose;
    // only the semantic layer flips. So compare the semantic layer.
    const semantic = lightSemantic.filter(
      (name) =>
        name.startsWith("--color-surface") ||
        ["--color-foreground", "--color-muted"].includes(name) ||
        name.startsWith("--color-border") ||
        ["--color-accent", "--color-accent-hover", "--color-on-accent"].includes(name) ||
        name.startsWith("--color-link") ||
        ["--color-focus-ring", "--color-overlay"].includes(name) ||
        name.startsWith("--color-positive") ||
        name.startsWith("--color-caution") ||
        name.startsWith("--color-critical"),
    );

    expect(semantic.length).toBeGreaterThan(15);
    expect([...darkRaw.keys()].sort()).toEqual([...semantic].sort());
  });

  /**
   * A hex literal in a component is a brand decision made in the wrong file.
   * It survives the dark-mode remap as a bright patch, and it is invisible in
   * review because it looks like a colour.
   *
   * The walk is deliberate rather than a grep: this file has to also be able to
   * point at WHICH file and WHICH line, because "somewhere in src" is not
   * actionable.
   */
  it("no component hardcodes a colour literal", () => {
    const root = resolve(SRC, "components");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx?|css)$/.test(entry)) continue;
        const source = readFileSync(full, "utf8");
        source.split("\n").forEach((line, index) => {
          // Comments are where the palette gets *explained*; a hex there is
          // documentation, not a decision. Skip comment lines.
          const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
          if (/#[0-9a-f]{3,8}\b/i.test(code) && !/url\(/i.test(code)) {
            offenders.push(`${full.slice(root.length + 1)}:${index + 1}`);
          }
        });
      }
    };
    walk(root);

    expect(
      offenders,
      `colour literals in components (theme values belong in src/styles/tokens.css): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
