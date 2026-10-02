import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The server/client boundary, enforced.
 *
 * ---------------------------------------------------------------------------
 * WHY A CHECK IS NEEDED AT ALL, GIVEN `next build` ALREADY CATCHES THIS
 * ---------------------------------------------------------------------------
 * It catches it, but only when a Server Component actually reaches the file
 * through a barrel. That condition is not a property of the file — it is a
 * property of every importer, today. `src/components/ui/index.ts` re-exports
 * everything, so which of those components are reachable from a Server
 * Component is a question with an answer that changes every time somebody adds
 * an import, and nothing records the answer.
 *
 * The consequence is a file that is one careless barrel import away from a red
 * build, while passing every other gate. This check makes the file itself
 * responsible for being well-formed: if it calls hooks, it says `"use client"`.
 * That is checkable in isolation, without a hypothetical future importer.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT THE OBVIOUS CHECK — A FILE-LEVEL `"use client"` ON EVERYTHING
 * ---------------------------------------------------------------------------
 * Because that passes this suite and ships the wrong thing. The directive has
 * to be per-file, and the unit that needs it is the component that calls hooks
 * — not the directory it happens to sit in. A file holding one hook-free,
 * purely presentational component and one interactive dialog cannot be resolved
 * correctly in either direction:
 *
 *   - No directive: a Server Component importing the presentational one
 *     compiles the file as a Server Component, and calling `useState` in it
 *     fails the build.
 *   - Directive: the presentational component ships hydration JavaScript to
 *     render a `<div>` with a `role`, on every server-rendered page that uses
 *     one, which is most of them.
 *
 * So the rule this enforces is deliberately the *narrow* one. It does not try
 * to decide which components ought to be server-rendered — that is a design
 * judgement, and a script guessing at it would be wrong more often than it was
 * right. It only refuses the state where a file's own correctness depends on
 * who imports it.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS PREVENTS, REPRODUCED RATHER THAN DESCRIBED
 * ---------------------------------------------------------------------------
 * A one-route probe — a Server Component rendering `Callout`, imported from
 * `@/components/ui` like everything else — was built against both trees.
 *
 * Before the split, `next build` fails:
 *
 *   Error: You're importing a module that depends on `useEffect` into a
 *   React Server Component module. This API is only available in Client
 *   Components. To fix, mark the file (or its parent) with the
 *   `"use client"` directive.
 *     ./src/app/probe-server/page.tsx
 *
 * After the split, that same route compiles and prerenders as a static page.
 *
 * The error text is the trap, and it is worth reading twice. Followed
 * literally — "mark the file with the directive" — it produces a tree that
 * builds and ships a client bundle for a `<div>` with a `role`, on every page
 * that uses one. The compiler is telling the truth about the error and the
 * wrong thing about the fix, because it cannot see that the file has a second,
 * hook-free resident whose entire value is being free.
 *
 * ---------------------------------------------------------------------------
 * WHY COMMENTS AND STRINGS ARE STRIPPED, AND WHY THAT IS NOT FINE DETAIL
 * ---------------------------------------------------------------------------
 * Because the files most likely to mention hook names are the ones documenting
 * this very rule. `feedback.tsx` and `confirm-dialog.tsx` both explain
 * themselves in terms of `useId`, `useEffect` and `useCallback` — and a regex
 * that counted those would report the two most correct files in the directory
 * as the two broken ones. A guard that cries wolf on its own documentation gets
 * deleted, and then it protects nothing.
 */

/**
 * Files that never ship, so the rule does not apply to them.
 */
const EXCLUDED = [/\.test\.tsx?$/, /\.stories\.tsx?$/, /\.d\.ts$/];

const SRC = resolve(process.cwd(), "src");

/**
 * Strip comments — and, when asked, string literals too.
 *
 * Newlines are preserved rather than replaced so that a reported line number
 * still points at the right line of the original file. A guard that names a
 * line which has drifted is worse than one that names no line, because it is
 * believed and then not reproducible.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE STRING-AWARE SCANNER AND NOT TWO GREPS
 * ---------------------------------------------------------------------------
 * Because the two consumers need opposite halves of the file and a grep cannot
 * tell them apart. `"use client"` is itself a string literal, so the check that
 * looks for the directive has to keep strings; a hook name mentioned inside a
 * className or a comment has to lose them. Stripping both for the directive
 * check deletes the very thing it is looking for — which is what the first
 * version of this did, and it reported seven correctly-declared client screens
 * as undeclared.
 *
 * It also has to be string-aware rather than comment-aware only: this codebase
 * has `https://` in strings, and a scanner that treats `//` as a comment start
 * unconditionally will silently truncate every file it examines.
 */
