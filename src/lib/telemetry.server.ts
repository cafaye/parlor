/**
 * Telemetry: one server span per HTTP request this app serves.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS COMES FROM
 * ---------------------------------------------------------------------------
 * A transcription of `kit/templates/otel/node/hono.ts.snippet`, adapted to this
 * app's shape. The contract it implements is fleet-wide and lives in
 * `core/schemas/telemetry/`:
 *
 *   * `otel-endpoint.schema.json` — `<SERVICE>_OTEL_ENDPOINT` is the only
 *     contract; the shipped collector is the DEFAULT of that variable, not a
 *     constant; and the no-op path must be free (no queue, no retry, no
 *     warnings, no dial on boot).
 *   * `span-naming.schema.json` — `<service>.<operation>[.<target>]`, every
 *     segment at most fifteen characters, which is what makes a value in a name
 *     impossible to spell even by accident. The ROUTE TEMPLATE is an attribute
 *     (`http.route`), never part of the name.
 *   * `traces.schema.json` — a default-deny attribute allowlist. Only
 *     `http.request.method`, `http.response.status_code`, `http.route`,
 *     `otel.status_code` and `error.type` are emitted, and `error.type` is a
 *     CLOSED vocabulary rather than a shape.
 *
 * The three places this differs from the Hono snippet, each because this app is
 * not a Hono app:
 *
 *   1. `install()` is called from `src/start.ts`, the framework's own entry for
 *      global request middleware. It is the mechanism this framework documents
 *      (`@tanstack/start-client-core/skills/start-core/middleware/SKILL.md`,
 *      "Create `src/start.ts` to configure global middleware"), and it is the
 *      closest thing this build has to the `instrumentation.ts` `register()`
 *      entry the packet asked for — see the report: this app is TanStack Start,
 *      not Next.js, so there is no `register()` to call.
 *   2. The route template is resolved by `routeTemplate()` below rather than by
 *      Hono's `c.req.routePath`, for the same reason.
 *   3. `tracedFetch` is called by the forwarder in `src/lib/upstream.ts`, which
 *      had a `fetchImpl` seam for exactly this: the forwarder now opens one
 *      CLIENT span per hop through it and takes the seam as its last argument,
 *      so `upstream.test.ts`'s recorder is still the thing under test and no
 *      socket is opened by the suite.
 */

// SERVER-ONLY, and this line is the whole reason the app works in a browser.
//
// `@tanstack/react-start/server-only` is this framework's own marker, and the
// plugin reads it to keep this module out of the client graph —
// `start-plugin-core/.../import-protection/defaults.js` lists it under
// `serverOnly` markers next to the `**/*.server.*` filename convention.
//
// It is here because of a measured, silent, total failure. `src/start.ts` —
// which declares `createStart()` and so is part of the CLIENT entry — imports
// `install` and `traceRequest` from this file at module scope, and its header
// explains why: the provider has to exist before the first span. So the whole
// OpenTelemetry SDK was compiled into `dist/client/assets/index-*.js`, and the
// browser ran `install()` on load:
//
//   [pageerror] n.AsyncLocalStorage is not a constructor
//
// `AsyncLocalStorageContextManager` is `node:async_hooks` behind a class
// called `new n.AsyncLocalStorage`, and a browser has no such constructor. The
// throw happens while the entry module is still evaluating, so NOTHING
// hydrates: the server-rendered HTML is there, every link works, and no form
// on the site submits, no dialog opens and no button ever becomes busy. Unit
// tests could not see it (jsdom has no `node:async_hooks` either, and the
// module is not in the jsdom graph), and `npm test` was green.
//
// The marker is not a comment on the invariant, it is enforcement: if a future
// edit makes a browser-reachable module import this one, the BUILD fails and
// says so, instead of shipping a bundle that throws on the first paint.
import "@tanstack/react-start/server-only";

import {
  context,
  isSpanContextValid,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type SpanContext,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  AlwaysOnSampler,
  BasicTracerProvider,
} from "@opentelemetry/sdk-trace-base";

/** The emitting service. The mandatory prefix on every span name. */
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "parlor";

/**
 * The collector that ships with the local stack.
 *
 * A DEFAULT VALUE, not a constant, and that is the whole of "observability is
 * on by default" (PLAN.md §7b). A developer with no configuration exports into
 * a collector on their own machine. A self-hoster who already runs another
 * backend sets the variable and this address goes quiet; unsetting the
 * variable — see `enabled()` — is a genuine no-op.
 */
