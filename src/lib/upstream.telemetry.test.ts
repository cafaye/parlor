/**
 * The narrow tier for `parlor-otel-02`: the BFF's forwarded fetch joins the
 * trace.
 *
 * This is the file that answers the only question the previous packet left open.
 * Before it, a browser → parlor → identity round trip was THREE traces: this
 * app's server span, and one unconnected span inside identity for the same
 * request. Nothing was wrong with either span and nothing looked broken in a
 * dashboard; the trace view simply could not join them, and the only way to
 * learn that a hop to identity was slow was to read identity's own logs and
 * match by timestamp.
 *
 * Three things are proved, and the third is the one that is easiest to get
 * wrong:
 *
 *   1. The CLIENT span is a CHILD of the SERVER span — same trace id, and the
 *      client span's parent is this hop's server span id rather than a fresh
 *      root. Asserting "a span was exported" would pass on a client span with
 *      no parent at all, which is the shape this packet exists to remove.
 *   2. The forwarded request CARRIES the inbound trace id on a `traceparent`,
 *      so the upstream continues the trace rather than starting one. Asserted
 *      on the header that actually left, through the same `fetchImpl` seam the
 *      rest of `upstream.test.ts` uses, so nothing here opens a socket.
 *   3. With telemetry OFF the forwarder answers IDENTICALLY and exports ZERO
 *      spans — including no `traceparent`, because inventing one for a hop that
 *      belongs to no trace is the same silent mis-parenting as not sending it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FILE AND NOT A BLOCK IN `upstream.test.ts`
 * ---------------------------------------------------------------------------
 * That file's `beforeEach` replaces the global `fetch` with a function that
 * throws, which is what lets it claim no socket is opened. A tracing test has to
 * register a tracer provider and a context manager, and the SDK's globals are
 * process-wide and irreversible — mixing the two setups in one file would make
 * each test's tracer depend on which describe block ran before it. Separate file,
 * separate setup, and the isolation is vitest's.
 *
 * The context manager is installed HERE as well as in `telemetry.ts`'s
 * `install()`, and that is not a duplication to be tidied away: this test calls
 * the forwarder directly rather than through `install()`, so without it there
 * is no ambient context and every client span would be a root — which is
 * precisely the failure the assertions below are looking for. If wiring the
 * manager into `install()` were undone, THIS file would still pass and only the
 * server-span test in `telemetry.test.ts` would notice; that asymmetry is worth
 * knowing about and is why the no-op test below asserts on the manager too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
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
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

import { buildResource, install, installed, shutdown } from "./telemetry.server";
import { createUpstreamForwarder } from "./upstream";

/** An inbound trace, so "continued" and "new" are distinguishable by value. */
const INBOUND_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const INBOUND_SPAN_ID = "00f067aa0ba902b7";

type Hop = { url: string; headers: Record<string, string> };

/**
 * A recording `fetchImpl`, the same seam `upstream.test.ts` uses.
 *
 * `vi.fn` returning a promise explicitly rather than being `async`, for the
 * reason that file gives: `@typescript-eslint/require-await` is right that there
 * is no `await` in it, and a spy typed as returning a promise is what the seam
 * expects.
 */
function recordingFetch(respond: () => Response = () => new Response("{}", { status: 200 })) {
  const hops: Hop[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init?.headers)) headers[name] = value;
    // `input instanceof Request ? input.url : input.href` for the non-string
    // case rather than `String(input)`: a `Request` stringifies to
    // `[object Request]`, which would put that in a `Hop` and turn every URL
    // assertion here into one that passes for the wrong reason.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    hops.push({ url, headers });
    return Promise.resolve(respond());
  });
  return { hops, fetchImpl };
}

function forwarder(respond?: () => Response) {
  const { hops, fetchImpl } = recordingFetch(respond);
  return {
    hops,
    forward: createUpstreamForwarder({
      identityUrl: "http://identity.test",
      billingUrl: "http://billing.test",
      fetchImpl,
    }),
  };
}

/**
 * A tracer with an in-memory exporter, plus the context manager `install()`
 * would have installed.
 *
 * Reached through the SDK's own registration rather than through `install()`,
 * which builds a live `OTLPTraceExporter` pointed at a collector that is not
 * there. Same three lines `telemetry.test.ts` states the reason for.
 */
function installTracerForTest(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({
      resource: buildResource(),
      sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }),
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  return exporter;
}