function scan(source: string, keepStrings: boolean): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];

    if (state === "code") {
      if (two === "//") {
        state = "line";
        i += 2;
        continue;
      }
      if (two === "/*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        state = ch === '"' ? "double" : ch === "'" ? "single" : "template";
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += "\n";
      }
      i += 1;
      continue;
    }

    if (state === "block") {
      if (two === "*/") {
        state = "code";
        i += 2;
        continue;
      }
      if (ch === "\n") out += "\n";
      i += 1;
      continue;
    }

    // Inside a string literal. Escape handling is unconditional, because a
    // backslash-escaped quote is the same problem in both modes.
    if (ch === "\\") {
      if (keepStrings) out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (state === "single" && ch === "'") state = "code";
    if (state === "double" && ch === '"') state = "code";
    if (state === "template" && ch === "`") state = "code";
    if (keepStrings) out += ch;
    else if (ch === "\n") out += "\n";
    i += 1;
  }
  return out;
}

/** Comments gone, strings intact — for looking for a string-literal directive. */
function stripComments(source: string): string {
  return scan(source, true);
}

/** Comments and strings gone — for looking for code. */
function stripCommentsAndStrings(source: string): string {
  return scan(source, false);
}

/** Every `.tsx` under `src`, excluding tests. */
function componentFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      componentFiles(full, found);
      continue;
    }
    if (!entry.endsWith(".tsx")) continue;
    if (EXCLUDED.some((pattern) => pattern.test(entry))) continue;
    found.push(full);
  }
  return found;
}

/**
 * The `"use client"` directive, if the file has one.
 *
 * Read from the stripped source so a directive quoted inside a doc comment
 * does not count. The check is anchored to the first statement rather than
 * "anywhere in the file", because the directive only works as the first
 * statement — one `import` above it and it is a no-op that still satisfies a
 * naive grep.
 */
function hasUseClient(source: string): boolean {
  const bare = stripComments(source);
  const firstStatement = bare
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return /^["']use client["'];?$/.test(firstStatement ?? "");
}

/**
 * The hooks a file calls, with the line each first appears on.
 *
 * ---------------------------------------------------------------------------
 * ANY `useX(`, NOT A LIST OF REACT'S OWN
 * ---------------------------------------------------------------------------
 * The first version of this enumerated React's exported hooks and passed,
 * and was wrong about both of the files it waved through.
 * `components/shell/header.tsx` declares `"use client"` and calls no React hook
 * at all — it calls `useAuth()`. `app/billing/plans/plans-screen.tsx` calls
 * `useBilling()` and `useInfiniteQuery()`. All three are hooks by every
 * definition that matters, all three make the file a Client Component, and an
 * enumeration of React's exports can see none of them, because a hook is not
 * something React ships; it is a naming convention the codebase follows.
 *
 * So the pattern is the convention itself: `use` followed by a capital, then a
 * call. That is the same rule the linter ecosystem applies, for the same
 * reason — the alternative is a list that is silently out of date the first
 * time somebody writes a hook. React's own `use(promise)` is excluded by the
 * capital, since it is a different call and not a hook by this convention.
 */
function hooksCalled(source: string): Array<{ hook: string; line: number }> {
  const bare = stripCommentsAndStrings(source);
  const lines = bare.split("\n");
  const found: Array<{ hook: string; line: number }> = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\b(use[A-Z]\w*)\s*\(/g)) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      found.push({ hook: match[1], line: index + 1 });
    }
  });
  return found;
}