const DEFAULT_ENDPOINT = "http://otel-collector:4318";

/**
 * The OTel spec's OWN kill switch, and the mechanism core's otel-endpoint
 * schema pins the no-op to (`noOp.implementedBy` is a `const` on this exact
 * string). Not a cafaye reimplementation: re-implementing "disabled" in six
 * languages is how six services acquire six different definitions of it.
 */
const SDK_DISABLED = "OTEL_SDK_DISABLED";

/**
 * The finer-grained half. ALL THREE are checked, not just traces: a no-op that
 * only covers traces is a service that still phones home for metrics, which is
 * the failure discovered by a customer's invoice rather than by a test.
 */
const PER_SIGNAL = [
  "OTEL_TRACES_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
] as const;

/**
 * Where OTLP goes, and the whole of the contract (core D16).
 *
 * `PARLOR_OTEL_ENDPOINT` wins — the schema's own variable, `<SERVICE>_OTEL_ENDPOINT`
 * — then the standard `OTEL_EXPORTER_OTLP_ENDPOINT` so this service also works
 * with generic OTel tooling, then the shipped collector. The precedence is
 * written down rather than discovered later: a contract with an undocumented
 * precedence order is a bug report.
 */
export function endpoint(): string {
  return (
    process.env.PARLOR_OTEL_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    DEFAULT_ENDPOINT
  );
}

/** Whether there is anywhere to export to, for any signal. */
export function enabled(): boolean {
  if ((process.env[SDK_DISABLED] ?? "").toLowerCase() === "true") return false;
  return !PER_SIGNAL.some((name) => (process.env[name] ?? "").toLowerCase() === "none");
}

/**
 * One line for the startup log, and only ever on the DISABLED path.
 *
 * Silence is the contract there: a warning per export attempt fills the
 * service's own log store with the fact that telemetry is off, which is how a
 * self-hoster discovers that turning it off is not supported — the opposite of
 * the intent. One line at startup is not spam, and it is the difference between
 * "telemetry is off" and "telemetry is broken", which look identical from
 * outside.
 */
export function noOpReason(): string {
  if ((process.env[SDK_DISABLED] ?? "").toLowerCase() === "true") return `${SDK_DISABLED}=true`;
  const off = PER_SIGNAL.filter((name) => (process.env[name] ?? "").toLowerCase() === "none");
  return off.length > 0 ? `${off.join(",")}=none` : "";
}

let provider: BasicTracerProvider | null = null;

/**
 * Register the propagator and the exporter.
 *
 * THE DISABLED PATH IS FREE, and that is asserted in `telemetry.test.ts` rather
 * than promised: when telemetry is off this function builds no exporter, no
 * batch processor and no queue. Not an exporter pointed at nothing and left to
 * retry. A queue that accepts spans and holds them is a memory leak with a
 * telemetry-shaped trigger; a retry loop against an endpoint that is not there
 * is a timer waking for the life of the process, invisible in every dashboard
 * because nothing is being recorded.
 *
 * Idempotent, because `src/start.ts` can be imported more than once in a dev
 * server's module graph and a second global registration is refused by the API
 * anyway — which would leave the first provider registered and this function
 * believing it had done the work.
 */
