/**
 * The one origin: every `/v1/*` request the browser makes is answered here, on
 * this app's own origin, and forwarded to whichever service owns the path.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROUTE HANDLER AND NOT A REWRITE
 * ---------------------------------------------------------------------------
 * A rewrite can express the same routing in a handful of lines, and that is the
 * reason to reject it rather than adopt it. A rewrite is a substitution the
 * server performs before this app sees the request. In the previous framework
 * that was `next.config.ts` and a `source:` pattern; in this one the equivalent
 * is `createMiddleware({ type: "request" })` — exported from
 * `@tanstack/react-start`, receiving the `Request` and a `next` function
 * (`RequestServerNextFn` in `@tanstack/start-client-core/dist/esm/createMiddleware.d.ts`).
 * Neither is configuration; both are code, and the argument below is about the
 * limits of the shape rather than about who writes it:
 *
 *   * it cannot refuse a path, so a `/v1/*` pattern forwards everything under
 *     `/v1` — including `/v1/introspections`, `/v1/session/mfa` and
 *     `/v1/accounts/{id}/api-keys`, which no client here calls;
 *   * it cannot choose between two upstreams on the same prefix, and both
 *     services live under `/v1`;
 *   * it cannot bound the request body, drop an unlisted header, or rewrite an
 *     error into something this app did not say.
 *
 * A rewrite is the right tool when the thing in front is trusted to be the only
 * caller. That is not this situation: the caller is a browser on the internet,
 * and the packet's central requirement is that this must not be an open proxy.
 * The allow-list has to be code with tests on it, and a handler is where that
 * code ends up.
 *
 * ---------------------------------------------------------------------------
 * WHY `/v1/*` AND NOT `/api/identity/*`
 * ---------------------------------------------------------------------------
 * Because the browser's URLs then do not change at all. `src/lib/identity.ts`
 * still builds `/v1/session` and `src/lib/billing.ts` still builds `/v1/plans`;
 * only the base changes, from a compiled-in absolute URL to this origin. A
 * second prefix would mean a second base per client and a second convention, and
 * the transcription in both clients — which AGENTS.md is explicit about — would
 * have to be re-read against it.
 *
 * The collision that creates — two services, one prefix — is resolved by the
 * table in `src/lib/upstream.ts`, which names the upstream per route. That is a
 * better arrangement than two mount points, because the table is the single
 * place a reader can see every path this app exposes and where it goes.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE TWO ADDRESSES COME FROM, AND WHY THEY ARE NOT IN THE CLIENT BUNDLE
 * ---------------------------------------------------------------------------
 * `process.env.IDENTITY_URL` and `process.env.BILLING_URL`, read here, on the
 * server, by `identityUrl()` and `billingUrl()` at the bottom of this file.
 * Ordinary run-time variables, with nothing standing between them and the
 * browser except that no bundler in this tree substitutes them.
 *
 * That last clause is a claim about this tree's build, so here is where it
 * comes from. `package.json` `scripts.build` is `vite build`, and the only
 * mechanism by which a Vite build puts an environment variable into client code
 * is `import.meta.env` — Vite exposes exactly the names carrying its `envPrefix`
 * (`VITE_` by default; `vite.config.mts` does not widen it) — plus whatever an
 * explicit `define` in the config names. This repository uses neither:
 * `vite.config.mts` declares no `define` and no `envPrefix`, and
 * `grep -rn "import.meta.env" src/` returns nothing. There is no build-time
 * substitution of a service address into anything, and no `NEXT_PUBLIC_`
 * convention to reach for, because the framework that had one is not run here.
 *
 * The argument the old paragraph made is unchanged and is the reason this is
 * worth a paragraph: a value the browser can read is a value the browser can
 * change, and for a forwarder that is the difference between a fixed
 * destination and an attacker's. Under this build that value is not merely kept
 * out of the bundle — it is read on a machine the browser cannot reach, on
 * every request, which is strictly stronger than being absent from a
 * substitution list.
 *
 * It is also asserted rather than assumed: `route.test.ts` below this directory
 * builds the client and byte-searches `dist/client/assets` for these two names
 * and for the upstreams' hostnames. `tests/validate-ci.sh` refuses a
 * `NEXT_PUBLIC_` name anywhere in `src/` or in the Dockerfile, on the reasoning
 * that a name nobody should reintroduce is worth a standing check.
 *
 * Because they are ordinary variables they can also be set at RUN time, which is
 * why `config/deploy.yml` no longer builds this image per environment: the same
 * image now runs in staging and in production, and the address that decides
 * where a request goes is a deployment fact rather than a build input.
 *
 * The identity default is the compose stack's address, so `npm run dev` works
 * with no environment; billing has no default at all, because the launch stack
 * deploys no billing and a default would be parlor dialing itself. See
 * `identityUrl` and `billingUrl` below for the two halves of that.
 */

