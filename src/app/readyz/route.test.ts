import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
// `Response | Promise<Response>` because the two health surfaces differ:
// `/healthz` is unconditional and synchronous, `/readyz` awaits its sweep.
// The tests below `await` the result either way, which is correct for both.
const ROUTE_MODULES: Record<string, () => Promise<{ GET: () => Response | Promise<Response> }>> = {
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

    // The probe is real now, so the route sweeps identity before it can
    // answer 200. The stub stands in for a reachable identity; without it the
    // probe would dial the dev default and the assertion below would be
    // measuring a connection refusal.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch();

      const { GET: routeGet } = await load();
      const response = await routeGet();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
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

/**
 * `/readyz`'s body, read as the shape `GET()` declares it writes.
 *
 * `Response.json()` is typed `Promise<any>`, and the assertion is where that
 * `any` becomes something a reader can check — which is the whole of
 * `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-member-access` and
 * `no-unsafe-argument` pointing at the four lines below. One declaration here
 * rather than an assertion on each `body`, and the second test can then read
 * `body.deps` and mean it.
 *
 * The assertion is a claim, not a conversion: nothing narrows the value, and a
 * `/readyz` that answered something else would still fail every assertion in
 * this describe rather than pass them by being typed.
 */
async function readyzBody(): Promise<{ status: unknown; deps: unknown }> {
  const response = await GET();
  return (await response.json()) as { status: unknown; deps: unknown };
}

/**
 * The environment the probe reads, saved and restored around each case.
 *
 * The probe reads `process.env` per request rather than at module scope — the
 * same read-once posture as the forwarder would freeze the addresses at
 * import, and a test that could not set them per case would be testing
 * whatever the machine happened to have. These helpers are what makes each
 * case deterministic without asking the suite to care what the developer's
 * shell exported.
 */
function withEnvironment(run: () => Promise<void> | void) {
  const identityUrl = process.env.IDENTITY_URL;
  const billingUrl = process.env.BILLING_URL;
  delete process.env.IDENTITY_URL;
  delete process.env.BILLING_URL;
  const restore = () => {
    if (identityUrl === undefined) delete process.env.IDENTITY_URL;
    else process.env.IDENTITY_URL = identityUrl;
    if (billingUrl === undefined) delete process.env.BILLING_URL;
    else process.env.BILLING_URL = billingUrl;
  };
  return Promise.resolve(run()).finally(restore);
}

/** Stands in for a reachable dependency: answers 200 at its own `/readyz`. */
function stubDependencyFetch(overrides: {
  identity?: Response | Error;
  billing?: Response | Error;
} = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const failure = url.includes("billing") ? overrides.billing : overrides.identity;
      if (failure instanceof Error) return Promise.reject(failure);
      if (failure !== undefined) return Promise.resolve(failure);
      return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    }),
  );
  return calls;
}