export function install(): void {
  if (provider) return;
  if (!enabled()) {
    // One line, on the disabled path only, and never a per-span warning. To
    // stdout, not `console.warn`: this reports a chosen state, and kit's
    // `no-console` allows only warn/error, which would move it to stderr.
    process.stdout.write(`telemetry off (${noOpReason()}); spans stay in-process\n`);
    return;
  }

  provider = new BasicTracerProvider({
    resource: buildResource(),
    // A sampler that respects the CALLER's sampled flag rather than re-deciding
    // per hop: a service that samples independently produces traces with holes,
    // which are worse to debug than no traces at all. ParentBased is the
    // combination that matters — always-on at the root, every downstream hop
    // follows whatever the caller decided.
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    // In the constructor, as an array. SDK 2.x REMOVED `addSpanProcessor()`:
    // `kit/templates/otel/node/hono.ts.snippet` calls it, and that call is a
    // TypeError against every version this service can actually install (see
    // the report — kit's pins.md names a set that does not resolve). BatchSpan,
    // not Simple: one export per span makes the collector the bottleneck and
    // drops spans on a slow network.
    //
    // The exporter is the FIRST POSITIONAL argument on these versions, not an
    // `exporter:` property — a second thing pins.md's "a version in a comment
    // rots" argument is about, and the compiler caught it.
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint()}/v1/traces` }),
      ),
    ],
  });

  // SDK 2.x also removed `provider.register()`; the two globals are set
  // explicitly. The propagator is NAMED rather than left to the default: the
  // default IS W3C today, but a service that depends on a default it never
  // wrote down breaks silently when something changes it.
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  // The CONTEXT MANAGER, and this is the line that makes `context.active()` mean
  // anything. SDK 2.x removed `provider.register()`, which used to install one,
  // so without this `context.active()` is `ROOT_CONTEXT` for the life of the
  // process: `context.with()` is a no-op and a client span started under it is a
  // ROOT span, whose trace id is a fresh one and whose parent is nobody. The
  // symptom is a trace view full of single-span traces across services that were
  // called synchronously from each other — and every hop reporting `service.name`
  // correctly, so nothing looks broken.
  //
  // Installed ONLY on the enabled path. On the disabled path there is no provider,
  // no span and no ambient context to carry, so the no-op boot stays free: this
  // is `node:async_hooks` behind `AsyncLocalStorage`, and a no-op that opens an
  // async-context store on boot is not the no-op the packet asks for.
  //
  // WHY IT IS SAFE HERE, which was the blocking question in
  // HANDOFF-otel-01 §4: this repository's serving runtime is Node —
  // `vite.node.config.mts` / the Dockerfile / `config/deploy.yml` all target it —
  // and `node:async_hooks` is core there. `compatibility_flags:
  // ["nodejs_compat"]` in `wrangler.jsonc` is what keeps that true for the
  // Cloudflare target `npm run build` still emits. Measured, not assumed: see the
  // report.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
}

/** Flush before the process exits, or the last batch is lost. */
export async function shutdown(): Promise<void> {
  await provider?.shutdown();
  provider = null;
}

/** Whether `install()` actually built a pipeline. The no-op assertion reads this. */
export function installed(): boolean {
  return provider !== null;
}

/**
 * Process identity, attached once per process rather than once per span.
 *
 * It is the correct home for `tenant_id` and it is exempt from OpenTelemetry's
 * 2000-attribute-combination cap. Put a tenant on a MEASUREMENT instead and
 * the moment that stream overflows every per-tenant breakdown silently
 * undercounts while the total stays right — the worst shape a bug can have,
 * because the dashboard still renders and nobody reports an error anywhere.
 */
export function buildResource(): ReturnType<typeof resourceFromAttributes> {
  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? "0.1.0",
  };
  const environment = process.env.DEPLOYMENT_ENVIRONMENT;
  if (environment) attributes["deployment.environment"] = environment;
  const tenant = process.env.PARLOR_TENANT_ID;
  if (tenant) attributes["tenant_id"] = tenant;
  return resourceFromAttributes(attributes);
}

/**
 * The fleet's span name: `<service>.<operation>`.
 *
 * NOT `GET /accounts/usr_01J9...`, which is the OTel HTTP convention's form and
 * puts the route in the NAME — and a name is the grouping key in every trace
 * UI, so an attribute in the name cannot be filtered out, and a route with an
 * id in it is a cardinality explosion with a GET attached. core's span-naming
 * schema caps every segment at fifteen characters, which is what makes an
 * interpolated id impossible to spell even by accident.
 *
 * One operation for the HTTP serving path, because every request this app
 * serves IS one thing: it handled a request. The route template travels as an
 * attribute, where it is bounded to one value per endpoint.
 */
export const SPAN_NAME = `${SERVICE_NAME}.request`;

/**
 * The ROUTE TEMPLATE for a pathname, or `unmatched`.
 *
 * `/accounts/usr_01J9Z8QK5M4N7P2R3T6V8W9X0A` must read as `/accounts/{accountId}`.
 *
 * The templates are read out of the GENERATED route tree rather than restated
 * here, because a second copy of the route list is a second thing to forget:
 * a route added to `src/routes/` and not to a hand-written table is a span
 * named `unmatched` forever, which reads as "this endpoint has no telemetry"
 * and is indistinguishable from a broken exporter.
 *
 * `$param` becomes `{param}`, which is the form core's `http.route` pattern
 * (`^/[A-Za-z0-9/_{}.:-]*$`) allows and the form a trace UI groups by. The
 * splat `/v1/$` cannot be grouped by anything finer than itself, so it is
 * reported as `/v1/{path}`: the BFF is a splat route and the concrete upstream
 * path is deliberately not in this app's route tree.
 */