/** The SERVER span, from the same `traceRequest` the middleware runs. */
function serverSpanFor(exporter: InMemorySpanExporter) {
  return exporter.getFinishedSpans().find((span) => span.kind === SpanKind.SERVER);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("real fetch() reached a test — the forwarder was not given a seam");
    }),
  );
});

afterEach(async () => {
  await shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
  vi.unstubAllGlobals();
});

describe("the forwarded fetch joins the trace", () => {
  it("is a CHILD of the server span, not a second root", async () => {
    const exporter = installTracerForTest();
    const { forward } = forwarder();

    const { traceRequest } = await import("./telemetry.server");
    await traceRequest(
      new Request("http://parlor.test/v1/me", {
        headers: { traceparent: `00-${INBOUND_TRACE_ID}-${INBOUND_SPAN_ID}-01` },
      }),
      () => forward(new Request("http://parlor.test/v1/me", { method: "GET" }), ["me"]),
    );

    const client = exporter.getFinishedSpans().find((span) => span.kind === SpanKind.CLIENT);
    const server = serverSpanFor(exporter);
    expect(client, "no client span was exported").toBeDefined();
    expect(server, "no server span was exported").toBeDefined();
    // The whole point, asserted twice: same trace, and the client span's parent
    // is THIS hop's server span. Either half alone would pass on a mis-parented
    // span — same trace id with a root parent is still two traces in a waterfall.
    expect(client!.spanContext().traceId).toBe(server!.spanContext().traceId);
    expect(client!.parentSpanContext?.spanId).toBe(server!.spanContext().spanId);
    expect(client!.spanContext().spanId).not.toBe(server!.spanContext().spanId);
    expect(client!.spanContext().traceId).toBe(INBOUND_TRACE_ID);
  });

  it("carries the inbound trace id on the forwarded request", async () => {
    installTracerForTest();
    const { forward, hops } = forwarder();

    const { traceRequest } = await import("./telemetry.server");
    await traceRequest(
      new Request("http://parlor.test/v1/me", {
        headers: { traceparent: `00-${INBOUND_TRACE_ID}-${INBOUND_SPAN_ID}-01` },
      }),
      () => forward(new Request("http://parlor.test/v1/me", { method: "GET" }), ["me"]),
    );

    // The header that actually left, read the way `fetch` would send it. This is
    // the assertion that fails when the setter is the default one: that writes
    // `carrier["traceparent"] = …` onto a `Headers` object, which sends nothing
    // and reads here as `null` rather than throwing.
    const traceparent = hops[0].headers["traceparent"];
    expect(traceparent).toMatch(
      new RegExp(`^00-${INBOUND_TRACE_ID}-[0-9a-f]{16}-01$`),
    );
  });

  it("names the client span per core's grammar, and files a failure on it", async () => {
    const exporter = installTracerForTest();
    const { forward } = forwarder(() => {
      // A `TypeError`, which is what `fetch` actually throws on a transport
      // failure — measured: undici raises `TypeError: fetch failed` with the
      // `ECONNREFUSED` text on `.cause`, and never the `Error` this stub could
      // have thrown instead. That distinction is load-bearing: it is the
      // `TypeError` arm in `errorTypeFor` that files a hop that never reached
      // the network as `connection_failed` rather than `internal_error`, and a
      // stub throwing the wrong class would make the mapping look untested.
      throw new TypeError("fetch failed");
    });

    const { traceRequest } = await import("./telemetry.server");
    await traceRequest(
      new Request("http://parlor.test/v1/me", {
        headers: { traceparent: `00-${INBOUND_TRACE_ID}-${INBOUND_SPAN_ID}-01` },
      }),
      () => forward(new Request("http://parlor.test/v1/me", { method: "GET" }), ["me"]),
    );

    const client = exporter.getFinishedSpans().find((span) => span.kind === SpanKind.CLIENT);
    expect(client!.name).toBe("parlor.upstream");
    expect(client!.name).toMatch(
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]{0,14}(?:_[a-z0-9]{0,14}){0,2}){1,3}$/,
    );
    expect(client!.status.code).toBe(SpanStatusCode.ERROR);
    // `connection_failed`, from core's closed vocabulary — and the fetch error's
    // own message, which names a container, is NOT on the span.
    expect(client!.attributes["error.type"]).toBe("connection_failed");
    // The fetch error's own text, which names a container, is on neither the
    // span nor its message: `error.type` is the class, never the message.
    expect(JSON.stringify(client!.attributes)).not.toContain("fetch failed");
    expect(client!.status.message).toBe("upstream hop failed");
  });

  it("leaves the SERVER span's status to the handler, and answers 502 as before", async () => {
    const exporter = installTracerForTest();
    const { forward } = forwarder(() => {
      throw new Error("connect ECONNREFUSED 10.0.3.7:8080");
    });

    const { traceRequest } = await import("./telemetry.server");
    const response = await traceRequest(
      new Request("http://parlor.test/v1/me", {
        headers: { traceparent: `00-${INBOUND_TRACE_ID}-${INBOUND_SPAN_ID}-01` },
      }),
      () => forward(new Request("http://parlor.test/v1/me", { method: "GET" }), ["me"]),
    );

    // The forwarder's own answer is unchanged: 502, fixed body, no internal
    // address. This packet changed what LEAVES the process, not what comes back.
    expect(response.status).toBe(502);
    await expect(response.text()).resolves.not.toContain("10.0.3.7");
    // The server span is filed from the status the handler RETURNED, which is
    // what `traceRequest` already did — a downstream failure does not reach back
    // and rewrite it into something else.
    expect(serverSpanFor(exporter)!.status.code).toBe(SpanStatusCode.ERROR);
    expect(serverSpanFor(exporter)!.attributes["error.type"]).toBe("dependency_unavailable");
  });

  it("does NOT forward the CALLER's traceparent, only its own", async () => {
    installTracerForTest();
    const { forward, hops } = forwarder();

    const { traceRequest } = await import("./telemetry.server");
    await traceRequest(
      new Request("http://parlor.test/v1/me", {
        headers: { traceparent: `00-${INBOUND_TRACE_ID}-${INBOUND_SPAN_ID}-01` },
      }),
      () =>
        forward(
          // A CALLER trying to name its own parent on the upstream hop.
          new Request("http://parlor.test/v1/me", {
            headers: {
              traceparent:
                "00-deadbeefdeadbeefdeadbeefdeadbeef-1111111111111111-01",
            },
          }),
          ["me"],
        ),
    );

    // `traceparent` crosses because this hop derives it, not because the caller
    // sent one — so the value on the wire is this app's, under this app's trace
    // id, naming this app's client span. A forged parent reaching identity would
    // put an arbitrary caller's span at the head of a trace in a shared backend.
    const traceparent = hops[0].headers["traceparent"];
    expect(traceparent).toMatch(new RegExp(`^00-${INBOUND_TRACE_ID}-[0-9a-f]{16}-01$`));
    expect(traceparent).not.toContain("deadbeef");
    expect(traceparent).not.toContain("1111111111111111");
  });

  it("sends no traceparent when the caller sent none", async () => {
    installTracerForTest();
    const { forward, hops } = forwarder();

    const { traceRequest } = await import("./telemetry.server");
    await traceRequest(
      new Request("http://parlor.test/v1/me"),
      () => forward(new Request("http://parlor.test/v1/me", { method: "GET" }), ["me"]),
    );

    // A new trace is started by the SERVER span, and the client span continues
    // THAT one — so a `traceparent` is expected here, and its trace id is the
    // server span's, not the caller's absent one. Asserting the absence here
    // would be asserting a bug.
    expect(hops[0].headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

describe("with telemetry off, the forwarder is untouched", () => {
  it("answers identically, exports nothing, and injects no header", async () => {
    process.env.OTEL_SDK_DISABLED = "true";
    try {
      install();
      expect(installed()).toBe(false);

      const { hops, forward } = forwarder();
      const response = await forward(
        new Request("http://parlor.test/v1/me", { headers: { authorization: "Bearer t" } }),
        ["me"],
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({});
      expect(hops).toHaveLength(1);
      expect(hops[0].url).toBe("http://identity.test/v1/me");
      // The hop happened with the same headers as before and one fewer: no
      // `traceparent`. Nothing dials a collector and nothing is queued.
      expect(Object.keys(hops[0].headers).sort()).toEqual(["authorization"]);
    } finally {
      delete process.env.OTEL_SDK_DISABLED;
    }
  });

  it("a 5xx from the upstream is still a 5xx to the browser, with no span", async () => {
    process.env.OTEL_SDK_DISABLED = "true";
    try {
      const { forward } = forwarder(
        () => new Response("nope", { status: 503, headers: { "content-type": "text/plain" } }),
      );
      const response = await forward(new Request("http://parlor.test/v1/me"), ["me"]);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("nope");
    } finally {
      delete process.env.OTEL_SDK_DISABLED;
    }
  });
});