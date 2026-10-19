import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GET } from "./install-route";

/**
 * `GET /box/install`, and the three properties a `curl | sh` front door has
 * to have.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS ALONGSIDE THE DRIFT GUARD
 * ---------------------------------------------------------------------------
 * `install-drift.test.ts` proves the BYTES are kit's. This file proves the
 * HANDLER serves those bytes — which is a different claim, and the one that
 * can be broken without touching the script: a transform in the response, a
 * content type a browser renders instead of a shell executing, or a cache
 * header that serves a previous substrate would all pass a byte comparison
 * and break the install.
 *
 * THE THREE PROPERTIES:
 *
 *   1. THE BODY IS THE FILE, EXACTLY. No banner, no transform, no wrapper.
 *      `curl | sh` executes what arrives, so "almost the script" is a script
 *      nobody reviewed.
 *   2. THE CONTENT TYPE IS A PROGRAM. `text/x-shellscript`, not `text/html`
 *      and not `text/plain` — a type a browser would render is a type that
 *      changes what the response means.
 *   3. NOTHING CACHES IT. `no-store`, because a stale install script is a box
 *      running the previous substrate and the failure looks like nothing.
 *
 * `process.cwd()` and not `import.meta.url`: under jsdom vitest serves modules
 * over an `http:` URL, for the reason `src/app/readyz/route.test.ts` states.
 */
const REPO = process.cwd();
const SCRIPT = resolve(REPO, "src/app/box/install.sh");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("GET /box/install", () => {
  it("answers 200 with the script's own bytes", async () => {
    const response = GET();
    const body = await response.text();
    const file = readFileSync(SCRIPT, "utf8");

    expect(response.status).toBe(200);
    // The comparison is of the SHA-256 rather than the text, so a failure
    // says which fact moved rather than printing eighty thousand characters
    // of shell at a reader.
    expect(sha256(body)).toBe(sha256(file));
  });

  it("serves a program, not a page", () => {
    const response = GET();

    expect(response.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
  });

  it("is never cached, because a stale install script is a silent one", () => {
    const response = GET();

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is the script it claims to be, by its own shebang", async () => {
    const body = await GET().text();

    // Not a decoration: the shebang is what makes the file executable as a
    // script at all, and it is the first bytes a truncation would take.
    expect(body.startsWith("#!/usr/bin/env bash")).toBe(true);
  });
});