export function routeTemplate(pathname: string): string {
  const path = pathname.split("?")[0] ?? pathname;
  const segments = path.split("/").filter(Boolean);
  for (const template of ROUTE_TEMPLATES) {
    const shape = template.split("/").filter(Boolean);
    if (shape.length !== segments.length) continue;
    const matches = shape.every((part, i) => part.startsWith("{") || part === segments[i]);
    if (matches) return template;
  }
  return "unmatched";
}

/**
 * Every route this app serves, as a template.
 *
 * Transcribed from `src/routeTree.gen.ts`'s `fullPaths` — which the router
 * generates from `src/routes/`, so a new route file appears here when the tree
 * is regenerated. `telemetry.test.ts` reads that same generated list and fails
 * if the two have drifted, because the failure this guards against is a route
 * that silently emits `unmatched`.
 */
const ROUTE_TEMPLATES: readonly string[] = [
  "/",
  "/accounts",
  "/accounts/{accountId}",
  "/admin",
  "/billing/charges",
  "/billing/checkout",
  "/billing/plans",
  "/billing/subscriptions",
  "/forgot-password",
  "/healthz",
  "/invitations/{token}",
  "/login",
  "/privacy",
  "/readyz",
  "/register",
  "/reset-password",
  "/settings",
  "/status",
  "/terms",
  "/v1/{path}",
  "/v1/auth/oauth/{provider}/callback",
  "/verify-email",
  "/verify-email/confirm",
];

/**
 * Mark a span ERRORED and attach the bounded error CLASS.
 *
 * Two decisions, and the second is the point:
 *
 * 1. `SpanStatusCode.ERROR` is what makes the span an error AT ALL. The
 *    predicate for "this is an error" is span status, not `error.type` — the
 *    fleet dashboard partitions by `service.name`, filters on `status = error`,
 *    and uses `error.type` only as a drill-down inside a service. A span whose
 *    status is unset is invisible to that filter however many error attributes
 *    it carries.
 *
 * 2. `error.type` is the CLASS, never the message, and it is one of core's
 *    fourteen. `span.recordException` is deliberately NOT called: the SDK
 *    records `exception.message` and `exception.stacktrace`, a message is
 *    unbounded, and core's redaction schema prohibits those attributes by name
 *    — the collector drops them even if something here adds them.
 *
 * A handled-and-retried error is not recorded at all. A retry that succeeded is
 * not an error, and recording it makes the error rate a lie.
 */
export function recordFailure(span: Span, errorType: ErrorType, description: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: description });
  span.setAttribute("otel.status_code", "ERROR");
  span.setAttribute("error.type", errorType);
}

/**
 * core's closed `error.type` vocabulary, byte-identical to
 * `traces.schema.json`'s enum. Named here so the compiler rejects a typo
 * rather than a span failing to validate at the collector.
 */
export type ErrorType =
  | "_OTHER"
  | "cancelled"
  | "circuit_open"
  | "conflict"
  | "connection_failed"
  | "dependency_unavailable"
  | "internal_error"
  | "invalid_request"
  | "policy_denied"
  | "provider_auth"
  | "provider_rejected"
  | "rate_limited"
  | "timeout";

/**
 * Map a thrown value onto the bounded vocabulary, and a status onto the class
 * that describes it.
 *
 * The status mapping is what keeps a 401 from being filed as `internal_error`:
 * a caller who presented a bad token is not a bug in this service, and a
 * dashboard that counted the two together would page somebody about an
 * expired cookie.
 */
export function errorTypeFor(status: number, thrown?: unknown): ErrorType {
  if (status === 401 || status === 403) return "policy_denied";
  if (status === 404 || status === 400 || status === 422) return "invalid_request";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "dependency_unavailable";
  if (thrown instanceof Error && thrown.name === "AbortError") return "timeout";
  if (thrown instanceof Error && thrown.name === "TypeError") return "connection_failed";
  return "internal_error";
}

/** A STATIC description for a human. Never the error's own message. */
function staticDescription(status: number): string {
  return `request failed with status ${status}`;
}

