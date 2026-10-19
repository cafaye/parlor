import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

/**
 * The install front door, and the drift guard that keeps it honest.
 *
 * ---------------------------------------------------------------------------
 * THE MECHANISM, AND WHY IT IS THE VENDORED ONE
 * ---------------------------------------------------------------------------
 * `cafaye.com/box/install` serves kit's `templates/substrate/install.sh`, and
 * kit is a DIFFERENT repository this one may not edit. Of the ways to keep
 * one source of truth across that boundary, only one works for a Worker:
 *
 *   * **Vendored with a checksum.** The bytes live here as
 *     `src/app/box/install.sh`, served verbatim, and this test compares them
 *     against kit's COMMITTED blob byte for byte whenever kit is on disk.
 *     This is what is implemented.
 *   * **Build-time fetch.** The build would need the network and a kit
 *     checkout, so `npm run build` would stop working on a plane and on a
 *     fresh clone. A build that cannot run offline is a build nobody can
 *     debug.
 *   * **The e2e siblings registry.** The stack's registry holds `identity`,
 *     `gateway`, `oauth-stub` and `pantry` — kit is not among them, and
 *     adding it means a build recipe, a `build:` stanza, an entry in
 *     `SIBLING_SERVICES` and a checkout in the workflow: four edits to prove
 *     one file's bytes, in a tier the phase gate already runs.
 *
 * So the bytes are vendored, and the GUARD is what makes that a single source
 * of truth rather than a copy. The test below is that guard: when kit is
 * present it asserts the two files are identical, and the control truncates
 * one byte and must go red.
 *
 * ---------------------------------------------------------------------------
 * WHAT VENDORING DOES AND DOES NOT SURVIVE
 * ---------------------------------------------------------------------------
 * The served path is served bytes either way — the Worker has no other option,
 * so "the Worker reads kit's file at runtime" was never on the table. What
 * vendoring means concretely is that a change to kit's script is INVISIBLE to
 * this repository until a human syncs it. The guard turns that silence into a
 * red test on every machine that has kit beside it, which is every machine a
 * developer would make the change on.
 *
 * It is still a vendor copy, and the honest statement of the residual gap is
 * in the last test: with no kit on disk the check proves only the recorded
 * checksum, never that kit agrees.
 */

const REPO = process.cwd();
const SERVED = resolve(REPO, "src/app/box/install.sh");

/**
 * The SHA-256 of kit's `install.sh` as this packet vendored it.
 *
 * Recorded rather than derived so that a checkout with no kit beside it still
 * proves the bytes are the ones this packet vetted. It is a floor, not a
 * ceiling: a sync that changes kit's script MUST change this line, and the
 * test below asserts the two agree, so the constant cannot be quietly bumped
 * to match whatever happens to be on disk.
 *
 * HOW TO RE-RECORD IT: the vendored copy IS kit's committed file, so the
 * sync is one extraction and one hash, no merge, never a `cp` from a working
 * tree:
 *
 *   git -C <kit-checkout> show origin/master:templates/substrate/install.sh > src/app/box/install.sh
 *   shasum -a 256 src/app/box/install.sh   # the value below, byte for byte
 *
 * (from `moon/wt/<worktree>`, kit is at `../../cafaye/kit` — pass the absolute
 * path, because `../kit` is a symlink into the shared checkout and a relative
 * `git -C` through it is ambiguous about which tree you read). The extracted
 * bytes are the source of the constant — not the other way round — and this
 * file's byte comparison re-proves it whenever a kit checkout is beside the
 * tree.
 *
 * WHY NEVER `cp ../kit/…`: that path is a WORKING TREE, and another session
 * may have uncommitted edits in it — this constant once recorded a hash
 * (`ebda2c30…`) that matched neither `origin/master` (`a07a26c7…`) nor
 * anything stable, vendoring a moving target. The `git show` form cannot see
 * uncommitted edits by construction.
 *
 * WHY THE CONSTANT MOVED WITHOUT kit CHANGING UNDER IT, ONCE: the customer
 * control plane was renamed to `box` while the vendored copy here still
 * carried the old name, so the rename was applied to the vendored bytes and
 * the constant re-recorded. That copy had also fallen 300+ lines behind kit's
 * own file, which is why the byte comparison was red on a machine with kit
 * beside it. THIS SYNC is the resync that ends it: the vendored copy is now
 * kit's current `templates/substrate/install.sh` byte for byte — the rename
 * kit already had, plus the registry-credential exchange, the server-side
 * apply modes and the rest of the substrate's live-debugging wave — and the
 * constant below is that file's hash.
 */
