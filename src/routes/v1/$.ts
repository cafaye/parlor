import { createFileRoute } from "@tanstack/react-router";

import {
  DELETE as forwardDelete,
  GET as forwardGet,
  PATCH as forwardPatch,
  POST as forwardPost,
} from "@/app/v1/[...path]/route";

/**
 * `/v1/$` — the one origin. Every `/v1/*` request the browser makes is answered
 * here and forwarded to whichever service owns the path.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SPELLINGS OF A SPLAT, AND WHY THE ADAPTER IS HERE
 * ---------------------------------------------------------------------------
 * The forwarder takes its segments as `{ params: Promise<{ path?: string[] }> }`
 * — a Promise, because the previous framework's App Router handed `params` out
 * that way, and typing it as anything else was a type error rather than a
 * runtime one. The router hands the same thing over already resolved, and it
 * spells the splat `_splat` as one string rather than as an array of segments.
 *
 * So this file is the seam: `$` becomes `path`, a resolved object becomes the
 * resolved Promise the forwarder awaits, and `GET`/`POST`/`PATCH`/`DELETE` are
 * named one by one with no catch-all — which is the property
 * `src/app/v1/[...path]/route.test.ts` asserts, and it is asserted here too, by
 * this file having no `ANY` handler. A method this route does not name gets a
 * 405 from the framework before the forwarder is reached. `OPTIONS` in
 * particular is never answered, which is what makes this a non-CORS endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ALLOW-LIST IS STILL CODE AND NOT CONFIGURATION
 * ---------------------------------------------------------------------------
 * The header on the forwarder argues this at length, and nothing about the
 * migration changes the argument: a rewrite or a proxy directive could not
 * refuse a path, could not choose between two upstreams under one prefix, and
 * could not bound a body or drop an unlisted header. The table in
 * `src/lib/upstream.ts` is the security property of the whole deployment, and
 * this route is only the door it hangs on.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DECLARES NO COMPONENT
 * ---------------------------------------------------------------------------
 * Same reason as `/healthz`. A route with both a handler and a component serves
 * the handler and then renders into the same response; a forwarder's response
 * body is an upstream's bytes and must cross the wire untouched.
 */
export const Route = createFileRoute("/v1/$")({
  server: {
    handlers: {
      GET: (request, context) => forward(forwardGet, request, context.params),
      POST: (request, context) => forward(forwardPost, request, context.params),
      PATCH: (request, context) => forward(forwardPatch, request, context.params),
      DELETE: (request, context) => forward(forwardDelete, request, context.params),
    },
  },
});

/** What the router resolves for a splat route: one string, or none at all. */
type SplatParams = { _splat?: string };

/** What the forwarder asks for. A Promise, deliberately — see the header. */
type ForwardContext = { params: Promise<{ path?: string[] }> };

type Handler = (request: Request, context: ForwardContext) => Promise<Response>;

function forward(handler: Handler, request: Request, params: SplatParams): Promise<Response> {
  // An absent or empty splat means the request was for `/v1` itself, which is
  // not a route. Passing `{}` rather than `{ path: [] }` reaches the
  // forwarder's own 404 branch, so the rule that it is only ever handed
  // segments a route declared has exactly one implementation.
  const splat = params._splat;
  const path = splat ? splat.split("/") : undefined;

  return handler(request, { params: Promise.resolve(path ? { path } : {}) });
}