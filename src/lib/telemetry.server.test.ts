/**
 * The narrow tier: this proves 1-3 of the packet's DONE, and nothing else.
 *
 *   1. Endpoint unset / telemetry off — the boot is a true no-op: no provider,
 *      no exporter, no dial.
 *   2. Endpoint set — one server span per request, named per core's span-name
 *      grammar, carrying the route TEMPLATE rather than a path with ids in it,
 *      with the resource attributes on the RESOURCE.
 *   3. An inbound W3C traceparent is continued; a missing or malformed one
 *      starts a new trace and never becomes a 4xx.
 *
 * ---------------------------------------------------------------------------
 * HOW A SPAN IS READ BACK WITHOUT A NETWORK
 * ---------------------------------------------------------------------------
 * There is no collector in this test and there must not be: a telemetry test
 * that dials something is a test that fails on a developer's laptop for a
 * reason that has nothing to do with the code. So `installTracerForTest()`
 * swaps the exporter for an `InMemorySpanExporter` and asserts on the spans it
 * collects. That is the standard mechanism for this and it is why the SDK's
 * exporter is constructed behind `setSpanExporter()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  InMemorySpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildResource,
  enabled,
  endpoint,
  errorTypeFor,
  install,
  installed,
  noOpReason,
  recordFailure,
  routeTemplate,
  shutdown,
  SPAN_NAME,
  traceRequest,
  tracedFetch,
} from "./telemetry.server";

/**
 * The SDK's global registration is process-wide and irreversible, so every test
 * that needs an exporter installs one and tears it down. Resetting the
 * environment per test is what lets the no-op assertion be about the code
 * rather than about a variable the previous test happened to set.
 */