/**
 * A TextMapGetter for a WHATWG `Headers`, passed to every `extract`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEFAULT GETTER CANNOT BE USED, AND THIS IS A SILENT FAILURE
 * ---------------------------------------------------------------------------
 * `@opentelemetry/api`'s `defaultTextMapGetter.get()` is
 *
 *   get(carrier, key) { return carrier[key] }
 *
 * — PLAIN PROPERTY ACCESS. On a `Headers` object that is always `undefined`,
 * because `Headers` stores its entries in an internal list and exposes them
 * through `.get()`. So `propagation.extract(ctx, request.headers)` returns the
 * context UNCHANGED, every inbound `traceparent` is ignored, and every request
 * starts a brand new trace.
 *
 * Nothing throws. Nothing logs. Every span is still exported, `service.name`
 * is still right, and the trace view shows a healthy pile of unrelated
 * single-span traces — which is indistinguishable from a service that simply
 * receives no traffic from an instrumented caller. The bug was found here by a
 * test asserting `spanContext().traceId` equals the INBOUND trace id, and it
 * would not have been found by anything that only checked "a span was
 * exported".
 *
 * `kit/templates/otel/node/hono.ts.snippet` makes the same call
 * (`propagation.extract(context.active(), c.req.raw.headers)`) and so carries
 * the same defect for Hono. Reported rather than fixed — kit is not this
 * repository's to edit.
 *
 * `keys()` is implemented as well as `get()` because the getter is a two-method
 * interface and a one-method stub is a carrier whose full contents cannot be
 * enumerated.
 */
const headersGetter: TextMapGetter<Headers> = {
  get(carrier, key) {
    return carrier.get(key) ?? undefined;
  },
  keys(carrier) {
    const keys: string[] = [];
    carrier.forEach((_value, key) => keys.push(key));
    return keys;
  },
};

/** The matching setter: a `Headers` we then hand to `fetch`. */
const headersSetter: TextMapSetter<Headers> = {
  set(carrier, key, value) {
    carrier.set(key, value);
  },
};

/**
 * The request middleware: continue the caller's trace, or start a new one.
 *
 * `propagation.extract()` on a malformed header returns the context UNCHANGED
 * and a null remote span — a new trace with no error thrown. That is §3.2.2.3's
 * required response, and it is why there is no try/catch around the extract:
 * there is nothing to catch. A request is not an error because its trace
 * header was garbage, and this must never return 4xx for one.
 *
 * `context.with()` is the idiomatic way to make the span current for everything
 * downstream. IT IS A NO-OP HERE, and the reason is in `tracedFetch`'s header:
 * SDK 2.x removed the `provider.register()` that used to install a context
 * manager, so `context.active()` is `ROOT_CONTEXT` unless one is installed
 * explicitly. The wrapper is kept because it is correct the moment one is — a
 * caller reading it should not have to know which of the two it is — and because
 * removing it would mean `trace.setSpan` disappears with it.
 */
export function traceRequest(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const tracer = trace.getTracer(SERVICE_NAME);
  // headersGetter, never the default: see its comment. Passing a Headers to
  // the default getter is a silent total failure of inbound propagation.
  const extracted = propagation.extract(context.active(), request.headers, headersGetter);
  const span = tracer.startSpan(
    SPAN_NAME,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": request.method,
        "http.route": routeTemplate(new URL(request.url).pathname),
      },
    },
    extracted,
  );

  return context.with(trace.setSpan(extracted, span), async () => {
    let response: Response;
    try {
      response = await run();
    } catch (thrown) {
      recordFailure(span, errorTypeFor(500, thrown), staticDescription(500));
      span.end();
      throw thrown;
    }
    span.setAttribute("http.response.status_code", response.status);
    if (response.status >= 500) {
      recordFailure(span, errorTypeFor(response.status), staticDescription(response.status));
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
    return response;
  });
}

/** The emitting service's outbound hop. `<service>.<operation>`. */
export const CLIENT_SPAN_NAME = `${SERVICE_NAME}.upstream`;

