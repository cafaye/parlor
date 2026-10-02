import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GET } from "./route";

// THE ROLLOUT GATE'S PATH IS CODE, NOT CONFIG, AND THIS IS THE PROOF.
//
// `config/deploy.yml` points kamal-proxy's healthcheck at a path, and kamal
// gates the rollout on it. Whether that path is SERVED is a property of this
// application, so it belongs in a test rather than in a comment next to the
// config — and the test has to be here, beside the route, because that is the
// thing that would have to change.
//
// WHY NOTHING UPSTREAM WILL CATCH IT, and that is measured rather than assumed.
// While writing `bin/deploy-config` the following were all tried against the
// rendered config on kamal 2.12.0, with `healthcheck.path` set to kit's `/up`:
//   - `kamal config` exited 0;
//   - `Kamal::Configuration::Proxy.new` — kamal's own proxy validator —
//     accepted it;
//   - `Kamal::Configuration#to_h` does not carry `proxy` or `env` at all, so
//     `kamal config` is not reading them in the first place.
// A path nothing serves is valid YAML, valid kamal, and still tears back every
// rollout after `deploy_timeout` on a release that is otherwise fine. This file
// is the only thing in the tree that sees the two halves together.
//
// `process.cwd()` and not `import.meta.url`, for the same reason
// `src/styles/tokens.test.ts` reads its file that way and says so there: under
// the jsdom environment vitest serves modules over an `http:` URL, so
// `fileURLToPath(new URL("../../config/deploy.yml", import.meta.url))` throws
// "The URL must be of scheme file". vitest's root is the repository root, which
// is the directory this path is relative to.
const REPO = process.cwd();
const DEPLOY_CONFIG = resolve(REPO, "config/deploy.yml");
const SRC_APP = resolve(REPO, "src/app");

/**
 * Every path this application serves a route handler at, read off the tree.
 *
 * Discovered rather than declared, because a declared list is the same second
 * copy of the router that a manifest listing paths would be, and this file
 * exists precisely to avoid one.
 */
function servedRoutePaths(): string[] {
  return readdirSync(SRC_APP, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        readFileSync(resolve(SRC_APP, entry.name, "route.ts"), "utf8");
        return true;
      } catch {
        return false;
      }
    })
    .map((entry) => `/${entry.name}`)
    .sort();
}

/**
 * The route modules for the paths above, keyed by URL path.
 *
 * Written out by hand rather than globbed, and the reason is the toolchain rather
 * than taste: `import.meta.glob` with a `/src/app/<dir>/route.ts` pattern is the
 * one-line version, and this repository's `tsc --noEmit` rejects it —
 * `tsconfig.json` declares no `vite/client` reference, so the call resolves to a
 * declaration with no type parameters and passing one fails with TS2558. A
 * typecheck that has to keep working on a clean checkout is worth more than a
 * saved line, and the test below is what stops the hand-written list from
 * drifting away from the discovered one.
 */
const ROUTE_MODULES: Record<string, () => Promise<{ GET: () => Response }>> = {
  "/healthz": () => import("../healthz/route"),
  "/readyz": () => import("./route"),
};

/**
 * The path `config/deploy.yml` points the rollout gate at.
 *
 * Full-line comments are stripped first, and that is not tidiness: this
 * configuration discusses `healthcheck.path: /readyz` in prose as well as in the
 * document, and a reader that matched the first `path:` in the text would be
 * reading a comment. The "exactly one" assertion is here so a second `path:`
 * anywhere in the file is a failure with a name rather than a coin toss.
 */
function rolloutGatePath(): string {
  const document = readFileSync(DEPLOY_CONFIG, "utf8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const paths = [...document.matchAll(/^\s*path:\s*(\S+)\s*$/gm)].map((match) => match[1]);

  expect(paths).toHaveLength(1);

  return paths[0];
}

describe("the path config/deploy.yml gates the rollout on", () => {
  it("is /readyz", () => {
    // The value itself, so that a diff back to kit's `/up` is a one-line failure
    // with both spellings in it. The rest of this block is about whether the
    // value is SERVED, which is the half no config check can see.
    expect(rolloutGatePath()).toBe("/readyz");
  });

  it("is a path this application serves a route handler at", () => {
    expect(servedRoutePaths()).toContain(rolloutGatePath());
  });

  it("answers 200, no-store, from that route handler", async () => {
    const load = ROUTE_MODULES[rolloutGatePath()];

    expect(load).toBeTypeOf("function");

    const { GET: routeGet } = await load();
    const response = routeGet();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("covers every route handler the router ships, so a new one cannot slip past", () => {
    // The control for the test above. Without it, adding a third health surface
    // would leave `ROUTE_MODULES` a subset of the routes and the "answers 200"
    // case would quietly stop covering the new one — a check that shrinks its
    // own scope is worse than no check, because it still reports green.
    expect(Object.keys(ROUTE_MODULES).sort()).toEqual(servedRoutePaths());
  });

  it("is not /healthz, which is the restart decision rather than the rollout one", () => {
    // The image's own HEALTHCHECK and `e2e/docker-compose.yml` both use
    // `/healthz`, and that is not an inconsistency to tidy away: the two paths
    // answer different questions. `/healthz` is unconditional while the process
    // serves, which is what a supervisor wants — a container whose upstream is
    // unhappy should be left alone, not bounced — and `/readyz` is the
    // orchestrator's "should this take traffic now?". A rollout gate pointed at
    // `/healthz` would approve every release, which is the failure a gate exists
    // to prevent. The second assertion is the control: `/healthz` IS served, so
    // the first one is a decision rather than an accident of the tree.
    expect(rolloutGatePath()).not.toBe("/healthz");
    expect(servedRoutePaths()).toContain("/healthz");
  });
});

describe("GET /readyz", () => {
  it("returns 200", () => {
    expect(GET().status).toBe(200);
  });

  it("reports ok with no dependencies", async () => {
    const body = await GET().json();

    expect(body).toEqual({ status: "ok", deps: "none" });
  });

  it("reserves the deps key for Phase 2 dependency checks", async () => {
    const body = await GET().json();

    // Shape contract: `deps` is a placeholder string today. Once Phase 2 wires
    // real dependency checks it must become an array without breaking the shape.
    expect(Object.keys(body).sort()).toEqual(["deps", "status"]);
    expect(typeof body.deps).toBe("string");
  });

  it("is not cached by intermediaries", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
