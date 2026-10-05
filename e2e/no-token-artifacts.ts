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
 *      The zip case is not hypothetical and this function got it wrong the
 *      first time. A trace's network log is a plain NDJSON file *inside* a
 *      deflated zip, so a raw byte search of the `.zip` finds nothing while
 *      `unzip -p trace.zip '*-trace.network' | grep` prints the bearer header
 *      in full. The scan therefore reads archive members, and `unzip` is a
 *      declared prerequisite (bin/e2e checks for it) rather than an optional
 *      nicety: a credential check that cannot open the file it is checking is
 *      not a credential check, and a check that degrades to "nothing found" when
 *      a tool is missing is worse than no check at all.
 *
 *      `tests/validate-ci.sh` is the other half and the earlier one: it reads
 *      playwright.config.ts and fails if `trace` or `video` is anything but
 *      `"off"`, so the mistake is caught before a browser runs rather than
 *      after one has already written the credential to disk.
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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { clearRecordedSessionTokens, recordedSessionTokens } from "./session-tokens";

/** Directories a run can write into, relative to the repository root. */
const SCANNED = ["e2e/.artifacts", "e2e-results.json"];

/**
 * This script's own output, on stdout.
 *
 * NOT `console.log`, and the reason is a policy rather than a workaround: kit's
 * ESLint config allows `console.warn` and `console.error` and nothing else,
 * because a `console.log` left in application code is how a debug statement
 * outlives the debugging. `console.warn` is not available to this script either
 * — it would be a lie. Every line below reports that a check RAN and passed
 * ("scanned 6 produced file(s)… none found"), and a run that passed is not a
 * warning; a log full of warnings is a log nobody reads.
 *
 * `process.stdout.write` is what `bin/e2e` and `bin/e2e-stack` already use for
 * these same `[e2e]` lines — they are `printf` in shell. This is the TypeScript
 * spelling of the same choice, and it is where a report belongs.
 */
function report(line: string): void {
  process.stdout.write(`[e2e] ${line}\n`);
}

/**
 * SYNCHRONOUS, and that is a fact about the work rather than about the type.
 *
 * All three checks below read files and shell out with `execFileSync`, so
 * nothing here has ever been able to suspend — and the `async`/`await` they
 * carried said otherwise to every reader, which is what
 * `@typescript-eslint/require-await` is objecting to. Playwright accepts a
 * teardown that returns `void` or a promise (`globalTeardown?: (config) =>
 * void | Promise<void>`), so the shorter truthful signature is also the one the
 * framework documents.
 */
export default function globalTeardown(): void {
  try {
    const tokens = recordedSessionTokens();
    assertNoTokenInArtifacts(tokens);
    assertTheTierRan();
  } finally {
    clearRecordedSessionTokens();
  }
}

/**
 * Fails when any scanned file contains any recorded token.
 *
 * Archives are read member by member. `readFileSync(path, "utf8")` on a `.zip`
 * produces mojibake, and a needle that is not in the decoded form of the bytes
 * is simply not found — which is a green check on a file that holds the
 * credential. Measured: the first version of this function reported "6 files
 * scanned, none found" on a run that had just written six traces, every one of
 * them containing the bearer header in full inside `*-trace.network`.
 */
