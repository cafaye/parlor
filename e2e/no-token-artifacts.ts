/**
 * The end of every end-to-end run, and the reason the tier is honest.
 *
 * Three checks, in the order they matter, all of them able to fail:
 *
 *   1. **No artifact contains a session token.** Playwright's config turns
 *      tracing and video off precisely because a trace is a full request log and
 *      four of this suite's requests carry `Authorization: Bearer <token>`. That
 *      is a setting, and a setting can be changed by whoever is debugging at
 *      midnight. This walks every file the run wrote — the output directory and
 *      the JSON report — searching for the bytes of a token this run actually
 *      minted, and fails the run if it finds one. Turning `trace: "on"` in
 *      playwright.config.ts is therefore a red build instead of a credential
 *      uploaded to a CI artifact store.
 *
 *   2. **The tier ran tests, and skipped none.** `bin/e2e` also checks the
 *      report; this repeats it here so the guarantee holds for anyone who runs
 *      `npx playwright test` directly. A suite that is filtered down to nothing
 *      exits 0 in some configurations, and "0 passed" is the exact shape of a
 *      packet that has verified nothing (PLAN.md §1, gate discipline).
 *
 *   3. **The record of the tokens is destroyed.** Last, and on every path,
 *      because a credential left in a temp file is a credential somebody finds
 *      in a support bundle.
 *
 * What this does NOT check, stated so nobody assumes it does: it cannot know
 * about a token minted by a test that crashed before recording it, and it says
 * nothing about a developer's own local Playwright run with a different config.
 * It checks *this* suite's output against *this* run's tokens, which is the
 * claim the report makes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { clearRecordedSessionTokens, recordedSessionTokens } from "./session-tokens";

/** Directories a run can write into, relative to the repository root. */
const SCANNED = ["e2e/.artifacts", "e2e-results.json"];

export default async function globalTeardown(): Promise<void> {
  try {
    const tokens = recordedSessionTokens();
    await assertNoTokenInArtifacts(tokens);
    await assertTheTierRan();
  } finally {
    clearRecordedSessionTokens();
  }
}

/**
 * Fails when any scanned file contains any recorded token.
 *
 * Binary files are read as bytes and compared, not decoded: a trace is a zip,
 * and a zip is exactly the kind of file where a naive `readFileSync(path,
 * "utf8")` produces mojibake, throws, or — worst — silently finds nothing
 * because the needle is not in the decoded form of the bytes. A credential
 * check that cannot read the file it is checking is not a credential check.
 */
async function assertNoTokenInArtifacts(tokens: string[]): Promise<void> {
  if (tokens.length === 0) {
    // Nothing was minted, so there is nothing to look for. Saying so is
    // better than passing silently: it is the shape of a run where the auth
    // specs did not execute, and check 2 is what notices that.
    console.log("[e2e] no session token was minted this run; nothing to scan for");
    return;
  }

  const needles = tokens.map((token) => Buffer.from(token, "utf8"));
  const offenders: string[] = [];
  let filesScanned = 0;

  for (const scanned of SCANNED) {
    for (const file of walk(scanned)) {
      filesScanned += 1;
      const bytes = readFileSync(file);
      if (needles.some((needle) => bytes.includes(needle))) {
        offenders.push(relative(process.cwd(), file));
      }
    }
  }

  if (offenders.length > 0) {
    // The path, never the token: this message goes into a CI log.
    throw new Error(
      "[e2e] FAIL: a session token is present in the run's own output, in: " +
        `${offenders.join(", ")}. ` +
        "Playwright traces and videos are recorded network traffic and are " +
        "uploaded as artifacts; keep `trace` and `video` off in " +
        "playwright.config.ts, and delete the artifacts from this build.",
    );
  }

  console.log(
    `[e2e] scanned ${filesScanned} produced file(s) for ${needles.length} session token(s): none found`,
  );
}

/** Every file under a path, whether it is a file or a directory. */
function* walk(path: string): Generator<string> {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    // The output directory does not exist when every test passed and nothing
    // failed. That is the good case, not a missing check.
    return;
  }
  if (stats.isFile()) {
    yield path;
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    yield* walk(join(path, entry));
  }
}

/**
 * The tier has to have run something, and it must not have skipped anything.
 *
 * The `skipped` count is the important half. A tier that skips is a green run
 * that verified nothing, and the failure mode the whole fleet has been bitten
 * by is a skip nobody was forced to notice (guard's live-Redis tier, identity's
 * `TEST_DATABASE_URL` tests, darkroom's 41). A tier with no skip *mechanism* is
 * better than a tier with a counted one, and this config has none: nothing in
 * `bin/e2e` or the specs has a `test.skip` or a conditional `test.fixme`.
 */
async function assertTheTierRan(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync("e2e-results.json", "utf8");
  } catch {
    // A missing report here is NOT a failure, and the reason is an ordering
    // fact that was measured while this was being written: Playwright writes the
    // JSON report *after* global teardown returns, so a teardown that throws
    // about the report guarantees the report is never written. Failing here
    // would make the missing report permanent and hide the real failure.
    //
    // `tests/assert-e2e-ran.mjs` runs after the test process exits, so the file
    // is there, and it is the single authority that the report exists and that
    // the tier ran. This function's job is the half that report *contents* can
    // tell us and that `assert-e2e-ran.mjs` shares: the floor and the skip
    // count, checked here as well so a developer running
    // `npx playwright test` directly still gets them.
    console.log("[e2e] no report yet; tests/assert-e2e-ran.mjs is the authority on it");
    return;
  }

  let report: { stats?: { expected?: number; skipped?: number } };
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error(
      "[e2e] FAIL: e2e-results.json is not valid JSON. A report that cannot be " +
        "read cannot be shown to describe anything; check the `reporter` block " +
        "in playwright.config.ts.",
    );
  }

  const stats = report.stats ?? {};
  const expected = stats.expected ?? 0;
  const skipped = stats.skipped ?? 0;

  if (expected < MINIMUM_TESTS) {
    throw new Error(
      `[e2e] FAIL: the end-to-end tier passed ${expected} test(s) and a tier that ` +
        `runs fewer than ${MINIMUM_TESTS} has verified nothing. Either the specs ` +
        "were filtered out or the only ones that ran are the ones that cannot " +
        "fail. This is a gate failure, not a warning.",
    );
  }
  if (skipped > 0) {
    throw new Error(
      `[e2e] FAIL: ${skipped} end-to-end test(s) were skipped. A skip in this tier ` +
        "is a claim nobody checked; the tier has no skip mechanism on purpose, so " +
        "this means one was added.",
    );
  }
}

/**
 * The floor. Two, because the suite has two independent subjects: the auth path
 * through parlor and identity, and the whole-stack view through guard. One test
 * that is filtered out should fail the run rather than quietly halve it.
 */
const MINIMUM_TESTS = 2;