import { createUpstreamForwarder } from "@/lib/upstream";

/**
 * Where identity runs when nothing says otherwise: the compose stack.
 *
 * A DEVELOPMENT DEFAULT, NOT A PRODUCTION ONE. The only reader that reaches it
 * is `npm run dev` with no environment. In production a missing `IDENTITY_URL`
 * throws (see `identityUrl` below), because a container that cannot say where
 * identity is cannot serve a sign-in — and silently dialing localhost inside
 * that container would dial parlor itself, which is the failure this packet
 * exists to remove.
 */
const DEFAULT_IDENTITY_URL = "http://localhost:8080";

/**
 * The forwarder, built once per process.
 *
 * Module scope rather than per-request, because it closes over the two
 * addresses and re-reading them per request would be a way for the value to
 * change under a deployment. Note the honest consequence, because the file
 * header says "at request time" and that phrase is doing two jobs: the read is
 * a `process.env` call in a module only the server loads, so the value is never
 * in a browser bundle at all — which is the property every assertion about this
 * rests on — but it is read once, when this module is first imported, rather
 * than on each request. Both are safe; they are not the same claim, and
 * `route.test.ts` checks the bundle, not the timing.
 */
const forward = createUpstreamForwarder({
  identityUrl: identityUrl(),
  billingUrl: billingUrl(),
});

/**
 * Never cached, and never statically rendered.
 *
 * WHY THIS IS TRUE OF THIS TREE, MEASURED RATHER THAN ASSUMED. The two exports
 * below were written for the previous framework and the comment above them used
 * to explain what Next did with them. Nothing here reads them: `grep -rn
 * "force-dynamic" node_modules/@tanstack/` finds no reference, and no
 * `revalidate` either. They are kept because `route.test.ts` asserts they are
 * here, and because a reader who has just been told they are inert deserves to
 * find that written down rather than have to rediscover it.
 *
 * What actually keeps `/v1/me` from being answered out of a build artifact is
 * two things, and neither is this file:
 *
 *   * the build does not prerender unless asked. `@tanstack/start-plugin-core`/
 *     dist/esm/prerender.js gates the whole pass on
 *     `if (startConfig.prerender?.enabled)`, and this repository configures no
 *     Start prerender, so `vite build` writes no HTML for any route.
 *   * the handler is called per request. `@tanstack/start-server-core/dist/esm/
 *     createStartHandler.js` sets the terminal handler for each incoming
 *     `Request`, so a response can only exist once a request has arrived.
 *
 * `route.test.ts`'s own test name for this pair overstates what the two strings
 * prove; that is a finding, not something this comment pretends to settle.
 */
export const dynamic = "force-dynamic";

/** And the answer is never stored, by this tree's build or by anything downstream. */
export const revalidate = 0;

