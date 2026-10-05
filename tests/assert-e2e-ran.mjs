/**
 * Fails a run of the end-to-end tier that verified nothing.
 *
 *   node tests/assert-e2e-ran.mjs e2e-results.json
 *
 * This exists because of one specific, measured failure shape: a test command
 * that exits 0 having run fewer tests than the tier claims to have. A
 * `testMatch` that stopped matching, a `grep` left in a CI invocation, a spec
 * renamed out of the glob — each is a green run and a packet that checked
 * nothing, and each is exactly what "a CI job which silently skips its hard half
 * is worse than no CI" means (PLAN.md §1).
 *
 * The floor is a floor, not the expected count on purpose. Adding a spec must not
 * require editing this file, so the number cannot go stale into meaninglessness;
 * it is the number below which the tier has lost a whole subject. The count that
 * is *reported* is the number in the report.
 *
 * Three ways this fails, all of them real failure modes:
 *
 *   * no report file at all — the JSON reporter did not run;
 *   * fewer than the floor passed — the tier was filtered or its specs stopped
 *     being collected;
 *   * anything skipped — a skip in this tier is a claim nobody checked, and the
 *     tier has no skip mechanism on purpose (see bin/e2e).
 *
 * The same floor is asserted a second time, in e2e/no-token-artifacts.ts, so the
 * guarantee holds for a developer who runs `npx playwright test` without this
 * script. Two implementations of one rule is the price of the rule holding on
 * both paths; they read the same file and the same key, and MINIMUM_TESTS here
 * must match the constant there.
 */
import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * `process` is IMPORTED rather than reached for as a global.
 *
 * kit's ESLint config applies `js.configs.recommended`, which turns on
 * `no-undef`, and typescript-eslint's override that turns it back off again is
 * scoped to TypeScript's four extensions — a `.mjs` file is not one of them,
 * and kit's config declares no globals of its own. So `process` here is an
 * undefined identifier as far as the linter is concerned, and it is right to be:
 * a script that decides whether a run verified anything should not depend on an
 * ambient global it never asked for.
 *
 * Naming `node:process` is also the honest dependency — the same reason
 * `node:fs` is imported on the line above rather than `fs`.
 */

/** Must match MINIMUM_TESTS in e2e/no-token-artifacts.ts. */
const MINIMUM_TESTS = 2;

const reportPath = process.argv[2] ?? "e2e-results.json";

function fail(message) {
  process.stderr.write(`[e2e] FAIL: ${message}\n`);
  process.exit(1);
}

/**
 * Playwright's JSON reporter's `stats`, and nothing else.
 *
 * `JSON.parse` is `any`, so the `@type` below is what turns it into a shape a
 * reader can check — which is what
 * `@typescript-eslint/no-unsafe-assignment` and `no-unsafe-member-access` are
 * pointing at, five findings that were one root cause at an untyped boundary.
 *
 * JSDoc and NOT a TypeScript `as`, and that is measured rather than stylistic.
 * `checkJs` is off in `tsconfig.json`, so `npm run typecheck` does not report
 * anything about this file and reported nothing about a TypeScript `as` in it;
 * ESLint's project service does read types here, and it was perfectly happy with
 * one — and then `node` refused to run the file at all, with
 * `SyntaxError: Unexpected identifier 'as'`. A green lint and a green typecheck
 * over a script the end-to-end job runs by name is the exact shape this
 * repository is written against. JSDoc is an annotation a `.mjs` file can carry
 * and node can still execute.
 *
 * Every field is `unknown` rather than `number` because this is a file on disk
 * that anybody can edit. `Number(…)` below is what turns "absent", "null" and
 * `"3"` into the number the floor is compared against, and a report that omits
 * one of them has to fail the floor rather than pass by being undefined.
 *
 * @typedef {object} ReportStats
 * @property {unknown} [expected]
 * @property {unknown} [unexpected]
 * @property {unknown} [flaky]
 * @property {unknown} [skipped]
 */

/**
 * The report, read and typed.
 *
 * TWO steps, and the first one is the point. `JSON.parse` is typed `any`, and
 * `any` is not a type — it is the absence of one, and every rule in this family
 * is about an `any` travelling further than it should. So the parsed bytes go
 * into an `unknown` first, which says exactly what they are: whatever is in that
 * file, unexamined. Only then is the shape asserted.
 *
 * Measured, because the shorter spellings were tried first and each was wrong in
 * a different way. A JSDoc cast placed on the `JSON.parse` call itself is NOT
 * applied — ESLint still reported `no-unsafe-assignment` on the assignment with
 * it sitting directly above. The same cast on a `return` expression is not
 * applied either, and reports `no-unsafe-return` instead. A cast whose operand
 * is ALREADY `unknown` is applied and is clean, and it is the only one of the
 * three that is also the honest description: you cannot narrow bytes you have
 * not first admitted you know nothing about.
 *
 * It is JSDoc and not a TypeScript `as` because this file is executed by `node`
 * by name. `checkJs` is off, so `npm run typecheck` reported nothing about a
 * TypeScript assertion here; ESLint's project service was perfectly happy with
 * one; and `node` then refused to run the file at all —
 * `SyntaxError: Unexpected identifier 'as'`. A green lint and a green typecheck
 * over a script the end-to-end job runs is the exact shape this repository is
 * written against.
 *
 * @param {string} path
 * @returns {{ stats?: ReportStats } | null}
 */
function readReport(path) {
  const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(path, "utf8")));
  return /** @type {{ stats?: ReportStats } | null} */ (parsed);
}

/** @type {ReportStats} */
let stats;
try {
  stats = readReport(reportPath)?.stats ?? {};
} catch (error) {
  fail(
    `cannot read the end-to-end report at ${reportPath} (${error.message}). ` +
      "A tier with no report cannot be shown to have run anything; check the " +
      "`reporter` block in playwright.config.ts.",
  );
}

const expected = Number(stats.expected ?? 0);
const unexpected = Number(stats.unexpected ?? 0);
const flaky = Number(stats.flaky ?? 0);
const skipped = Number(stats.skipped ?? 0);

if (expected < MINIMUM_TESTS) {
  fail(
    `the end-to-end tier passed ${expected} test(s); a tier that runs fewer than ` +
      `${MINIMUM_TESTS} has verified nothing. Either the specs were filtered out ` +
      "or the only ones that ran are the ones that cannot fail. This is a gate " +
      "failure, not a warning — see PLAN.md §1 on a gate that skips.",
  );
}

if (skipped > 0) {
  fail(
    `${skipped} end-to-end test(s) were skipped. A skip in this tier is a claim ` +
      "nobody checked, and the tier has no skip mechanism on purpose, so this " +
      "means one was added.",
  );
}

if (flaky > 0) {
  // `retries: 0` in the config means flaky is unreachable today. The check
  // exists so that raising retries — the change this packet refuses to make —
  // cannot be done quietly and then read as a green tier.
  fail(
    `${flaky} end-to-end test(s) only passed on retry. The config sets ` +
      "`retries: 0` and this tier refuses to raise it: a retry count is a way " +
      "of not finding out why the stack is flaky. Fix the mechanism.",
  );
}

process.stdout.write(
  `[e2e] the tier ran: ${expected} passed, ${unexpected} failed, ${skipped} skipped, ` +
    `${flaky} retried\n`,
);

// A non-zero exit here is the caller's business: this script only ever fails the
// "nothing ran" case, and the caller combines it with the test command's own
// status so a real assertion failure is reported by Playwright.
process.exit(0);
