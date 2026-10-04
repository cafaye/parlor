import { createFileRoute } from "@tanstack/react-router";

import { GET as healthz } from "@/app/healthz/route";

/**
 * `/healthz` — the liveness probe.
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVED, AND WHAT DID NOT
 * ---------------------------------------------------------------------------
 * The handler did not move and was not rewritten: it is still the `GET` in
 * `@/app/healthz/route`, still a pure function returning a `Response`, and
 * `src/app/healthz/route.test.ts` still calls it that way. What moved is how
 * the framework reaches it — under the previous framework a `route.ts` beside a
 * `page.tsx` was a convention the framework scanned for; here it is a
 * `server.handlers` entry on a route the router already knows about.
 *
 * That is the difference worth holding on to. Under the old convention the
 * handler and the page were siblings and the coupling was by filename; here
 * they are one object, and a reader can see that `/healthz` answers a GET and
 * renders nothing by looking at one file.
 *
 * ---------------------------------------------------------------------------
 * NO `component`, AND THAT IS LOAD-BEARING
 * ---------------------------------------------------------------------------
 * A route that declares both a `server.handlers.GET` and a `component` serves
 * the handler for the request and then renders the page into the same
 * response. This one declares no component on purpose: it is what a supervisor
 * and the compose healthcheck call, it must never pay for a session read, a
 * query cache or a stylesheet, and a component here would be a way for that to
 * change by accident.
 *
 * The body is unchanged and is asserted by the existing test:
 * `deps` stays a reserved placeholder on `/readyz`, both are `no-store`, and
 * neither checks a dependency — a slow upstream must not get the process
 * restarted.
 */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: healthz,
    },
  },
});