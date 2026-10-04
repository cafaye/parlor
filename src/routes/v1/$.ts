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
 * this file having no `ANY` handler.
 *
 * "No `ANY`" is the whole of the guarantee, and it is worth being precise about
 * what it buys, because the comment here used to say a method this route does
 * not name "gets a 405 from the framework before the forwarder is reached" and
 * that is not what happens. `@tanstack/start-server-core/dist/esm/
 * createStartHandler.js` reads `handlers[METHOD] ?? handlers["ANY"]`; with no
 * `ANY` here, an unnamed method leaves the terminal handler as the SSR
 * renderer, which answers this route's shell. Measured with `curl -X <method>`
 * against a built server: `PUT` and `OPTIONS` return 200 with the rendered app
 * shell, while `POST`/`PATCH`/`DELETE` reach the forwarder and get its own 405
 * with an `allow` header, because `/v1/me` is a GET route.
 *
 * So the property is structural rather than a status code — an unnamed method
 * never reaches the forwarder, so it can never reach an upstream — and the same
 * is true of `OPTIONS`. What makes this a non-CORS endpoint is not that
 * `OPTIONS` goes unanswered but that no response from this app carries an
 * `Access-Control-*` header, which `upstream.test.ts` proves by reading every
 * response header name. A same-origin request sends no preflight at all.
 *
 * The handler receives ONE argument — an object carrying `request` and the
 * already-resolved `params` — not a positional `(request, context)` pair. That
 * is not a detail: taking two positional arguments is a type error, and a type
 * error here is the thing that proves the forwarder's own signature was not
 * quietly widened.
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
      GET: ({ request, params }) => forward(forwardGet, request, params),
      POST: ({ request, params }) => forward(forwardPost, request, params),
      PATCH: ({ request, params }) => forward(forwardPatch, request, params),
      DELETE: ({ request, params }) => forward(forwardDelete, request, params),
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