/**
 * `GET`. Three verbs and no more.
 *
 * Each is the same one line, and the repetition is the point: there is no
 * catch-all `handler` export and no `ANY` key, so nothing here answers a method
 * the table in `src/lib/upstream.ts` does not approve.
 *
 * WHAT AN UNNAMED METHOD ACTUALLY GETS, MEASURED RATHER THAN ASSUMED, because
 * the comment this replaces said it was "a 405 from the framework" and it is
 * not. `npm run build`, `PORT=16739 node server/index.mjs`, then one
 * `curl -X <method>` per verb against `/v1/me`:
 *
 *   GET      502  reached the forwarder; identity was not running
 *   POST     405  reached the forwarder; `/v1/me` is a GET route (upstream.ts)
 *   PATCH    405  reached the forwarder, same reason
 *   DELETE   405  reached the forwarder, same reason
 *   PUT      200  the rendered app shell — NOT a 405
 *   OPTIONS  200  the rendered app shell — NOT a 405
 *
 * The mechanism is in the toolchain: `createStartHandler.js` reads
 * `handlers[METHOD] ?? handlers["ANY"]`, and with no `ANY` declared an unnamed
 * method simply leaves the terminal handler as the SSR renderer, which answers
 * the matched route — whose shell is the document `src/routes/__root.tsx`
 * renders, because this route declares no component.
 *
 * So the guarantee this section exists to state is structural, not a status
 * code: an unnamed method never reaches the forwarder, so it can never reach an
 * upstream. What it gets instead is this app's own shell, which is a much less
 * interesting thing to be handed and is not a reason to add an `ANY`.
 *
 * AND WHY THIS IS STILL NOT A CORS ENDPOINT. Not because `OPTIONS` goes
 * unanswered — it is answered, with the shell. Because no response from this
 * app carries an `Access-Control-*` header: `upstream.test.ts` reads every
 * response header name to prove it, and a cross-origin preflight needs one. A
 * same-origin request sends no preflight at all, which is the whole of what
 * makes the BFF work.
 */
export function GET(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

/**
 * The forwarder's own context, kept as the previous framework spelled it: a
 * Promise of the segments.
 *
 * WHAT THE ROUTER ACTUALLY HANDS OVER, MEASURED RATHER THAN ASSUMED. Not a
 * Promise. `createStartHandler.js` builds `params` with
 * `Object.assign(Object.create(null), ctx.params)` and passes it down as a plain
 * object; for a splat route the key is `_splat`, one string, and
 * `src/routes/v1/$.ts` splits it. So `await context.params` above awaits an
 * object, which resolves to itself — harmless, and deliberately not changed
 * here because changing it is a change to a signature rather than to a
 * comment. The typing is load-bearing for the reason the old comment gave and
 * that reason survives: `src/routes/v1/$.ts` wraps the real value in
 * `Promise.resolve` to satisfy it, so the shape of what the forwarder accepts is
 * asserted at the seam rather than assumed by both sides.
 */
type RouteContext = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  // A missing `path` means the request was for `/v1` itself, which is not a
  // route. Answering 404 here rather than forwarding a bare prefix keeps the
  // forwarder's rule intact: it is only ever handed segments a route declared.
  if (!path || path.length === 0) return notFound();

  return forward(request, path);
}

function notFound(): Response {
  return Response.json(
    { type: "https://docs.anywaye.com/errors/not_found", title: "No such route.", status: 404, code: "not_found" },
    { status: 404, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } },
  );
}

/**
 * The identity address. Read on the server, once, when this module loads.
 *
 * REQUIRED IN PRODUCTION, AND A MISSING VALUE FAILS LOUDLY AND BY NAME. The
 * gate is `NODE_ENV` — the environment this app already knows about, set to
 * `production` by the Dockerfile and the compose stack and by a production
 * build — so no new variable is invented and the dev default above stays
 * reachable only for a developer running `npm run dev`. The error names the
 * variable rather than dialing a default, because the failure it prevents is a
 * container that boots, answers every health check, and cannot sign a single
 * person in: three layers from the cause, and invisible in a health surface.
 */
function identityUrl(): string {
  const configured = process.env.IDENTITY_URL?.trim() ?? "";
  if (configured !== "") return configured.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "IDENTITY_URL is not set. parlor cannot serve a sign-in without it: set it to identity's address (config/deploy.yml requires KIT_IDENTITY_URL, and the launch stack deploys identity).",
    );
  }
  return DEFAULT_IDENTITY_URL;
}

/**
 * The billing address. Read on the server, once, when this module loads.
 *
 * THERE IS NO DEFAULT, AND THAT IS THE LAUNCH STACK'S SHAPE RATHER THAN AN
 * OVERSIGHT. The launch deploys no billing, so an empty `BILLING_URL` is a real
 * deployment state; the forwarder answers a billing route with a distinct 503
 * (`BILLING_NOT_CONFIGURED_CODE`) rather than dialing `localhost:3000` — which
 * inside a container is parlor's own port, and a request to it is a request to
 * parlor. The screens branch on that code and say "not configured".
 */
function billingUrl(): string {
  return (process.env.BILLING_URL?.trim() ?? "").replace(/\/+$/, "");
}
