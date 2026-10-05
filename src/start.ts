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
 * `install()` is called at module scope rather than inside the middleware,
 * because the provider has to exist before the first span is started and
 * module scope is the only place guaranteed to run first. It is safe on boot
 * with telemetry off: it logs one line and builds nothing.
 */

import { createMiddleware, createStart } from "@tanstack/react-start";

import { install, traceRequest } from "@/lib/telemetry";

/** The OpenTelemetry provider, the propagator and the exporter — or nothing. */
install();

/**
 * One server span per HTTP request.
 *
 * This runs for EVERY request the router serves and every server route handler,
 * which is the property the packet asks for: "the HTTP serving path opens one
 * server span per request". It wraps the handler rather than replacing it, so a
 * request that 404s or throws still produces exactly one span, ended, with a
 * status — the failure is the interesting case, and a span that only exists on
 * the happy path hides it.
 */
const telemetryMiddleware = createMiddleware({ type: "request" }).server(
  // `await` on `next()` because its declared result is a union of a promise and
  // a plain value; awaiting a non-promise is free and the union then has one
  // member left.
  async ({ request, next }) =>
    traceRequest(request, async () => (await next()).response),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [telemetryMiddleware],
}));