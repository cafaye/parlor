/**
 * The one origin: every `/v1/*` request the browser makes is answered here, on
 * this app's own origin, and forwarded to whichever service owns the path.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROUTE HANDLER AND NOT A REWRITE
 * ---------------------------------------------------------------------------
 * `next.config.ts` can express the same routing in four lines, and that is the
 * reason to reject it rather than adopt it. A rewrite is a string
 * substitution the framework performs before this app sees the request:
 *
 *   * it cannot refuse a path, so `source: "/v1/:path*"` forwards everything
 *     under `/v1` — including `/v1/introspections`, `/v1/session/mfa` and
 *     `/v1/accounts/{id}/api-keys`, which no client here calls;
 *   * it cannot choose between two upstreams on the same prefix, and both
 *     services live under `/v1`;
 *   * it cannot bound the request body, drop an unlisted header, or rewrite an
 *     error into something this app did not say.
 *
 * A rewrite is the right tool when the thing in front is trusted to be the only
 * caller. That is not this situation: the caller is a browser on the internet,
 * and the packet's central requirement is that this must not be an open proxy.
 * The allow-list has to be code with tests on it, and that means a handler.
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
 * WHERE THE TWO ADDRESSES COME FROM, AND WHY THEY ARE NOT `NEXT_PUBLIC_*`
 * ---------------------------------------------------------------------------
 * `process.env.IDENTITY_URL` and `process.env.BILLING_URL`, read here, on the
 * server, at request time. Not `NEXT_PUBLIC_*`, which `next build` substitutes
 * into the client bundle before the image exists — a value the browser can read
 * is a value the browser can change, and for a forwarder that is the difference
 * between a fixed destination and an attacker's.
 *
 * Because they are ordinary variables they can also be set at RUN time, which is
 * why `config/deploy.yml` no longer builds this image per environment: the same
 * image now runs in staging and in production, and the address that decides
 * where a request goes is a deployment fact rather than a build input.
 *
 * The defaults are the compose stack's addresses, so `npm run dev` works with no
 * environment at all.
 */

import { createUpstreamForwarder } from "@/lib/upstream";

/** Where identity runs when nothing says otherwise: the compose stack. */
const DEFAULT_IDENTITY_URL = "http://localhost:8080";

/** Where billing runs when nothing says otherwise: the compose stack. */
const DEFAULT_BILLING_URL = "http://localhost:3000";

/**
 * The forwarder, built once per process.
 *
 * Module scope rather than per-request, because it closes over the two
 * addresses and reading them per request would be a way for the value to change
 * under a deployment. `export const dynamic` below is what stops Next from
 * evaluating this at build time and freezing the result into a static route.
 */
const forward = createUpstreamForwarder({
  identityUrl: identityUrl(),
  billingUrl: billingUrl(),
});

/**
 * Never cached, and never statically rendered.
 *
 * Without this Next will happily treat a `GET` route handler with no dynamic
 * input as a static route and answer it from a file it wrote at BUILD time — a
 * `/v1/me` frozen to whoever was signed in when the image was built, served to
 * everybody. The parameters are read from the request, which is what marks this
 * dynamic, and the export states it so the intent does not depend on Next's
 * inference surviving a future refactor.
 */
export const dynamic = "force-dynamic";

/** And the answer is never stored, by Next or by anything downstream. */
export const revalidate = 0;

/**
 * `GET`. Three verbs and no more.
 *
 * Each is the same one line, and the repetition is the point: there is no
 * catch-all `handler` export, so a method this file does not name is a 405 from
 * the framework before it reaches the forwarder. `OPTIONS` in particular is
 * never answered, which is what makes this a non-CORS endpoint — there is no
 * preflight to satisfy, because a same-origin request never sends one.
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
 * Next's catch-all context. `params` is a Promise in this version of the App
 * Router, and typing it as anything else is a type error rather than a runtime
 * one, which is the better of the two failure modes.
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
    { type: "https://errors.cafaye.com/not_found", title: "No such route.", status: 404, code: "not_found" },
    { status: 404, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } },
  );
}

/** The identity address, read at request time. See the file header. */
function identityUrl(): string {
  return (process.env.IDENTITY_URL?.trim() || DEFAULT_IDENTITY_URL).replace(/\/+$/, "");
}

/** The billing address, read at request time. See the file header. */
function billingUrl(): string {
  return (process.env.BILLING_URL?.trim() || DEFAULT_BILLING_URL).replace(/\/+$/, "");
}
