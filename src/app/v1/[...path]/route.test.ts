/**
 * The route handler's own contract, as distinct from the forwarder's.
 *
 * `upstream.test.ts` proves the forwarding is safe. It cannot prove two things
 * this file exists to pin, and both of them are the kind of defect that ships
 * green:
 *
 *   1. **The addresses are read on the server and are not in the client
 *      bundle.** The assertion is on the built client chunks rather than on the
 *      source, because the source is not what the browser downloads. A
 *      `NEXT_PUBLIC_` prefix here would inline the value at build time, the
 *      browser would learn the internal address of identity, and nothing in a
 *      unit test would notice — the forwarder's own tests pass either way,
 *      because they inject both addresses.
 *
 *   2. **The four verbs exist and nothing else does.** A missing `POST` is a
 *      sign-in that 405s; an extra catch-all export is a method this file never
 *      meant to expose.
 *
 * What is NOT asserted here: that a browser can complete a sign-in against a
 * running identity. No test in this repository can, because every test injects a
 * transport and opens no socket. `e2e/` is the tier that measures it, and it
 * measures it against a real identity in a real browser.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROUTE_MODULE = "src/app/v1/[...path]/route.ts";
const STANDALONE_CHUNKS = ".next/static/chunks";

/** Every `NEXT_PUBLIC_` name this repository has ever used for a service. */
const SERVICE_ENV_VARS = ["NEXT_PUBLIC_IDENTITY_URL", "NEXT_PUBLIC_BILLING_URL"];

describe("the route handler exports", () => {
  it("names the three verbs plus GET, and no catch-all", async () => {
    const route = await import("@/app/v1/[...path]/route");

    for (const verb of ["GET", "POST", "PATCH", "DELETE"] as const) {
      expect(typeof route[verb], `${verb} must be exported`).toBe("function");
    }

    // A `handler` or `ALL` export would answer any method, which is the shape
    // that turns an allow-list into a suggestion.
    const source = readFileSync(ROUTE_MODULE, "utf8");
    expect(source).not.toMatch(/export\s+(?:const|function)\s+(?:handler|ALL)\b/);
  });

  it("is not statically renderable, because a frozen /v1/me is a session leak", () => {
    const source = readFileSync(ROUTE_MODULE, "utf8");

    // Next will evaluate a GET route handler with no dynamic input at BUILD time
    // and serve the result from a file. A `/v1/me` written at build time is
    // served to every caller, signed in as whoever was signed in when the image
    // was built.
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("export const revalidate = 0");
  });
});

describe("the service addresses are server-only", () => {
  it("reads them from non-public variables", () => {
    const source = readFileSync(ROUTE_MODULE, "utf8");

    expect(source).toContain("process.env.IDENTITY_URL");
    expect(source).toContain("process.env.BILLING_URL");

    for (const name of SERVICE_ENV_VARS) {
      expect(source, `${name} would be inlined into the client bundle`).not.toContain(name);
    }
  });

  /**
   * The build, and then a byte search of what the browser would download.
   *
   * THE BUILD IS UNCONDITIONAL, and that is a decision rather than a
   * convenience. The first version of this file ran the two bundle assertions
   * only when `.next/static` happened to exist and skipped them otherwise —
   * which reads as an honest "not applicable here" and is in fact the exact
   * shape the gate refuses. `gate.yml`'s `suite` proof carries a negative
   * lookahead, `[ ]+passed(?![ ]*\|)`, so a vitest line reading
   * `Tests  660 passed | 2 skipped (662)` is `gate.proof-missing` rather than a
   * smaller green. The repository's rule is that a skipped test is not a passing
   * test, and a check that only runs on some machines is a check that has
   * verified nothing on the others.
   *
   * So this builds. It costs a `next build` on a run that did not need one,
   * which is the trade, and the alternative — an assertion that silently does
   * not run — is the thing AGENTS.md is written against.
   *
   * It is not as slow as it looks in the common case: `next build` is
   * incremental against an existing `.next`, and a warm run is a few seconds.
   */
  describe("in the built client bundle", () => {
    let chunks: string[] = [];

    beforeAll(() => {
      execFileSync("npm", ["run", "build"], { stdio: "pipe" });
      expect(
        existsSync(STANDALONE_CHUNKS),
        `the build produced no ${STANDALONE_CHUNKS}, so there is nothing to search`,
      ).toBe(true);
      chunks = readdirSync(STANDALONE_CHUNKS)
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFileSync(join(STANDALONE_CHUNKS, name), "utf8"));
      // A build that emitted no client chunk at all would make every assertion
      // below vacuously true, which is the same failure as searching nothing.
      expect(chunks.length, "the build emitted no client chunks").toBeGreaterThan(0);
    }, 600_000);

    afterAll(() => {
      // The build writes into `.next/`, which is gitignored. Left in place it is
      // a stale bundle that a later `next start` would happily serve, and
      // `AGENTS.md` requires `npm run typecheck` to pass WITHOUT a build.
      if (existsSync(".next")) {
        execFileSync("rm", ["-rf", ".next"], { stdio: "pipe" });
      }
    });

    it("carries no service address", () => {
      for (const name of SERVICE_ENV_VARS) {
        for (const chunk of chunks) {
          expect(chunk, `${name} appears in a client chunk`).not.toContain(name);
        }
      }
    });

    it("carries no upstream hostname", () => {
      // The addresses themselves, not just the variable names: a value read from
      // a server-only variable cannot be here, and if one ever is, this is the
      // assertion that says so with the host in it.
      const haystack = chunks.join("\n");
      expect(haystack).not.toContain("localhost:8080");
      expect(haystack).not.toContain("localhost:3000");
    });
  });
});

/**
 * The file with its comments removed, block comments included.
 *
 * Prose is excluded deliberately and the reason is worth stating, because the
 * naive version of this check fails on files that are correct. This repository
 * explains its own history in the headers of the files it changes —
 * `src/lib/identity.ts` says why the inlined variable is gone, in a comment that
 * necessarily spells the name. Stripping a file to its code first keeps that
 * documentation without making the assertion a ban on the word.
 *
 * The block-comment pass is a non-greedy `/* ... *\/` and nothing more, and the
 * limitation is honest: a `*\/` inside a string would end the strip early and a
 * string inside a comment would be stripped with it. Neither appears in the
 * files this walks, and a real parser here would be a dependency added to make a
 * grep more correct — which is the trade this repository's own dependency rule
 * exists to refuse.
 */
function readCode(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("nothing in this app reaches a service cross-origin", () => {
  it("no client module names a service address variable", () => {
    // The whole of the bug, stated as a check over the tree: a browser fetch to
    // an absolute `http://identity…` is what a deployed sign-in was, and the
    // only place that address may appear is a server module.
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(path)) continue;
        if (path === ROUTE_MODULE) continue;
        // This file names the variables it is checking for, by construction.
        if (path === "src/app/v1/[...path]/route.test.ts") continue;
        if (SERVICE_ENV_VARS.some((name) => readCode(path).includes(name))) offenders.push(path);
      }
    };

    walk("src");

    expect(offenders).toEqual([]);
  });
});
