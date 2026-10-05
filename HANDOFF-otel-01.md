# HANDOFF-otel-01 — parlor telemetry

Branch `worker/parlor-otel-01`. This is what `parlor-otel-01` finished and what
it did not, in the order a successor will meet it.

---

## 1. DONE AND VERIFIED

**`src/lib/telemetry.ts`** — the SDK wiring, transcribed from
`kit/templates/otel/node/hono.ts.snippet` and adapted to a TanStack Start app
that is not a Hono app:

| Export | What it is |
|---|---|
| `endpoint()` | `PARLOR_OTEL_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` → `http://otel-collector:4318`. The precedence is written down. |
| `enabled()` / `noOpReason()` | `OTEL_SDK_DISABLED=true` and the three `OTEL_*_EXPORTER=none` switches, all four checked. |
| `install()` | Builds provider + exporter **only when enabled**. Idempotent. |
| `traceRequest(request, run)` | Extract → one `SERVER` span → run → status → `end()`. |
| `recordFailure()` / `errorTypeFor()` | `SpanStatusCode.ERROR` + `error.type` from core's **closed** 14-value vocabulary. |
| `routeTemplate()` | Concrete pathname → route template, with the splat reported as `/v1/{path}`. |
| `tracedFetch()` | Outbound propagation. Takes the span context **as an argument** — see §4. |

**`src/start.ts`** — `createStart(() => ({ requestMiddleware: [telemetryMiddleware] }))`,
which is this framework's documented global-middleware entry
(`@tanstack/start-client-core/skills/start-core/middleware/SKILL.md`,
"Global Middleware"). `install()` runs at module scope.

**`src/lib/telemetry.test.ts`** — 42 tests, all passing. Covers DONE 1-3 plus
the allowlist, the vocabulary, the resource attributes and the route table.

**Env** — `.env.example` (new) carries the kit "service env" convention;
`e2e/docker-compose.yml`'s parlor block carries it commented out.

---

## 2. WHAT THE TESTS FOUND, AND WHY THE SNIPPET COULD NOT BE COPIED

Four of these are **defects in kit's node template**, not in this service. None
was fixed here, because kit is not this repository's to edit.

### 2.1 `defaultTextMapGetter` cannot read a `Headers` — silent total failure

`@opentelemetry/api`'s default getter is:

```js
get(carrier, key) { return carrier[key] }   // PLAIN PROPERTY ACCESS
```

A WHATWG `Headers` stores entries internally and exposes them through `.get()`,
so `carrier["traceparent"]` is `undefined` **for every key**. Therefore
`propagation.extract(ctx, request.headers)` returns the context unchanged: every
inbound `traceparent` is ignored and every request starts a fresh trace.

Nothing throws, nothing logs, every span is still exported with the right
`service.name`, and the trace view shows a healthy pile of unrelated
single-span traces — indistinguishable from a service that receives no
instrumented traffic. **Any test that only asserts "a span was exported" passes
while this is broken.** The test here that caught it asserts
`spanContext().traceId === inboundTraceId`.

Fixed with an explicit `headersGetter` (and `headersSetter` for the outbound
direction). `hono.ts.snippet` line 237 makes exactly this call:
`propagation.extract(context.active(), c.req.raw.headers)`.

**This is the single most important thing in this handoff.** Every node service
that copied that snippet has the same defect.

### 2.2 `pins.md` names a package set that does not install

| pins.md says | Reality |
|---|---|
| `@opentelemetry/api@2.0.0` | **Does not exist.** Versions stop at 1.9.1. |
| `@opentelemetry/sdk-trace-base@2.0.0` | Exists; peer is `api >=1.3.0 <1.10.0`, so an api 2.0.0 could never satisfy it. |
| `@opentelemetry/exporter-trace-otlp-proto@0.57.0` | Exists; depends on `sdk-trace-base@1.30.0`, contradicting the 2.0.0 on the row above. |
| `@opentelemetry/sdk-trace-node@0.57.0` | Does not exist (that package is at 2.x). |

Installed instead, the one coherent set, all `--save-exact`:

```
@opentelemetry/api                       1.9.1
@opentelemetry/core                      2.11.0
@opentelemetry/resources                 2.11.0
@opentelemetry/sdk-trace-base            2.11.0
@opentelemetry/semantic-conventions      1.38.0
@opentelemetry/exporter-trace-otlp-proto 0.222.0
```

`npm ls` shows exactly one version of each — no duplicate API, which is the
failure pins.md's own "`@opentelemetry/api` before `@opentelemetry/sdk-*`" rule
exists to prevent. pins.md's closing rule ("these are placeholders; a service
pins to the version it deploys, and records the choice in its CHANGELOG")
authorises the bump; the CHANGELOG entry is §5 below.

### 2.3 SDK 2.x removed two methods the snippet calls

* `provider.addSpanProcessor(...)` → **removed**. Processors are a constructor
  array: `new BasicTracerProvider({ spanProcessors: [...] })`.
* `provider.register({ propagator })` → **removed**. The globals are set
  explicitly: `trace.setGlobalTracerProvider(p)` and
  `propagation.setGlobalPropagator(p)`.