describe("the server/client boundary", () => {
  it("no component calls a hook without declaring itself a Client Component", () => {
    const root = SRC;
    const offenders: string[] = [];

    for (const file of componentFiles(root)) {
      const source = readFileSync(file, "utf8");
      const hooks = hooksCalled(source);
      if (hooks.length === 0) continue;
      if (hasUseClient(source)) continue;
      const names = hooks.map(({ hook, line }) => `${hook} (line ${line})`).join(", ");
      offenders.push(`${file.slice(root.length + 1)}: ${names}`);
    }

    expect(
      offenders,
      `these files call hooks but do not start with "use client", so any Server Component ` +
        `reaching them through @/components/ui fails \`next build\` — and jsdom cannot see it, ` +
        `because jsdom has no server/client boundary to cross. Move the hook-using component into ` +
        `its own file with the directive, rather than adding the directive to the whole file, ` +
        `which would ship a client bundle for every hook-free sibling in it:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * The mirror image, and the reason the check above is allowed to exist.
   *
   * If `"use client"` were added to a file whose only components are pure
   * presentation, nothing would go red. The build passes, the tests pass, and
   * the cost lands on every user as hydration JavaScript for markup that could
   * have been sent as markup. A green suite that permits a silent regression is
   * not a safety net.
   *
   * ---------------------------------------------------------------------------
   * WHAT THIS DOES *NOT* CATCH, MEASURED RATHER THAN ASSUMED
   * ---------------------------------------------------------------------------
   * It does not catch the lazy repair of the very defect the first test is
   * about. Re-adding `ConfirmDialog` to `feedback.tsx` and putting a
   * file-level `"use client"` on the result is caught — but by the third test,
   * not this one. The reason is structural and worth stating rather than
   * papering over: that file would contain both a directive and a hook, which
   * is exactly what a correct client file looks like. From here it is
   * indistinguishable, and the third test is what keeps the specific split
   * honest by naming the two files.
   *
   * So this test is narrow on purpose, and its known blind spot is:
   * **a Client Component that is one only because it hands a callback to a
   * child.** Such a file calls no hook and legitimately needs the directive.
   * If one is ever written, this will report it as an offender and the honest
   * response is a one-line comment saying so and an exclusion here — not
   * deleting the check, and not marking a presentational file as a client
   * component to make the check quiet.
   */
  it("a file with no hooks does not declare itself a Client Component", () => {
    const offenders: string[] = [];

    for (const file of componentFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      if (hooksCalled(source).length > 0) continue;
      if (!hasUseClient(source)) continue;
      offenders.push(file.slice(SRC.length + 1));
    }

    expect(
      offenders,
      `these files declare "use client" but call no hook, so every component in them ships ` +
        `hydration JavaScript for nothing:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * Both halves are worth asserting as a fact rather than only as a guard.
   *
   * If `confirm-dialog.tsx` ever loses its directive, the first test catches
   * it. If `feedback.tsx` ever absorbs it back, the second catches it. But the
   * pair is only meaningful because `Callout` is genuinely reachable as a
   * Server Component today — and that is exactly the property a future edit
   * could quietly destroy while both guards stayed green.
   */
  it("the split that makes the barrel safe is still in place", () => {
    // Both files are read with comments AND strings removed. Read raw, the
    // assertion below fails for the best possible reason: `feedback.tsx`
    // explains at length why `ConfirmDialog` moved out, and its doc comment
    // says the name. The same is true of the hook assertion — both files
    // document the rule in terms of `useId` and `useEffect`.
    //
    // Which is the whole argument for stripping, arrived at from the other
    // direction: the files that understand this rule best are the files a
    // naive version of this test condemns.
    const feedback = stripCommentsAndStrings(
      readFileSync(resolve(SRC, "components/ui/feedback.tsx"), "utf8"),
    );
    const dialog = stripCommentsAndStrings(
      readFileSync(resolve(SRC, "components/ui/confirm-dialog.tsx"), "utf8"),
    );

    expect(feedback, "Callout's file must stay hook-free").not.toMatch(/\buse[A-Z]\w*\s*\(/);
    // `hasUseClient`, not a regex against the stripped text: the directive IS a
    // string literal, so the stripped copy cannot contain it. Reading the
    // comments-only form is what makes this assertion mean anything.
    expect(hasUseClient(readFileSync(resolve(SRC, "components/ui/confirm-dialog.tsx"), "utf8"))).toBe(
      true,
    );
    expect(feedback, "the dialog must not live in Callout's file any more").not.toContain(
      "ConfirmDialog",
    );
    expect(dialog, "Callout must not live in the dialog's file").not.toContain("export function Callout");
  });
});