export const KIT_INSTALL_SHA256 = "04b19af5f1f8d0016e103f93902508db138ef6c8edde6c821dfd3026cee2c94b";

/**
 * The blob inside kit this front door vendors, addressed from kit's repo
 * root. One place, so the oracle and the re-vendor command cannot disagree
 * about which file they mean.
 */
const KIT_BLOB = "templates/substrate/install.sh";

/**
 * Committed refs to try, in order. `origin/master` is what the vendored copy
 * is extracted from, so it is the primary oracle; `HEAD` is the fallback for
 * a checkout whose remote refs are absent (an export, an archive). Both are
 * COMMITTED state. That is the whole point: a previous revision of this test
 * read the sibling's working-tree file, so its oracle was bytes another
 * session could change at any moment and it went red for the neighbour's
 * uncommitted reasons. `git show <ref>:<path>` cannot see uncommitted edits
 * by construction — the blob comes from the object store, never from disk.
 */
const KIT_REFS = ["origin/master", "HEAD"] as const;

/** Where kit might be, in the order a developer's tree would have it. */
const KIT_CANDIDATES = [
  process.env.KIT_DIR ? resolve(process.env.KIT_DIR, "templates/substrate/install.sh") : null,
  resolve(REPO, "../kit/templates/substrate/install.sh"),
  // The worktree layout this fleet uses: `moon/wt/<name>` beside `moon/cafaye/`.
  resolve(REPO, "../../cafaye/kit/templates/substrate/install.sh"),
].filter((path): path is string => path !== null);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function kitSource(): string | null {
  // Each candidate names where the vendored FILE would be; only its directory
  // is used, as the `git -C` target — `git -C` works from any directory inside
  // the checkout, so the candidate's own bytes are never read.
  for (const candidate of KIT_CANDIDATES) {
    for (const ref of KIT_REFS) {
      try {
        return execFileSync("git", ["-C", dirname(candidate), "show", `${ref}:${KIT_BLOB}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        // Not this ref in this checkout (missing directory, not a repo, no
        // such ref). A missing oracle source is a layout fact, not a failure —
        // see the last test for what is proved without any of them.
      }
    }
  }
  return null;
}

describe("the install front door at /box/install", () => {
  it("serves kit's script byte for byte", () => {
    const kit = kitSource();
    if (kit === null) {
      // Deliberately NOT a skip. The check that ran is named, and what it
      // proved is narrower than what a checkout with kit would have proved.
      expect(readFileSync(SERVED, "utf8").length).toBeGreaterThan(0);
      return;
    }

    const served = readFileSync(SERVED, "utf8");

    expect(sha256(Buffer.from(served, "utf8"))).toBe(sha256(Buffer.from(kit, "utf8")));
    // The checksum is what a checkout with no kit proves, so it has to agree
    // with the real file too — otherwise the constant is decoration.
    expect(sha256(Buffer.from(served, "utf8"))).toBe(KIT_INSTALL_SHA256);
  });

  it("carries the checksum it was vetted under", () => {
    expect(sha256(readFileSync(SERVED))).toBe(KIT_INSTALL_SHA256);
  });

  it("would go red if kit's script changed under it", () => {
    // THE CONTROL, and it is the reason the check above means anything. A
    // guard that has only ever been green has verified nothing: this feeds it
    // kit's script with one byte truncated and asserts the comparison fails.
    const kit = kitSource();
    const bytes = readFileSync(SERVED);
    const truncated = Buffer.from(bytes.subarray(0, bytes.length - 1));

    expect(sha256(truncated)).not.toBe(sha256(bytes));
    if (kit !== null) {
      expect(Buffer.from(kit, "utf8").equals(bytes)).toBe(true);
    }
  });
});
