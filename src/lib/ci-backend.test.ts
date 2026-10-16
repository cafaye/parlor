/**
 * `ci/backend` and `ci/pipeline.sh`, read against the backend contract.
 *
 * WHY THIS FILE IS UNDER `src/lib/` AND NOT BESIDE `ci/`: vitest's `include`
 * glob only matches test files under `src/` (vitest.config.mts — "if you add a
 * test outside `src/`, it will not run, and `bin/prime` will not notice"). The
 * backend declaration is part of how this repository is gated, and a test that
 * does not run is not a test, so it lives here and reaches `ci/` by path.
 *
 * WHAT IT ASSERTS, and why each assertion is load-bearing:
 *
 *   * `ci/backend` names a backend kit ships. `kit/backends/README.md` is the
 *     contract: the one line in `ci/backend` selects the runner that calls
 *     `ci/pipeline.sh`, and a name kit does not ship is a declaration nothing
 *     will read — the file looks configured while no backend matches it. The
 *     README's own instruction is "change the one line in `ci/backend`", so the
 *     failure this guards is a typo or a backend removed from kit, both of
 *     which leave a green-looking tree that no runner picks up.
 *
 *   * `ci/pipeline.sh` exists and is executable. The contract's first clause is
 *     that the pipeline "be executable (`chmod +x`)". A `pipeline.sh` that lost
 *     its executable bit is a backend that fails with permission denied on the
 *     first poll rather than a claim anything caught.
 *
 * `KNOWN_BACKENDS` is a TRANSCRIPTION of kit's contract — the table in
 * `kit/backends/README.md` and the directories under `kit/backends/` — not a
 * copy of anything in this repository, in the same spirit as `src/lib/roles.ts`
 * transcribes identity's capability matrix. It is a reason to FAIL a name kit
 * does not ship; when kit adds a backend, the entry lands here in the same
 * commit that adopts it here.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// `process.cwd()` and not `import.meta.url`: under the jsdom environment vitest
// serves modules over an `http:` URL, so `fileURLToPath` throws "The URL must be
// of scheme file" on the idiomatic spelling. vitest's root is the repository
// root, which is where `ci/` lives. Same reasoning as `src/styles/tokens.test.ts`.
const ROOT = process.cwd();

/** The backends `kit/backends/README.md` declares and kit ships. */
const KNOWN_BACKENDS = ["github-actions", "instabox"] as const;

describe("ci/backend", () => {
  it("names a backend kit ships", () => {
    const declared = readFileSync(resolve(ROOT, "ci/backend"), "utf8").trim();
    expect(
      KNOWN_BACKENDS,
      `ci/backend names ${JSON.stringify(declared)}, which kit does not ship. ` +
        "kit/backends/README.md's table is the contract; a name outside it is a " +
        "declaration no backend reads.",
    ).toContain(declared);
  });

  it("names exactly one backend and nothing else", () => {
    // The README says "change the one line in `ci/backend`", so the file is one
    // token and a newline. A second whitespace-separated token would still
    // `.trim()` to something the membership check above could reject for the
    // wrong reason; this pins the shape the backends read.
    const raw = readFileSync(resolve(ROOT, "ci/backend"), "utf8");
    expect(raw).toBe(`${raw.trim()}\n`);
    expect(raw.trim()).not.toMatch(/\s/);
  });
});

describe("ci/pipeline.sh", () => {
  it("exists and is executable", () => {
    const pipeline = resolve(ROOT, "ci/pipeline.sh");
    const mode = statSync(pipeline).mode;
    expect(mode & 0o111, "ci/pipeline.sh has no executable bit; the contract's " +
      "first clause is that it be executable (chmod +x).").not.toBe(0);
  });
});
