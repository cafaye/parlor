import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end tier: a real browser against the whole running stack.
 *
 * NOT part of `bin/prime`. `bin/prime` is a pre-commit hook and a per-commit
 * gate, and a whole stack of containers does not belong in either. The tier
 * lives behind `bin/e2e`, which brings the stack up, runs this, and takes it
 * down; CI runs it in its own job. The rule both tiers share: a skip that
 * nobody is forced to notice is a green run that verified nothing, so there is
 * no way to skip this one — see `globalTeardown` and the report on
 * `e2e-results.json` in bin/e2e.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE BASE URL COMES FROM
 * ---------------------------------------------------------------------------
 * `bin/e2e` exports it, resolved out of e2e/docker-compose.yml, so the port
 * block lives in exactly one file. The defaults below are the compose file's
 * defaults, restated because a bare `npx playwright test` with no environment
 * should still find the stack; `tests/validate-ci.sh` checks the two agree, so
 * they cannot drift without the gate going red.
 */
const port = (name: string, fallback: string): string => process.env[name] ?? fallback;

const edgeBaseUrl = `http://127.0.0.1:${port("E2E_EDGE_PORT", "16000")}`;
const parlorBaseUrl = `http://127.0.0.1:${port("E2E_PARLOR_PORT", "16003")}`;
const guardBaseUrl = `http://127.0.0.1:${port("E2E_GUARD_PORT", "16081")}`;
const identityBaseUrl = `http://127.0.0.1:${port("E2E_IDENTITY_PORT", "16080")}`;

export default defineConfig({
  testDir: "e2e",
  // The names say which tier they are. A glob of `*.test.ts` would put
  // end-to-end specs in the same bucket as the unit suite and `npm test`
  // (vitest) would start collecting files it cannot run.
  testMatch: "**/*.e2e.spec.ts",

  // One worker, and not for speed. Every spec in this tier registers real
  // accounts in one shared Postgres and drives one shared stack; parallel
  // workers would multiply the containers' load and turn a real race in the
  // system into an unreproducible flake in the suite. The unit tier is where
  // parallelism belongs.
  fullyParallel: false,
  workers: 1,

  // NO RETRIES. Not zero-as-a-default-to-be-raised-later: zero as a position.
  // If this tier is flaky, that is a fact about the stack and it gets reported
  // with the mechanism and the numbers (PLAN.md §3, flake policy). A retry
  // count is a way of not finding that out, and every raise of it has cost
  // somebody a real bug.
  retries: 0,

  // Auto-waiting assertions get a real budget, because the first thing a fresh
  // stack does is compile a route and a cold Next.js server answers a
  // navigation slower than a warm one. Ten seconds is generous for a warm run
  // and still far below anything that would be called "waiting".
  expect: { timeout: 10_000 },
  // One navigation budget. Nothing here waits on a timer, so a navigation that
  // has not settled in 30s has failed rather than is slow.
  timeout: 60_000,

  forbidOnly: !!process.env.CI,
  // Fail the run on an unexpected console error? No: Next.js and React log
  // errors this suite legitimately produces (a 401 from identity is a console
  // error in the browser and the test asserts the screen says so). The
  // assertions are the contract; the console is a diagnostic.

  reporter: [
    ["line"],
    // The machine-readable half. `bin/e2e` reads it and fails when the tier ran
    // zero tests or skipped any, so a green exit code with an empty report is
    // not a pass.
    ["json", { outputFile: "e2e-results.json" }],
  ],

  outputDir: "e2e/.artifacts",

  globalTeardown: "./e2e/no-token-artifacts.ts",

  use: {
    // The edge, not the app: a browser loads the app from an origin, and in
    // this stack that origin is the one the edge publishes (e2e/edge.conf
    // states the measured reason). The app's own port is published too and is
    // used for the one assertion that wants the app as a process rather than
    // through a proxy.
    baseURL: edgeBaseUrl,
    // Only Chromium. Three browsers would triple the browser download for a
    // suite whose subject is a service topology, not a rendering engine; the
    // one that is exercised is the one the platform deploys against.
    ...devices["Desktop Chrome"],
    /**
     * NO TRACES. This is the most important line in the file.
     *
     * A Playwright trace is a zip of the full request and response log for
     * every network event in the test. Four of the requests this suite makes
     // carry `Authorization: Bearer <identity's session token>`, so a retained
     * trace is a file on disk holding a live credential, uploaded as a CI
     * artifact by default, and readable by anyone with read access to the
     * build. `retain-on-failure` would be worse, not better: the trace that
     * survives is precisely the one from the failing test.
     *
     * What is left instead: a screenshot on failure (the token is in
     * localStorage and is never rendered, so a screenshot cannot hold it), the
     * line reporter's test names, and the JSON report's status per test. If a
     * failure is not diagnosable from those, the fix is a better assertion or a
     * better message — not a network log.
     *
     * `e2e/assert-no-token.spec-helper.ts` (the global teardown) walks every
     * file this suite produced and fails the run if one of them contains a
     * session token, so turning tracing on here is a red build rather than a
     * silent credential on a disk.
     */
    trace: "off",
    /** No video either: a video of a sign-in is a recording of a credential
     *  being typed, held in a file nobody thought about. */
    video: "off",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium" }],
});

// The two base URLs that are not the app under test, re-exported so a spec does
// not recompute them (and cannot disagree with the config about which port the
// gateway is on).
export { edgeBaseUrl, guardBaseUrl, identityBaseUrl, parlorBaseUrl };