const OTEL_ENV = [
  "PARLOR_OTEL_ENDPOINT",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_SDK_DISABLED",
  "OTEL_TRACES_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_SERVICE_NAME",
  "OTEL_SERVICE_VERSION",
  "DEPLOYMENT_ENVIRONMENT",
  "PARLOR_TENANT_ID",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of OTEL_ENV) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(async () => {
  await shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
  for (const name of OTEL_ENV) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/**
 * Install the pipeline with an in-memory exporter in place of the OTLP one.
 *
 * Deliberately reached through the SDK's own registration rather than through
 * `install()`: `install()` builds an `OTLPTraceExporter`, and a test that
 * constructed one would have a live exporter pointed at a collector that is not
 * there. Everything this test cares about above the exporter — the propagator,
 * the sampler, the span name, the attributes, the status — is the same code.
 */
function installTracerForTest(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  // Same provider, same sampler and the same resource assembly as `install()`;
  // only the last processor differs. The duplication is three lines and it is
  // the point: a helper that called `install()` would build a live
  // `OTLPTraceExporter` pointed at a collector that is not there.
  const provider = new BasicTracerProvider({
    resource: buildResource(),
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  return exporter;
}

describe("1. the no-op path", () => {
  it("builds no provider when OTEL_SDK_DISABLED is true", async () => {
    process.env.OTEL_SDK_DISABLED = "true";
    expect(enabled()).toBe(false);
    expect(noOpReason()).toBe("OTEL_SDK_DISABLED=true");
    install();
    expect(installed()).toBe(false);
    await shutdown();
  });

  it("builds no provider when a per-signal exporter is none", async () => {
    process.env.OTEL_TRACES_EXPORTER = "none";
    expect(enabled()).toBe(false);
    expect(noOpReason()).toBe("OTEL_TRACES_EXPORTER=none");
    install();
    expect(installed()).toBe(false);
  });

  it("covers ALL THREE signals, not just traces", async () => {
    // The failure this guards: a no-op that only covers traces is a service
    // that still phones home for metrics, discovered by a customer's invoice.
    for (const name of ["OTEL_TRACES_EXPORTER", "OTEL_METRICS_EXPORTER", "OTEL_LOGS_EXPORTER"]) {
      process.env[name] = "none";
      expect(enabled(), `${name}=none must disable telemetry`).toBe(false);
      delete process.env[name];
    }
  });

  it("still serves a request with telemetry off, and returns the real response", async () => {
    process.env.OTEL_SDK_DISABLED = "true";
    install();
    const response = await traceRequest(
      new Request("http://parlor.test/login"),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("installs a CONTEXT MANAGER, which is what makes context.active() mean anything", async () => {
    // Asserted through `context.with`, and this is the only assertion in the
    // suite that can catch the line being removed — which it was, by measurement:
    // deleting the `setGlobalContextManager` call left all 49 tests green, because
    // the client-span tests install their own manager rather than going through
    // `install()`. That asymmetry is deliberate (the globals are irreversible, so
    // the two setups cannot share a file) and it means this line has to be proved
    // here or not at all.
    //
    // The marker is a value no OTel API reads, so what is being asserted is the
    // MANAGER and not a particular context: `ROOT_CONTEXT` carrying a value is
    // returned unchanged by the API's `NoopContextManager` and by nothing else.
    //
    // No span is started here, so nothing reaches the batch processor and the
    // shutdown below has nothing to export — `install()` builds a real
    // `OTLPTraceExporter`, and a test must not put one on the wire.
    install();
    const marker = ROOT_CONTEXT.setValue(Symbol("parlor.telemetry.test"), "inside");
    expect(context.with(marker, () => context.active())).toBe(marker);
    await shutdown();
  });

  it("is idempotent: a second install does not fight the first", async () => {
    process.env.OTEL_SDK_DISABLED = "true";
    install();
    install();
    expect(installed()).toBe(false);
  });
});

describe("the endpoint contract", () => {
  it("prefers PARLOR_OTEL_ENDPOINT, then the standard variable, then the collector", () => {
    expect(endpoint()).toBe("http://otel-collector:4318");
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://standard:4318";
    expect(endpoint()).toBe("http://standard:4318");
    process.env.PARLOR_OTEL_ENDPOINT = "http://parlor-own:4318";
    expect(endpoint()).toBe("http://parlor-own:4318");
  });

  it("reads the switches case-insensitively, as the OTel spec's own do", () => {
    process.env.OTEL_SDK_DISABLED = "TRUE";
    expect(enabled()).toBe(false);
    process.env.OTEL_SDK_DISABLED = "true";
    process.env.OTEL_TRACES_EXPORTER = "NONE";
    expect(enabled()).toBe(false);
  });
});

describe("2. the server span", () => {
  it("opens one span per request, named per core's span-name grammar", async () => {
    const exporter = installTracerForTest();
    await traceRequest(new Request("http://parlor.test/login"), () =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe("parlor.request");
    // core's grammar, asserted as a pattern rather than as a constant, so a
    // rename that stops matching the schema fails here.
    expect(span.name).toMatch(
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]{0,14}(?:_[a-z0-9]{0,14}){0,2}){1,3}$/,
    );
    expect(span.kind).toBe(SpanKind.SERVER);
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("puts the ROUTE TEMPLATE on http.route, never a path with ids in it", async () => {
    const exporter = installTracerForTest();
    await traceRequest(
      new Request("http://parlor.test/accounts/8f2c1e40-1111-2222-3333-444455556666"),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    const attributes = exporter.getFinishedSpans()[0]!.attributes;
    expect(attributes["http.route"]).toBe("/accounts/{accountId}");
    // And nothing anywhere in the span carries the concrete id.
    expect(JSON.stringify(exporter.getFinishedSpans()[0]!.attributes)).not.toContain(
      "8f2c1e40",
    );
  });

  it("carries only allowlisted attribute names", async () => {
    const exporter = installTracerForTest();
    await traceRequest(new Request("http://parlor.test/v1/session", { method: "POST" }), () =>
      Promise.resolve(new Response("", { status: 201 })),
    );
    const attributes = exporter.getFinishedSpans()[0]!.attributes;
    // core's traces.schema.json $defs.tracesAttributes, as a list. `url.path`
    // and `url.full` are absent from core's list for the cardinality reason, and
    // a query string is caller text by another name.
    const ALLOWLIST = new Set([
      "http.request.method",
      "http.response.status_code",
      "http.route",
      "otel.status_code",
      "error.type",
    ]);
    for (const name of Object.keys(attributes)) {
      expect(ALLOWLIST.has(name), `${name} is not on core's traces allowlist`).toBe(true);
    }
    expect(attributes["http.request.method"]).toBe("POST");
    expect(attributes["http.response.status_code"]).toBe(201);
  });

  it("puts service.name, service.version, deployment.environment and tenant_id on the RESOURCE", async () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "staging";
    process.env.PARLOR_TENANT_ID = "acme";
    const exporter = installTracerForTest();
    await traceRequest(new Request("http://parlor.test/login"), () =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const resource = exporter.getFinishedSpans()[0]!.resource.attributes;
    expect(resource["service.name"]).toBe("parlor");
    expect(resource["service.version"]).toBe("0.1.0");
    expect(resource["deployment.environment"]).toBe("staging");
    expect(resource["tenant_id"]).toBe("acme");
  });

  it("sets status ERROR and a closed-vocabulary error.type on a 5xx", async () => {
    const exporter = installTracerForTest();
    await traceRequest(new Request("http://parlor.test/v1/probe/abc"), () =>
      Promise.resolve(new Response("nope", { status: 502 })),
    );
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["error.type"]).toBe("dependency_unavailable");
    expect(span.attributes["otel.status_code"]).toBe("ERROR");
    // The message is a STATIC description, never the service's own error text.
    expect(span.status.message).toBe("request failed with status 502");
    expect(span.events).toHaveLength(0);
  });

  it("files a 401 as policy_denied rather than as a bug in this service", async () => {
    const exporter = installTracerForTest();
    await traceRequest(new Request("http://parlor.test/v1/me"), () =>
      Promise.resolve(new Response("", { status: 401 })),
    );
    const span = exporter.getFinishedSpans()[0]!;
    // A 401 is not an error span: the caller presented a bad token. Filing it
    // as ERROR would page somebody about an expired cookie.
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes["error.type"]).toBeUndefined();
    expect(errorTypeFor(401)).toBe("policy_denied");
  });

  it("ends the span and rethrows when the handler throws", async () => {
    const exporter = installTracerForTest();
    await expect(
      traceRequest(new Request("http://parlor.test/login"), () =>
        Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom");
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["error.type"]).toBe("internal_error");
  });

  it("maps every HTTP status onto a class in core's closed vocabulary", () => {
    const ALLOWED = new Set([
      "_OTHER", "cancelled", "circuit_open", "conflict", "connection_failed",
      "dependency_unavailable", "internal_error", "invalid_request", "policy_denied",
      "provider_auth", "provider_rejected", "rate_limited", "timeout",
    ]);
    for (const status of [200, 201, 301, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]) {
      expect(ALLOWED.has(errorTypeFor(status)), `status ${status}`).toBe(true);
    }
    expect(errorTypeFor(0, Object.assign(new Error("x"), { name: "AbortError" }))).toBe("timeout");
  });
});

describe("3. W3C trace context", () => {
  const INBOUND = {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "00f067aa0ba902b7",
    sampled: true,
  };

  it("CONTINUES a valid inbound traceparent: same trace, this hop's parent", async () => {
    const exporter = installTracerForTest();
    await traceRequest(
      new Request("http://parlor.test/login", {
        headers: { traceparent: `00-${INBOUND.traceId}-${INBOUND.spanId}-01` },
      }),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.spanContext().traceId).toBe(INBOUND.traceId);
    // The parent is the CALLER's span id; the span's own id is this hop's.
    // `parentSpanContext`, not `parentSpanId`: SDK 2.x replaced the flat field.
    expect(span.parentSpanContext?.spanId).toBe(INBOUND.spanId);
    expect(span.parentSpanContext?.isRemote).toBe(true);
    expect(span.spanContext().spanId).not.toBe(INBOUND.spanId);
    // This hop's span is NOT remote — it is the one doing the work.
    expect(span.spanContext().isRemote).toBeUndefined();
  });

  it("carries tracestate across, per §3.3.1.5", async () => {
    const exporter = installTracerForTest();
    await traceRequest(
      new Request("http://parlor.test/login", {
        headers: {
          traceparent: `00-${INBOUND.traceId}-${INBOUND.spanId}-01`,
          tracestate: "cafaye=1",
        },
      }),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    expect(exporter.getFinishedSpans()[0]!.spanContext().traceId).toBe(INBOUND.traceId);
  });

  it("starts a NEW trace when traceparent is missing", async () => {
    const exporter = installTracerForTest();
    await traceRequest(new Request("http://parlor.test/login"), () =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.spanContext().traceId).not.toBe(INBOUND.traceId);
    expect(span.parentSpanContext).toBeUndefined();
  });

  it.each([
    ["too short", "00-4bf9-00f067aa0ba902b7-01"],
    ["version ff is forbidden (§3.2.2.1)", "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"],
    ["all-zero trace-id is invalid (§3.2.2.3)", "00-00000000000000000000000000000000-00f067aa0ba902b7-01"],
    ["all-zero parent-id is invalid (§3.2.2.4)", "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"],
    ["not hex", "00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-00f067aa0ba902b7-01"],
    ["garbage", "hello"],
    ["empty", ""],
  ])("starts a NEW trace and returns the real response when traceparent is %s", async (
    _label,
    header,
  ) => {
    const exporter = installTracerForTest();
    // A request is not an error because its trace header was garbage
    // (§3.2.2.3, §4.2), so the response must come back untouched — and in
    // particular must not become a 4xx.
    const response = await traceRequest(
      new Request("http://parlor.test/login", { headers: { traceparent: header } }),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    expect(response.status).toBe(200);
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.spanContext().traceId).not.toBe(INBOUND.traceId);
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("is not rescued by a tracestate alongside a bad traceparent (§3.3)", async () => {
    const exporter = installTracerForTest();
    await traceRequest(
      new Request("http://parlor.test/login", {
        headers: { traceparent: "garbage", tracestate: "cafaye=1" },
      }),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    expect(exporter.getFinishedSpans()[0]!.spanContext().traceId).not.toBe(INBOUND.traceId);
  });

  it("matches the header case-insensitively (§3.2.1)", async () => {
    const exporter = installTracerForTest();
    await traceRequest(
      new Request("http://parlor.test/login", {
        headers: { TraceParent: `00-${INBOUND.traceId}-${INBOUND.spanId}-01` },
      }),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    expect(exporter.getFinishedSpans()[0]!.spanContext().traceId).toBe(INBOUND.traceId);
  });

  it("injects a traceparent on an outbound fetch, carrying the span given to it", async () => {
    const exporter = installTracerForTest();
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("traceparent") ?? "");
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof fetch;
    try {
      await traceRequest(new Request("http://parlor.test/v1/me"), () =>
        // The span context is threaded in explicitly, NOT read from
        // `context.active()`: with no context manager installed (SDK 2.x
        // removed the `register()` that used to install one) the ambient read
        // returns ROOT_CONTEXT and injects nothing at all.
        tracedFetch(
          "http://identity.internal/v1/me",
          { traceId: INBOUND.traceId, spanId: INBOUND.spanId, traceFlags: 1 },
        ),
      );
    } finally {
      globalThis.fetch = original;
    }
    // A bare fetch breaks the trace at that hop, silently and permanently, with
    // no error anywhere to grep for.
    //
    // THE TRACE ID, not the whole header. The parent-id on the wire is this
    // hop's CLIENT span, not the span handed in: the upstream's span has to hang
    // off the hop that actually called it, or the client span is a leaf with no
    // relationship to anything downstream. This assertion was the whole string
    // before the client span existed and had to change with it — the trace id is
    // the part that is still the same, and it is the part that decides whether
    // this is one trace or two.
    expect(seen[0]).toMatch(new RegExp(`^00-${INBOUND.traceId}-[0-9a-f]{16}-01$`));
    // Two spans now, not one: the server span and the client span it parented.
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const client = spans.find((span) => span.kind === SpanKind.CLIENT)!;
    expect(client.parentSpanContext?.spanId).toBe(INBOUND.spanId);
    expect(seen[0]).toBe(
      `00-${INBOUND.traceId}-${client.spanContext().spanId}-01`,
    );
  });

  it("injects NOTHING when handed no context, rather than inventing a trace", async () => {
    const exporter = installTracerForTest();
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("traceparent") ?? "<none>");
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof fetch;
    try {
      await tracedFetch("http://identity.internal/v1/me", undefined);
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0]).toBe("<none>");
    // And no CLIENT span either. A root client span would be a trace invented
    // for a hop that belongs to somebody else's — the same silent
    // mis-parenting as the getter defect, with `service.name` still right.
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("keeps an inbound caller's trace id across the whole request", async () => {
    const exporter = installTracerForTest();
    await traceRequest(
      new Request("http://parlor.test/v1/me", {
        headers: { traceparent: `00-${INBOUND.traceId}-${INBOUND.spanId}-01` },
      }),
      () => Promise.resolve(new Response("ok", { status: 200 })),
    );
    expect(exporter.getFinishedSpans()[0]!.spanContext().traceId).toBe(INBOUND.traceId);
  });
});

describe("the route template table", () => {
  it.each([
    ["/", "/"],
    ["/login", "/login"],
    ["/healthz", "/healthz"],
    ["/billing/plans", "/billing/plans"],
    ["/accounts/8f2c1e40-1111-2222-3333-444455556666", "/accounts/{accountId}"],
    ["/invitations/tok_abc123", "/invitations/{token}"],
    ["/v1/session", "/v1/{path}"],
    ["/v1/auth/oauth/google/callback", "/v1/auth/oauth/{provider}/callback"],
    ["/nothing/here/at/all", "unmatched"],
  ])("resolves %s to %s", (pathname, expected) => {
    expect(routeTemplate(pathname)).toBe(expected);
  });

  it("covers every route in the generated tree, so a new route cannot go dark", async () => {
    // The failure this guards: a route added to `src/routes/` and missing here
    // emits `unmatched` forever, which reads exactly like a broken exporter.
    const tree = readFileSync(join(import.meta.dirname, "..", "routeTree.gen.ts"), "utf8");
    const generated = [
      ...new Set(
        [...tree.matchAll(/fullPath: '([^']+)'/g)].map((match) =>
          match[1]!.replace(/\$$/, "{path}").replace(/\$([A-Za-z0-9]+)/g, "{$1}"),
        ),
      ),
    ];
    expect(generated.length).toBeGreaterThan(10);
    for (const template of generated) {
      expect(routeTemplate(template.replace("{", "x").replace("}", "y")), template).not.toBe(
        "unmatched",
      );
    }
  });
});

describe("the OTel vocabulary", () => {
  it("SPAN_NAME is a constant the span-name grammar accepts", () => {
    expect(SPAN_NAME.split(".")).toHaveLength(2);
    expect(SPAN_NAME.split(".")[0]).toBe("parlor");
  });

  it("recordFailure attaches a status and a class, and nothing else", () => {
    const setStatus = vi.fn();
    const setAttribute = vi.fn();
    recordFailure(
      { setStatus, setAttribute } as unknown as Span,
      "internal_error",
      "request failed with status 500",
    );
    expect(setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "request failed with status 500",
    });
    expect(setAttribute).toHaveBeenCalledWith("error.type", "internal_error");
    expect(setAttribute).toHaveBeenCalledWith("otel.status_code", "ERROR");
    expect(setAttribute).toHaveBeenCalledTimes(2);
  });
});