/**
 * An outbound fetch: one CLIENT span, a `traceparent` on the wire, and a
 * failure the trace can see.
 *
 * ---------------------------------------------------------------------------
 * THE PARENT, AND WHY IT IS THE RUNNING REQUEST'S SPAN
 * ---------------------------------------------------------------------------
 * A caller may name the parent explicitly; otherwise it is `context.active()`,
 * which with the context manager installed in `install()` is the SERVER span of
 * the request currently being served. That is what makes a browser → parlor →
 * identity round trip read as ONE trace: the client span's parent is the server
 * span, and the `traceparent` on the wire carries that server span's own id, so
 * identity's server span becomes the next hop rather than a second trace.
 *
 * The explicit parameter is kept for a caller that has a context in hand and no
 * ambient one — a test, or a caller that started its own span. It is a
 * parameter rather than only the ambient read because a caller with NO context
 * is a caller who sees no header, at the call site, rather than discovering it
 * as two unrelated traces in a trace view.
 *
 * ---------------------------------------------------------------------------
 * WHY NO CLIENT SPAN WITHOUT A PARENT
 * ---------------------------------------------------------------------------
 * With no parent anywhere, this makes a plain `fetch` with no header and no
 * span. The alternative — start a ROOT client span — invents a trace for a hop
 * that belongs to somebody else's, which is the same class of silent
 * mis-parenting as the `defaultTextMapGetter` defect in this file's header: it
 * exports something plausible, `service.name` is right, and the trace view fills
 * with unrelated single-span traces. A hop with no parent is a hop inside no
 * trace, and saying so is the honest reading.
 *
 * On the DISABLED path this is what happens anyway: with no provider
 * registered, `tracer.startSpan` returns a non-recording span whose context is
 * invalid, `isSpanContextValid` is false, and nothing is created or injected.
 * The no-op costs one function call and no allocation.
 */
export async function tracedFetch(
  input: string | URL | Request,
  spanContext: SpanContext | undefined,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const parent = spanContext ?? trace.getSpanContext(context.active());
  const headers = new Headers(init.headers);

  if (!parent || !isSpanContextValid(parent)) return fetchImpl(input, { ...init, headers });

  const tracer = trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan(
    CLIENT_SPAN_NAME,
    {
      kind: SpanKind.CLIENT,
      attributes: methodAttribute(init.method),
    },
    // `trace.wrapSpanContext` — not `trace.setSpan`, which stores whatever it is
    // given and is read back with `.spanContext()`, so handing it a bare
    // SpanContext throws `spanContext is not a function`. Wrapping gives a
    // non-recording Span, which is exactly what is wanted here: this context
    // exists to be PARENTED to, not to record anything.
    //
    // AND THE WRAPPING IS INSIDE `setSpan`, because `startSpan`'s third argument
    // is a CONTEXT and not a parent: handing it the non-recording Span directly
    // makes the SDK call `context.getValue(...)` on it, which throws
    // `context.getValue is not a function` — the failure this was measured by.
    trace.setSpan(context.active(), trace.wrapSpanContext(parent)),
  );

  try {
    // The CHILD's context is what goes on the wire, not the parent's: the
    // upstream's server span must hang off this hop, so identity's span is a
    // grandchild of this app's server span and the whole thing is one trace.
    //
    // headersSetter, for the same reason as headersGetter: the default setter
    // writes carrier[key] = value, which puts a `traceparent` PROPERTY on a
    // Headers object that fetch then does not send.
    propagation.inject(
      trace.setSpan(context.active(), span),
      headers,
      headersSetter,
    );
    const response = await fetchImpl(input, { ...init, headers });
    span.setAttribute("http.response.status_code", response.status);
    if (response.status >= 500) {
      recordFailure(span, errorTypeFor(response.status), staticDescription(response.status));
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
    return response;
  } catch (thrown) {
    // A STATIC description, never the thrown error's message: a fetch failure
    // message is `connect ECONNREFUSED 10.0.3.7:8080`, which is the fleet's
    // internal topology, and `error.type` is the closed vocabulary's answer to
    // the same question without the message.
    recordFailure(span, errorTypeFor(0, thrown), "upstream hop failed");
    span.end();
    throw thrown;
  }
}

/**
 * `http.request.method` for an outbound init, or nothing.
 *
 * `fetch` defaults to `GET` when no method is given, and the attribute is
 * enumerated in core's schema — so the default is spelled rather than left
 * absent, because a client span that says nothing about what it sent is a span
 * that cannot answer "which verb was this".
 */
function methodAttribute(method: string | undefined): Record<string, string> {
  const verb = (method ?? "GET").toUpperCase();
  return ALLOWED_METHODS.has(verb) ? { "http.request.method": verb } : {};
}

/** core's `http.request.method` enum, so the attribute cannot carry a typo. */
const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
]);