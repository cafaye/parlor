/**
 * The framework's entry for global middleware, and where telemetry installs.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `kit/templates/otel/node/README.md` sends an HTTP service to the upstream
 * OpenTelemetry SDK, and the packet for this work asked for "an instrumentation
 * entry (`register()`) — check the Next version in `package.json` and use the
 * mechanism it documents."
 *
 * There is no Next.js in this repository and no `register()` to call:
 * `grep -rn "from 'next" src/` is empty, `package.json` has no `next`
 * dependency, and `dev`/`build` are `vite dev` / `vite build`. This build is
 * TanStack Start, so the mechanism it documents is a global request middleware
 * declared here — which is also the right shape for the other half of the job,
 * because the middleware is where one server span per request is opened.
 *
 * The framework's own guide is the source rather than a guess:
 * `@tanstack/start-client-core/skills/start-core/middleware/SKILL.md`, under
 * "Global Middleware": "Create `src/start.ts` to configure global middleware".
 *
 * `install()` is called immediately before the first span is opened rather than
 * at module scope, because module scope of THIS file runs in the browser too —
 * see the import below. It is idempotent (`if (provider) return;`), so calling it
 * per request costs a function call after the first, and it is safe on boot with
 * telemetry off: it logs one line and builds nothing.
 */

import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * One server span per HTTP request.
 *
 * This runs for EVERY request the router serves and every server route handler,
 * which is the property the packet asks for: "the HTTP serving path opens one
 * server span per request". It wraps the handler rather than replacing it, so a
 * request that 404s or throws still produces exactly one span, ended, with a
 * status — the failure is the interesting case, and a span that only exists on
 * the happy path hides it.
 *
 * ---------------------------------------------------------------------------
 * WHY `@/lib/telemetry.server` IS A DYNAMIC IMPORT, and this is not a style choice
 * ---------------------------------------------------------------------------
 * This file declares `createStart()`, which means the framework compiles it into
 * the CLIENT entry as well as the server one. A static import of telemetry from
 * here therefore put the whole OpenTelemetry SDK in the browser bundle, and
 * `install()` — which was at this file's module scope — ran in the browser:
 *
 *   [pageerror] n.AsyncLocalStorage is not a constructor
 *
 * `AsyncLocalStorageContextManager` is `node:async_hooks` behind
 * `new AsyncLocalStorage`, and no browser has one. The throw happens while the
 * entry chunk is still evaluating, so NOTHING hydrates: the server-rendered HTML
 * is present and every link works, and no form submits, no dialog opens and no
 * button becomes busy. Every unit test was green and `npm test` passed.
 *
 * `.server()` strips the middleware BODY out of the client build, so the only
 * thing left to keep out was this file's module scope. A dynamic import does that
 * without a build-time exemption and without weakening the marker: the
 * `telemetry.server.ts` filename is what makes `@tanstack/react-start`'s
 * import-protection plugin refuse any browser-reachable STATIC import of it, and
 * that refusal is measured — it is what this fix had to satisfy.
 */
const telemetryMiddleware = createMiddleware({ type: "request" }).server(async ({
  request,
  next,
}) => {
  const { install, traceRequest } = await import("@/lib/telemetry.server");
  install();
  return traceRequest(
    request,
    // `await` on `next()` because its declared result is a union of a promise and
    // a plain value; awaiting a non-promise is free and the union then has one
    // member left.
    async () => (await next()).response,
  );
});

export const startInstance = createStart(() => ({
  requestMiddleware: [telemetryMiddleware],
}));