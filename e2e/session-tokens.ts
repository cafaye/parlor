/**
 * The one place a session token is written down, and the one place it is
 * destroyed.
 *
 * Why a token is ever written down at all: so that the suite can prove, rather
 * than assert, that nothing it produced contains one. `no-token-artifacts.ts`
 * walks every file the run produced and fails if a recorded token is in any of
 * them. Without a record to compare against, "no artifact contains a token" is
 * a claim about the config rather than a measurement of the output — and the
 * config is exactly the thing that would be wrong, because somebody debugging
 * a failure at midnight turns tracing on and does not remember turning it off.
 *
 * Where the record lives, and why that matters:
 *
 *   * In the OS temp directory, never in the repository and never in the
 *     Playwright output directory. The output directory is what gets uploaded
 *     as a CI artifact, so a record of the tokens would defeat the check it
 *     exists to perform. The scan skips nothing; the record is simply not
 *     somewhere the scan looks.
 *   * Appended one line per token, JSON, so two specs running in either order
 *     cannot clobber each other's record.
 *   * Deleted by the teardown, on every path, including the failing one. A
 *     credential left in a temp file is a credential somebody finds in a
 *     support bundle six months later.
 *
 * The tokens themselves are identity's opaque session tokens, minted and
 * revoked inside a throwaway Postgres in a throwaway container. They are real
 * credentials for the lifetime of the run and worthless after `down -v`, which
 * is the same position every other test credential in the fleet is in.
 */
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Not in the repository, and not in the artifact directory. See above. */
const RECORD = join(tmpdir(), "parlor-e2e-session-tokens.log");

/**
 * Remembers a token so the teardown can look for it.
 *
 * Called by a spec that has just authenticated. The token is never logged, never
 * put in a test name, never put in an expectation message: it goes into this
 * file and nowhere else.
 */
export function recordSessionToken(token: string): void {
  appendFileSync(RECORD, `${JSON.stringify({ token })}\n`, { mode: 0o600 });
}

/** Every token recorded this run, in order. Empty when the run never signed in. */
export function recordedSessionTokens(): string[] {
  if (!existsSync(RECORD)) return [];
  return readFileSync(RECORD, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        const value = JSON.parse(line) as { token?: unknown };
        return typeof value.token === "string" ? value.token : "";
      } catch {
        return "";
      }
    })
    .filter((token) => token !== "");
}

/** Destroys the record. Called by the teardown on every path. */
export function clearRecordedSessionTokens(): void {
  rmSync(RECORD, { force: true });
}
