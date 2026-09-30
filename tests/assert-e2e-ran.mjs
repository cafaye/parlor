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

/** Must match MINIMUM_TESTS in e2e/no-token-artifacts.ts. */
const MINIMUM_TESTS = 2;

const reportPath = process.argv[2] ?? "e2e-results.json";

function fail(message) {
  process.stderr.write(`[e2e] FAIL: ${message}\n`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  fail(
    `cannot read the end-to-end report at ${reportPath} (${error.message}). ` +
      "A tier with no report cannot be shown to have run anything; check the " +
      "`reporter` block in playwright.config.ts.",
  );
}

const stats = report?.stats ?? {};
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