function assertNoTokenInArtifacts(tokens: string[]): void {
  if (tokens.length === 0) {
    // Nothing was minted, so there is nothing to look for. Saying so is
    // better than passing silently: it is the shape of a run where the auth
    // specs did not execute, and check 2 is what notices that.
    report("[e2e] no session token was minted this run; nothing to scan for");
    return;
  }

  const needles = tokens.map((token) => Buffer.from(token, "utf8"));
  const offenders: string[] = [];
  let filesScanned = 0;

  for (const scanned of SCANNED) {
    for (const file of walk(scanned)) {
      filesScanned += 1;
      if (holdsAnyNeedle(file, needles)) {
        // The path and the member, never the token: this message goes into a
        // CI log that gets attached to a ticket.
        offenders.push(relative(process.cwd(), file));
      }
    }
  }

  if (offenders.length > 0) {
    // Delete them before throwing. A red run that leaves six traces full of live
    // session tokens in the working tree has fixed the CI badge and left the
    // problem on disk, and the next thing to happen is somebody zipping the
    // directory for a bug report. The best-effort delete of a file this run
    // created is safe precisely because this run created it.
    for (const offender of offenders) {
      try {
        rmSync(offender, { force: true });
      } catch {
        // Reported, not silently ignored: the message already says to delete
        // them, and a permission problem here is not a reason to hide the leak.
      }
    }
    // The path, never the token: this message goes into a CI log that gets
    // attached to a ticket.
    throw new Error(
      "[e2e] FAIL: a session token was present in the run's own output, in: " +
        `${offenders.join(", ")}. Those files have been deleted. Playwright ` +
        "traces and videos are recorded network traffic and are uploaded as " +
        "artifacts; keep `trace` and `video` off in playwright.config.ts.",
    );
  }

  report(
    `scanned ${filesScanned} produced file(s), archive members included, ` +
      `for ${needles.length} session token(s): none found`,
  );
}

/** Whether a file, or any member of it when it is an archive, holds a needle. */
function holdsAnyNeedle(file: string, needles: Buffer[]): boolean {
  const bytes = readFileSync(file);
  if (needles.some((needle) => bytes.includes(needle))) return true;

  if (!isZip(bytes)) return false;

  // `unzip -Z1` lists members, `unzip -p` streams one to stdout. Two processes
  // per archive, and the reason is stated above: this is the only reader of a
  // zip in the tree and pulling in a dependency to do it is worse than two calls
  // to a tool the platform already ships.
  const listed = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" });
  for (const member of listed.split("\n").filter((line) => line !== "")) {
    const content = execFileSync("unzip", ["-p", file, member], {
      // maxBuffer: a screencast frame member is small, but a video is not and
      // the default 1 MB cap would kill the check on exactly the file it exists
      // for.
      maxBuffer: 256 * 1024 * 1024,
    });
    if (needles.some((needle) => content.includes(needle))) return true;
  }
  return false;
}

/** `PK\x03\x04` — the local file header every zip member starts with. */
function isZip(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03;
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
 * by is a skip nobody was forced to notice (gateway's live-Redis tier, identity's
 * `TEST_DATABASE_URL` tests, darkroom's 41). A tier with no skip *mechanism* is
 * better than a tier with a counted one, and this config has none: nothing in
 * `bin/e2e` or the specs has a `test.skip` or a conditional `test.fixme`.
 */
function assertTheTierRan(): void {
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
    report("[e2e] no report yet; tests/assert-e2e-ran.mjs is the authority on it");
    return;
  }

  let parsed: { stats?: { expected?: number; skipped?: number } };
  try {
    // `JSON.parse` is typed `any`, and handing an `any` straight to a typed
    // variable is what `@typescript-eslint/no-unsafe-assignment` is about: the
    // shape above is a claim about the report, and an assertion at the parse is
    // where the claim is made rather than at each use. Nothing here trusts a
    // field it did not ask for — `stats.expected` and `stats.skipped` are read
    // through `??` defaults, so a report missing either one fails the floor
    // rather than rendering `undefined` into a message.
    parsed = JSON.parse(raw) as { stats?: { expected?: number; skipped?: number } };
  } catch {
    throw new Error(
      "[e2e] FAIL: e2e-results.json is not valid JSON. A report that cannot be " +
        "read cannot be shown to describe anything; check the `reporter` block " +
        "in playwright.config.ts.",
    );
  }

  const stats = parsed.stats ?? {};
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
 * through parlor and identity, and the whole-stack view through gateway. One test
 * that is filtered out should fail the run rather than quietly halve it.
 */
const MINIMUM_TESTS = 2;