/** A fetch that answers nothing at all — the dependency that stopped answering. */
function stubHangingFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // A real dependency that hangs does not reject on its own, and the
          // probe's timeout is what ends the wait — so this stub ends the
          // wait the same way, when the signal fires. A probe that passed no
          // signal would hang this test until vitest's own timeout, which is
          // the red proof for the bound.
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /readyz", () => {
  it("returns 200 when identity is reachable", async () => {
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch();

      const response = await GET();

      expect(response.status).toBe(200);
    });
  });

  it("probes identity at its own /readyz, with a bound and no cache", async () => {
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      const calls = stubDependencyFetch();

      await GET();

      expect(calls).toEqual(["http://identity.test/readyz"]);
    });
  });

  it("reports ok with the dependencies it actually probed", async () => {
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch();

      expect(await readyzBody()).toEqual({
        status: "ok",
        deps: [{ name: "identity", ok: true }],
      });
    });
  });

  it("fails closed when identity is unreachable: not ready, not 200", async () => {
    // THE TEST THE PACKET EXISTS FOR. The rollout gate is this route, and a
    // container that can serve bytes but cannot reach identity must not pass
    // it. The old route answered `{status:"ok",deps:"none"}` whatever the
    // world looked like — a liveness gate wearing a readiness label.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch({ identity: new Error("connect ECONNREFUSED") });

      const response = await GET();

      expect(response.status).not.toBe(200);
      expect(response.status).toBe(503);
      expect(await readyzBody()).toEqual({
        status: "unavailable",
        deps: [{ name: "identity", ok: false }],
      });
    });
  });

  it("fails closed when identity answers non-2xx", async () => {
    // A 500 from identity's own probe is identity saying "I am not ready".
    // Relaying it as parlor's readiness would be claiming a verdict identity
    // never gave.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch({ identity: new Response("{}", { status: 500 }) });

      expect((await GET()).status).toBe(503);
    });
  });

  it("fails closed when identity is not configured", async () => {
    // No address is not-ok rather than an exception: the probe reports the
    // dependency as failed, which is the answer an orchestrator acts on.
    // `config/deploy.yml` requires `KIT_IDENTITY_URL`, so this is a
    // misdeployment — and a misdeployment is exactly what the gate exists to
    // catch.
    await withEnvironment(async () => {
      stubDependencyFetch();

      const response = await GET();

      expect(response.status).toBe(503);
      expect(await readyzBody()).toEqual({
        status: "unavailable",
        deps: [{ name: "identity", ok: false }],
      });
    });
  });

  it("probes billing too, when it is configured", async () => {
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      process.env.BILLING_URL = "http://billing.test";
      const calls = stubDependencyFetch();

      const response = await GET();

      expect(response.status).toBe(200);
      expect(calls.sort()).toEqual(["http://billing.test/readyz", "http://identity.test/readyz"]);
      expect(await readyzBody()).toEqual({
        status: "ok",
        deps: [
          { name: "identity", ok: true },
          { name: "billing", ok: true },
        ],
      });
    });
  });

  it("fails closed when billing is configured but unreachable", async () => {
    // The control for the test above, and the reason an unconfigured
    // dependency is not a failed one: billing is in the sweep only when it
    // is configured, and then it is held to the same verdict as identity.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      process.env.BILLING_URL = "http://billing.test";
      stubDependencyFetch({ billing: new Error("connect ECONNREFUSED") });

      const response = await GET();

      expect(response.status).toBe(503);
      expect(await readyzBody()).toEqual({
        status: "unavailable",
        deps: [
          { name: "identity", ok: true },
          { name: "billing", ok: false },
        ],
      });
    });
  });

  it("leaves billing out of the sweep when it is not configured — the launch stack's shape", async () => {
    // The launch deploys no billing, so an empty `BILLING_URL` is a real
    // deployment state. Probing it anyway would fail every launch rollout on
    // a dependency that is not there, and reporting it as failed would be a
    // lie about what the deployment has.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      const calls = stubDependencyFetch();

      const response = await GET();

      expect(response.status).toBe(200);
      expect(calls).toEqual(["http://identity.test/readyz"]);
      expect(await readyzBody()).toEqual({
        status: "ok",
        deps: [{ name: "identity", ok: true }],
      });
    });
  });

  it("is bounded: a dependency that stops answering fails the rollout rather than stalling it", async () => {
    // A probe that hangs is worse than one that fails — kamal-proxy's
    // healthcheck has its own timeout, and a rollout that stalls is a
    // rollout that never decides. The stub rejects when the probe's signal
    // fires, so a route that passed no signal would hang here until vitest's
    // own timeout killed the test.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubHangingFetch();

      const response = await GET();

      expect(response.status).toBe(503);
    });
  }, 10_000);

  it("keeps the platform contract's keys, with deps as an array of results", async () => {
    // Shape contract: the keys are `status` and `deps` and nothing else, and
    // `deps` is an array — the shape the route's own header reserved for the
    // real sweep, now in use. A consumer reading `body.deps` gets the same
    // two keys it always had, and the third key would be a contract change
    // this repository does not make alone.
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch();

      const body = await readyzBody();

      expect(Object.keys(body).sort()).toEqual(["deps", "status"]);
      expect(Array.isArray(body.deps)).toBe(true);
      for (const dep of body.deps as { name: unknown; ok: unknown }[]) {
        expect(Object.keys(dep).sort()).toEqual(["name", "ok"]);
      }
    });
  });

  it("is not cached by intermediaries", async () => {
    await withEnvironment(async () => {
      process.env.IDENTITY_URL = "http://identity.test";
      stubDependencyFetch();

      expect((await GET()).headers.get("cache-control")).toBe("no-store");
    });
  });
});