* The exporter is the **first positional argument** to `BatchSpanProcessor`, not
  an `exporter:` property: `new BatchSpanProcessor(exporter, config?)`.

`hono.ts.snippet` uses all three removed forms.

### 2.4 With no context manager, `context.active()` is `ROOT_CONTEXT`

A consequence of 2.3. Measured:

```js
context.with(trace.setSpan(ctx, span), () =>
  trace.getSpanContext(context.active()))
// → undefined
```

So `context.with()` is a **no-op** and `propagation.inject(context.active(), …)`
injects nothing while looking exactly like it worked.

`tracedFetch` therefore takes the span context as a **parameter**. A missing
context is visible at the call site; the ambient version's failure is invisible.
(`trace.setSpan` does *not* accept a bare `SpanContext` — it is read back with
`.spanContext()` and throws `spanContext is not a function`. Use
`trace.wrapSpanContext()`.)

---

## 3. THE DECISION THAT IS NOT MINE

**UNSET ENDPOINT: no-op, or the shipped collector?**

`parlor.md` says: "UNSET means a true no-op — nothing dials, nothing allocates,
boot identical."

`core/schemas/telemetry/otel-endpoint.schema.json` says the opposite, in four
places: `endpoint.default` is the collector address, `default` is described as
"a DEFAULT VALUE, not a constant, and the reason observability is on by default
without being mandatory", `required` is a `const: false`, and "unsets it for a
genuine no-op" is listed as one option *among* several. kit's snippet implements
the schema: `DEFAULT_ENDPOINT = "http://otel-collector:4318"`.

**This implementation follows the schema and kit**, so with no configuration
configured, spans go to `http://otel-collector:4318`. The genuine no-op is
implemented and tested, on the mechanism the schema pins
(`noOp.implementedBy` is a `const` on `"OTEL_SDK_DISABLED"`): a test asserts
`installed() === false`, no exporter, no queue, no dial.

If the manager rules that the packet's sentence wins, the change is one constant
in `src/lib/telemetry.ts` — `DEFAULT_ENDPOINT` becomes `""` and `enabled()`
gains `if (!endpoint()) return false` — plus the five endpoint tests. Ten
minutes, and it changes the character of the default for the whole fleet.

**Not done, and why:** `config/deploy.yml`. Putting telemetry in the Kamal
config is a **sixth** documented difference from kit's template plus a new
required `KIT_*` variable, which changes the deploy contract rather than the
app. Outward-facing, so it is named here instead of guessed at. The
consequence to be aware of: a production deploy that sets neither variable will
export to a hostname that does not resolve, and the exporter will retry it for
the life of the container.

---

## 4. THE SUCCESSOR'S FIRST MOVE

**Wire `tracedFetch` into `src/lib/upstream.ts`.** It is the only remaining way
this service breaks a trace, and it is the thing that makes a browser → parlor →
identity round trip read as ONE trace in HyperDX instead of three.

Why it was not done here: `src/lib/upstream.ts` is the one file in this
repository whose properties ARE the deployment's security properties (its own
header says a forwarder that gets them wrong is an open proxy). Changing its
`fetch` is not an observability edit.

The shape:

```ts
const span = trace.getActiveSpan();          // …needs a context manager, see below
const response = await tracedFetch(url, span?.spanContext(), { …existing init });
```

Which needs the **context manager** question answered: install
`@opentelemetry/context-async-hooks` (it is `node:async_hooks`), or thread the
span context down explicitly. This app's **default build target is a Cloudflare
Worker** (`vite.config.mts` puts `cloudflare()` first), and `node:async_hooks`
is not available in workerd without a compat flag. **Check `npm run build` and
`npm run build:node` both still pass** before choosing — that is the whole of
the trade.

Then, in order:

1. `config/deploy.yml` — the sixth difference, once §3 is decided.
2. `e2e/docker-compose.yml` — uncomment the telemetry block **and** add a
   collector to the `platform` network, if the tier should assert it.
3. `src/app/readyz/route.ts` — still `deps: "none"`. A real dependency check is
   its own packet (AGENTS.md), and telemetry is not obviously one: a slow
   collector must not mean "not ready".

---

## 5. CHANGELOG entry — DONE

`CHANGELOG.md`'s `## [Unreleased] / ### Added` now records the wiring and the
version choice, which is what pins.md requires of a service that raises a pin.

---

## 6. THE GAPS FOUND IN `core/` AND `kit/`, REPORTED NOT TOUCHED

| Where | Gap |
|---|---|
| `kit/templates/otel/pins.md` | The whole node row is unresolvable (§2.2). |
| `kit/templates/otel/node/hono.ts.snippet` | Silent inbound-propagation failure (§2.1); three removed SDK APIs (§2.3). |
| `core/schemas/telemetry/otel-endpoint.schema.json` | Does not state a service's OTel version, so the two places that must agree — kit's pins and the service's `package.json` — cannot be checked against each other. `tests/test_specs.py`'s byte-identical-copy habit applied to pins would catch §2.2 at kit's own gate. |