# Changelog

All notable changes to parlor are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **An OpenAPI document for the `/v1/*` routing surface, and the manifest
  entry that names it** (`worker/parlor-w86-http-surface`).
  `openapi/v1.yaml` is an OpenAPI 3.1 transcription of the forwarder's
  allow-list: every path and method `ROUTES` in `src/lib/upstream.ts` permits,
  which upstream owns each route, and the parameters the forwarder passes
  through. `src/lib/openapi-document.test.ts` keeps the document and the table
  in agreement in both directions — a table entry with no operation in the
  document is a red suite, and an operation in the document with no table
  entry is a red suite; both directions were proved red before green. The
  document describes the routing contract and deliberately leaves the rest to
  the upstreams: request and response bodies are theirs, the exact success
  status is the `2XX` wildcard the forwarder passes through, and
  `/healthz`/`/readyz` are absent on purpose (a probe is infrastructure, not
  contract — the courier/muse practice). Its header records the three gaps
  core's harness reports rather than papering over them:
  `openapi.idempotency-key` on identity's thirteen POSTs (identity does not
  implement the header, and declaring it would tell a client its retry is safe
  when it is not), `openapi.page-envelope` on the two billing listings (the
  `{data, page}` envelope is billing's contract), and
  `openapi.errors-are-problems` on the social start leg's 302 (a redirect is
  not a problem document). `cafaye.yml` now declares `exposes.api:
  openapi/v1.yaml`; the old omission block — 27 lines arguing that parlor can
  declare neither `api` nor `events` — was written before the BFF route landed
  and is replaced by what is now true. `events` stays omitted: parlor
  publishes and consumes none. The `dependencies` comment that said the
  browser calls identity directly is corrected: the BFF is the caller now.
  Measured against core's harness: the `openapi.not-declared` warning (the
  form `openapi.no-document` takes when a document is on disk but undeclared)
  is gone, and the run reports the 16 violations the document's header
  records, no others.

- **The second-factor section of `/settings`** (`worker/parlor-w31-mfaenroll`).
  identity's MFA management surface — `GET /v1/mfa`, `POST /v1/mfa/enrollments`,
  `POST /v1/mfa/enrollments/{enrollmentId}/confirm`, `POST
  /v1/mfa/recovery-codes` — is now reachable from the browser: the four routes
  crossed the forwarder's allow-list (the client performs them and a screen
  drives them, which is the bar every entry answers to), `src/lib/identity.ts`
  carries the four methods typed from `identity/openapi/v1.yaml`, and
  `src/app/settings/mfa-section.tsx` renders the state machine: disabled →
  enroll (secret and provisioning URI, copyable, shown once) → confirm (code
  input) → confirmed (recovery codes once, and the sign-out the confirm's
  session revocation leaves behind). The enabled state adds Replace (a
  rotation the service authorises with the current code) and New recovery
  codes. `src/lib/mfa.ts` holds the status query with the token in its key, so
  a second factor is never served to a session that cannot read it. The
  secret and the codes are held in component state for exactly one step and
  are never written to the query cache — a secret that outlives its step is a
  secret this app is storing, which is the defect the service's "returned
  here and never again" language exists to prevent, and `page.test.tsx` proves
  it by asserting the secret is absent from the document after the confirm.
  The gate floor moved 868 → 895 with the account in `gate.yml`. What this
  leaves — the LOGIN challenge, which is still refused and still owned by the
  login flow — is in `REPORT-parlor-mfa-enroll-01.md`.

- **A `traceparent` this hop derives, and nothing a caller chose.** A caller
  cannot put its own parent on an upstream request: `traceparent` is not on
  `FORWARDED_REQUEST_HEADERS`, and the header that crosses is minted from this
  app's own client span. `upstream.ts`'s header says why the two cases differ and
  `upstream.telemetry.test.ts` proves it with a forged `deadbeef…` parent that
  does not reach the upstream.

- **The BFF's forwarded fetch joins the trace** (`worker/parlor-otel-02`).
  `src/lib/upstream.ts` now calls `tracedFetch`, so every hop this app makes to
  `identity` or `billing` opens one CLIENT span parented to the request's SERVER
  span and carries a `traceparent` naming that client span. A browser → parlor →
  identity round trip is ONE trace in HyperDX rather than three, and the
  upstream's own server span is the next hop of it. The forwarder's own answers
  are untouched: the destination, the rebuilt path, the header allow-lists,
  `redirect: "manual"` and the fixed 502 are all decided before this call, and
  `fetchImpl` is passed through so `upstream.test.ts`'s recorder still sees
  every hop without a socket. Eight tests in
  `src/lib/upstream.telemetry.test.ts` prove the child relationship, the header
  on the wire, and that telemetry off answers identically with zero spans.

- **A context manager, which is what makes the above possible.**
  `@opentelemetry/context-async-hooks@2.11.0` is installed and `install()`
  registers an `AsyncLocalStorageContextManager`. Without one,
  `context.active()` is `ROOT_CONTEXT` for the life of the process,
  `context.with()` is a no-op, and every client span is a ROOT span with a fresh
  trace id — a trace view full of unrelated single-span traces, each carrying the
  right `service.name`, which is indistinguishable from a healthy service. The
  blocking question in `HANDOFF-otel-01.md` §4 is answered by the ruling that
  this service runs SSR + a fetch-forwarding BFF on Node, and measured on the
  BUILT Node server: `GET /v1/me` with an inbound `traceparent` exported two
  spans under that trace id and the fake upstream received
  `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-<client span id>-01`.
  Registered on the ENABLED path only, so the no-op boot still allocates nothing.

- **`.env.example` is actually IN the tree.** The previous telemetry commit's
  message says `.env.example new`, and `git log -- .env.example` agrees with it,
  but `git ls-files` did not list the file: `.gitignore`'s `.env*` matched it and
  `git add` on an ignored file says nothing at all — no error, no hint. A named
  `!.env.example` line fixes it. The file's content is the "service env" block
  from `kit/templates/compose/.env.example`; the local `.env` a contributor
  copies from it stays ignored, which is the whole of what the line buys.

- **parlor emits real telemetry.** It had zero otel references. One server span
  per request now opens in `src/lib/telemetry.ts` via the framework's global
  request middleware (`src/start.ts`), named `parlor.request` per core's
  span-name grammar, carrying the ROUTE TEMPLATE as `http.route` rather than a
  path with ids in it, with `service.name` / `service.version` /
  `deployment.environment` / `tenant_id` on the RESOURCE. Inbound W3C
  `traceparent` is continued; a missing or malformed one starts a new trace and
  never becomes a 4xx. `src/lib/telemetry.test.ts` holds 42 tests over the
  no-op, the span, and the propagation.

  **OTel SDK pinned to `@opentelemetry/api` 1.9.1, `core` / `resources` /
  `sdk-trace-base` 2.11.0, `exporter-trace-otlp-proto` 0.222.0** — in place of
  kit's `pins.md` node row, which cannot be installed: it names
  `@opentelemetry/api@2.0.0` (the package has no 2.x; latest is 1.9.1), and
  `exporter-trace-otlp-proto@0.57.0` pins `sdk-trace-base@1.30.0` against the
  2.0.0 named beside it. pins.md's own rule ("these are placeholders; a service
  pins to the version it deploys, and records the choice here") authorises the
  bump. The measurements, and three further defects in kit's
  `hono.ts.snippet` — including a `defaultTextMapGetter` that silently discards
  every inbound `traceparent` — are in `HANDOFF-otel-01.md` §2.

### Removed

- **The customer list is gone from the product** (`worker/parlor-w66-launchhonest`,
  B1). `/billing/customers` rendered every customer on the platform — and the
  identity user or account each one is for — to anybody signed in: billing
  scopes that collection by nothing, and a screen that shows every email is
  not shippable. The route, the page and screen, their tests, the landing-page
  card and the telemetry route template are removed, and `routeTree.gen.ts` is
  regenerated. The billing CLIENT keeps `listCustomers`: it is a transcription
  of billing's contract, which still declares the path, and removing the
  consumer is not the same as touching the producer — billing is out of launch
  scope. `/billing/plans` stays: a plan catalogue is not other people's PII.
  The gate floor moved 964 → 954 (twenty-four tests left with the screen,
  fourteen arrived; the account is in `gate.yml`).

### Fixed

- **`ci (kit, node) / node` is green: 335 lint errors → 0.** kit's shared `node`
  job ran ESLint against this tree for the first time ever and reported
  `✖ 335 problems (335 errors, 0 warnings)`. Every one was real and none was a
  regression — the linter had been asleep for four days (W14 found why, W15 fixed
  it) and this is what it had to say once it woke up. The tree is now
  `recommendedTypeChecked`-clean under `kit/lint/eslint.config.mjs` with **no
  override, no inline disable and no edit to kit's config**.

  Three of the ten rules were one decision each, and finding the boundary was
  most of the work:

  - **`unbound-method`, 84 findings, one root cause.** `IdentityClient`,
    `BillingClient`, `AuthValue`, `TokenStore` and every callback prop type in
    `src/components/ui/` were declared with **method shorthand**, which tells
    TypeScript the member has a `this` — so reading one off its object is "a
    method separated from its object" and the rule rejects it. The objects are
    literals of arrow functions with no `this` to lose, so the **property**
    spelling is both what the rule asks for and the truth. Measured in isolation
    before touching 20 files: the two spellings of one type produce exactly one
    finding between them. 84 → 0.
  - **`require-await`, 175 findings, one root cause** — `vi.fn(async () => x)`
    written 155 times, plus four render helpers that were `async` when the page
    component was and had not been since the route started handing the page a
    plain object. Those four were hiding **21 `await-thenable` findings** behind
    them: `await` on a non-promise is legal, so 53 inert awaits survived a
    refactor nobody noticed.
  - **`no-unsafe-*`, 11 findings, four boundaries.** `await response.json()` is
    `any`, and every probe read went straight through it.

  **Two of the fixes found real defects rather than style.** `String(record.challenge
  ?? "")` on an unknown-valued field would have put the literal text
  `[object Object]` into a second-factor screen as somebody's MFA challenge; it
    is `readString(...)` now, the helper `src/lib/identity.ts` already had. And
    the four `router.push` calls are `void` and specifically **not** `await`,
    because awaiting puts the navigation inside the surrounding `try` — a
    navigation that failed would then be rendered as `INVALID_CREDENTIALS`, i.e.
    "Invalid email or password" to somebody who had just signed in correctly.

- **`npm run lint` is the gate's lint, and the tree no longer carries a second
  standard.** This repository shipped an `eslint.config.mjs` — `recommended`, not
  `recommendedTypeChecked`, with `no-explicit-any` demoted to a warning — left
  behind by `eslint-config-next` going with the framework that named it. CI never
  read it: kit's job runs
  `npx --no-install eslint --config "$KIT_LINT_DIR/lint/eslint.config.mjs" .`
  **directly, deliberately not `npm run lint`**, because a repository's own script
  is whatever that repository calls a linter. So the command this README told a
  developer to run was a *looser* gate than the one that fails the build, and it
  was green the whole time. `npm run lint` is now `./bin/lint` — kit's config,
  fetched into `.kit/`, which is what CI's step is — and the second config is
  deleted. Two configs in one tree is exactly the drift the shared step exists to
  end.

- **`tests/assert-e2e-ran.mjs` is linted, and it had never been.** It is the
  script that fails a run of the end-to-end tier that verified nothing, and kit's
  config could not see it: `.mjs` files were in no tsconfig, so every type-aware
  rule on one died as a single parse error and the file was effectively unlinted.
  `**/*.mjs` is now in the tsconfig's `include`, with `dist`, `.output` and
  `.kit` in `exclude` so a build cannot put its own output into the program
  (`npm run typecheck` has to pass without a build). Three parse errors became
  twelve findings in that one file; all twelve are fixed at the boundary they
  describe, and the JSDoc-versus-`as` measurement that came out of it is in the
  file's own header.

- **The end-to-end tier runs past its migrations, so the row-level-security
  boundary it was assembled to test is now enforcing rather than merely
  declared.** The tier was red at `../identity/migrations/00016_account_isolation.sql`
  with `ERROR: cafaye.protect_table(account_users, identity_app): identity_app is
  not a LOGIN role on this cluster. (SQLSTATE 42704)`, reproduced on this machine
  against a container built exactly the way `e2e/docker-compose.yml` described it,
  message and SQLSTATE included.

  The cluster block mounted **nothing** over `/docker-entrypoint-initdb.d`, so
  kit's `templates/compose/postgres/initdb/10-cluster.sh` — the only thing in the
  fleet that provisions a service's owner role and its non-owner `_app` login —
  never ran, and the cluster held exactly one role. `POSTGRES_USER`/`POSTGRES_DB`
  are now `postgres` (the image creates `POSTGRES_USER` as a superuser *before*
  initdb, so `identity` would collide with kit's `CREATE ROLE` and the cluster
  would refuse to start), `KIT_POSTGRES_DATABASES=identity` declares the tenant,
  and the script is **mounted rather than copied** — a copy would be a second
  opinion about the isolation contract that stops being true the moment kit's
  script changes.

  **What changed underneath is the security-relevant half, and it was not in the
  brief: `identity` is no longer a superuser.** kit creates it `NOSUPERUSER
  NOCREATEDB NOCREATEROLE`, and **a superuser bypasses row-level security
  entirely** — so the old arrangement had the policies and no enforcement, the
  same defect as having no policies and harder to notice, because
  `relrowsecurity` and `relforcerowsecurity` both read `true` in the catalog.
  Measured on the running tier: each account's session reads its own membership
  and not another's, an owner with no identity reads 0 rows, and `identity_app`
  is refused `ALTER TABLE … DISABLE ROW LEVEL SECURITY`, `DROP POLICY` and
  `CONNECT` on any database `PUBLIC` no longer holds.

  **The migration was not made tolerant.** Passing an explicit role, skipping the
  `protect_table` call, or catching the exception would each have turned a cluster
  that is not wired correctly into a stack that boots — with the isolation this
  whole arrangement exists to prove silently absent while the suite went green.
  A fix that removed the boundary would have satisfied the suite by deleting the
  thing the suite tests.

  **`../kit` is now a required checkout, and it is not a sibling**: nothing is
  built from it, nothing is pushed from it, and it is not in `SIBLING_SERVICES` —
  an entry there would send `publish_siblings` looking for a build recipe and kill
  the default path. It is required by a bind mount, and Docker mounting a missing
  bind source as an **empty directory** is what makes that silent: initdb runs no
  script, the cluster comes up healthy, and the failure is a 42704 about a *role*
  sixty seconds later. So it is asserted twice, in the e2e job and in
  `bin/e2e-stack`'s new `check_cluster_initdb`, the second reading the mount out
  of the compose document so the two cannot drift.

  **The tier now runs 26 tests for the first time: 22 pass, 4 fail**, and none of
  the four is a cluster fault. Two are a **real defect in `identity`** this fix
  unmasked — `ListMine` reads `account_users` through a bare pool rather than
  `TxRunner`, so it carries no account identity and reads zero rows now that
  `FORCE` is enforced; `identity`'s own CI runs `identity` as a superuser too and
  hides it there. Two are a pre-existing defect in this repository's router:
  `src/routes/verify-email.tsx` declares a `component` and no `<Outlet />`, so
  `/verify-email/confirm` is served the index screen's body. Both are written up
  in `HANDOFF-parlor-e2e-protect-table-01.md` §4 and §5 rather than patched — one
  is a sibling repository, the other belongs to whoever owns the screens. The three
  social tests `parlor-e2e-social-01` added all pass against the fixed cluster.

  **The stated gap:** identity's `DATABASE_URL` names the **owner** rather than
  `identity_app`, so the process serving the browser can disable RLS on its own
  tables. `FORCE` still holds the rows; the ability to remove the policies does
  not. DECISION NEEDED in identity.

### Changed

- **billing is optional in the deploy render, and the app says so honestly**
  (`worker/parlor-w66-launchhonest`, A5 + B5). `config/deploy.yml` no longer
  dies on an empty `KIT_BILLING_URL`: `billing_url` is an optional read and
  `env.clear` omits `BILLING_URL` entirely when it is empty, because the launch
  stack deploys no billing and the render was the thing stopping the deploy.
  `identity_url` stays required — identity is in the launch. In the app, a
  missing `BILLING_URL` no longer dials `localhost:3000` (parlor's own port):
  the forwarder answers a billing route with a distinct 503 carrying
  `BILLING_NOT_CONFIGURED_CODE`, and the plans screen renders that as a
  deployment fact with no retry rather than a transport error. A missing
  `IDENTITY_URL` in production now throws naming the variable instead of
  dialing `localhost:8080` — which inside a container is parlor itself —
  gated on `NODE_ENV`, which the Dockerfile and the compose stack already
  set; the dev default survives for `npm run dev`. Three tests were proved
  able to fail against the old behavior.

- **`/readyz` is a real readiness probe** (`worker/parlor-w66-launchhonest`,
  B2). The rollout gate was a liveness gate wearing a readiness label: it
  answered `{status:"ok",deps:"none"}` whatever the world looked like. It now
  sweeps what the launch stack actually has — identity's own `/readyz` with
  a short timeout, billing only when `BILLING_URL` is set — and fails closed:
  an unreachable, non-2xx or unconfigured identity is a 503, not a pass. The
  response keeps the platform contract's keys with `deps` as an array of
  results, one per dependency probed. Ten of the seventeen tests in
  `src/app/readyz/route.test.ts` fail against the old placeholder route.

- **`cafaye.yml` no longer describes the app as Next.js.** It is TanStack Start on
  Cloudflare Workers: no `next` dependency, `dev`/`build` are `vite dev` and
  `vite build`. The second of the two claims was the more consequential — the file
  said "the routes are Next.js App Router files, so the router is the source of
  truth", and the router is now `src/routeTree.gen.ts`, which is **committed**
  rather than produced by a build, so the sentence points at something a reader
  can open and check a route against. Same correction `site` made to its
  `config/deploy.yml` in `site-cloudflare-workers-01`.

### Added

- **The social round trip, from a button to a page.** The transport packet made
  the two routes reachable through the forwarder and that was the whole of it: no
  screen started a flow, and a browser that completed one landed on identity's
  JSON body with a `Set-Cookie` beside it that nothing on the page could read.
  This closes both ends.

  **A provider button on `/login` and `/register`** — one `<a href>` per provider
  in `SOCIAL_PROVIDERS`, to `/v1/auth/oauth/{provider}` on this origin. A LINK and
  not a button, and the reason is structural rather than stylistic: the start leg
  answers a 302 to the provider and sets `__Host-oauth-state` on that same
  response, so only a document navigation can follow it while the cookie stays in
  scope for the callback. A `fetch` would resolve the 302 and hand back a
  provider's HTML; a `<button>` cannot navigate at all. It is `variant="secondary"`
  because the password field is this app's own way in and stays primary.

  The list is a CONSTANT and its header says why: `registerSocialRoutes` mounts a
  pair of routes and nothing else, there is no discovery endpoint to ask, and the
  forwarder's provider segment is deliberately open — so a deployment adding a
  provider edits one array. Naming providers in the UI is not an enumeration
  oracle either way: the forwarder already answers 302-or-404 for any slug, so a
  button tells a prober nothing the URL did not.

  **A page at `/v1/auth/oauth/{provider}/callback`,** served by a route that takes
  that one URL away from the `/v1/$` splat and gives everything else back. The
  split is on the REQUEST rather than on the path: `Accept: text/html` is a
  document and gets the page, and the one programmatic caller in this app sends
  `application/json, application/problem+json` and gets identity's bytes, so
  `completeSocialLogin` is untouched. That asymmetry — the start leg is a redirect
  the browser follows, the callback leg is a 200 with a body — is the service's,
  and a design that assumed symmetry would render a page waiting for a redirect
  that never comes.

  **The exchange happens exactly once, and that is what the shape is FOR.** An
  authorization code is one-shot: spent by the single request identity sees. A
  page whose own navigation reached identity and then fetched the same URL would
  spend it twice, and the second attempt fails on a spent code — which reaches a
  person as "this did not work" for a sign-in that worked. So the document branch
  makes no hop at all and the screen's effect latches. Three red proofs: forwarding
  the document branch, forwarding the programmatic branch, deleting the latch.

  **The answers that are 2xx and are not a session.** `completeSocialLogin`
  returns a discriminated union because the wire carries three mutually exclusive
  bodies. `linked` (the flow started signed-in, so the provider identity was
  attached to that account and nothing was minted — the body has no `token` at
  all) and `mfa_required` (a 202 that is not a session) each get their own state,
  and each is asserted by what the screen does NOT do: no token written, no
  navigation. A decline is not short-circuited from `?error=` here — that is
  identity's answer to give, made with the state cookie in hand, and asking is what
  clears that one-shot cookie. Every refusal gets a sentence and a way back; none
  of them renders a status code, and none of them is a dead end.

  **`adoptSession` on the auth context.** A token spent exchanging a code cannot
  be obtained again, so it is written rather than asked for. It is a method rather
  than a `createTokenStore()` call at the call site because the store is an
  INSTANCE: a second one writes the same key without notifying the instance the
  provider is subscribed to, and the header stays signed out until a reload.

  Suite 755 → 798, and `gate.yml`'s floor moved in the same commit. Three files
  new: `src/lib/social.ts`, two components under `src/components/social/`, and
  `src/routes/v1/auth/oauth/$provider/callback.tsx`.
- **Two gate checks that run on every commit with no caf and no container
  runtime: the local stack's catalog is one `caf dev` can believe, and the
  lockfile's `file:` dependencies name bytes npm can actually produce.** Both
  guard against defects that were real in this fleet, and both are found in CI
  rather than at `mise run stack`, which is the moment a developer is looking
  at something else.

  **`caf.dev.json` is readable by caf.** `caf` already refuses a catalog it
  cannot believe — and refuses it well, naming every unknown key and the service
  it is in rather than stopping at the first. What it cannot do is run on a CI
  runner with no caf and no Docker, which is exactly where a per-commit check
  belongs. Three of the four invariants are re-stated from `dev.Entry`'s own
  comments and need no schema copy: an entry's `name` must equal the key it is
  filed under (so a document cannot run billing's image as identity), `image`
  must be non-empty (a registry entry with no image has nothing to run), and a
  `healthcheck` must carry a `test` (without one the service counts as ready
  while merely running).

  The fourth does need the key list, and it is a second copy — so the drift is
  pointed at rather than hidden. It is `dev.Entry` and `dev.Healthcheck` as of
  caf `31e77e6`, with `git -C ../caf show 31e77e6:internal/dev/registry.go`
  named as the authority. **If caf grows a field this check fails loudly**, and
  that direction is deliberate: a false FAIL costs a minute, and the false PASS
  it replaces is the defect class this gate exists for — caf used to drop a
  misspelled key in silence and then tell a developer their catalog was missing
  something it plainly contained.

  **Every `file:` dependency's integrity matches the tarball it names.** A
  `file:` dependency is a tarball in the repository, and `npm ci` checks the
  tarball against the sha512 the lockfile records for it. When they disagree the
  install fails `EINTEGRITY` — and it fails only against a cache that does not
  already hold the bytes under the old key, which is why it can be green on the
  machine that made the mistake and red on the one that clones. That is not
  hypothetical: commit `89553a8` in this repository's sibling `site` grew
  `vendor/cafaye-ts-0.0.0.tgz` and updated its manifest, and left the lockfile's
  integrity naming the bytes the tarball used to be. The deployable image could
  not be built. The hash here is computed straight from the file rather than
  through npm, so the check cannot inherit the disagreement it is looking for.

  It is **vacuous today** — this repository vendors nothing — and still
  correct: an invariant over an empty set holds, and a service generated from
  this template that vendors the TS client inherits the check that would have
  caught it. The message says how many there were, so "0 to check" is visible
  rather than silently green.

  **Both are proven able to fail, and each is proven to fail for its own
  reason.** Six new breakages — no catalog, a misspelled key, an entry named for
  another service, an entry with no image, a healthcheck with no test, and a
  lockfile naming bytes the tarball does not have — and one new control in the
  other direction, a `file:` dependency carrying the *correct* sha512, because a
  check that rejects everything passes every breakage.

  The lockfile breakage was wrong on its first run and the control caught it.
  The planted tarball was written relative to the current directory rather than
  to the sandbox, so the check went red for "resolved to a file that is not in
  the tree" instead of for the integrity mismatch — a breakage passing for the
  wrong reason, which is a control that has proved nothing. Both now derive the
  tarball's directory from the lockfile's own path, and each breakage was
  re-checked against the message it produces rather than against its exit code.

  Gate: 43 passed, 0 failed. Self-test: 47 breakages, every check proven able to
  fail. `shellcheck -S warning` clean.

- **A local stack that exists: `caf.dev.json`, `mise run stack`, and the
  facts that make it work — so a service generated from this template is born
  able to talk to identity instead of discovering how later.** The template had
  identity client code (`src/lib/identity.ts`, `src/lib/auth.tsx`, sign in, sign
  out, register, accounts, invitations) and no way to run identity. `mise run
  dev` started a Next.js server and nothing else, so every authenticated route
  failed against an origin that was not there — and `cafaye.yml` calls identity
  `required: true`, which made that failure a contradiction with the manifest
  rather than a surprise.

  caf refuses to run a local stack without a service catalog, and states why in
  its own package doc: "an image reference guessed by a CLI is a reference that
  pulls the wrong thing". So `caf.dev.json` is committed, and each non-obvious
  value in it carries an `x-` key saying where it came from. The four that are
  load-bearing rather than conventional:

  - **parlor is deliberately NOT an entry in its own catalog.** `caf dev`
    resolves the project service from the catalog when the catalog has it and
    from the repository's own Dockerfile when it does not — and an entry makes
    caf render `image:` instead of `build:`. Adding `parlor` here would silently
    replace this repository's Dockerfile with a pull of an image that does not
    exist. A generated service needs no self-entry; this is the trap the
    `x-self` key exists to prevent.
  - **`-port 3000` in `mise run stack` is not a preference.** `cafaye.yml`
    declares no `exposes.api` (for the reason given in that file: this app
    ships no OpenAPI document, and writing one would be a second copy of the
    router that drifts), so `caf dev` cannot tell a Next.js app serves HTTP and
    leaves its host port unpublished. Measured both ways: with `-port 3000` the
    rendered document gives parlor `ports: ["3000:3000"]` and `GET /` answers
    200 from a browser; without it, the only `ports:` in the whole file is
    identity's `8080:8080` and parlor has no host binding at all. caf names this
    rather than inventing a URL — `no published port (reached by service name
    on the stack network)` — which is true, and useless to a browser. The
    container port is not this flag's concern; caf derives that from `language`
    and only rewrites the host end.
  - **`publish: true` on identity is what makes the browser path work.**
    `src/lib/identity.ts:34` defaults `NEXT_PUBLIC_IDENTITY_URL` to
    `http://localhost:8080` and the browser calls identity directly, so a
    compose service name would be unreachable by construction. Without this the
    sign-in button fails on a connection error that names no service at all.
  - **`startPeriod`, not `start_period`.** caf's catalog is JSON with its own
    spelling, and caf refuses a key it does not model rather than ignoring it —
    so identity's own compose spelling fails the stack instead of being quietly
    dropped. Verified: the rendered `caf.dev.compose.yaml` contains
    `start_period: 5s`, so the translation happens and the key was accepted.

  billing is deliberately absent. `cafaye.yml` declares it `required: false`,
  which caf treats as soft, so the stack starts without it and prints why:
  `skipped billing: optional dependency, and the local registry does not know
  how to run it`. Adding it would start a service that is not going out on
  launch day.

  `caf.dev.compose.yaml` is gitignored and `caf.dev.json` is not, and the
  asymmetry is the point: caf prints "Do not edit: every run rewrites this
  file", so committing the render is committing a generated artifact that is a
  merge conflict waiting to happen, while a catalog nobody commits is a catalog
  that only exists on the machine that wrote it.

  **Proven, not asserted.** `caf dev -registry caf.dev.json -port 3000 -dry-run`
  renders a four-service stack — `parlor` with `build: {context: ., dockerfile:
  Dockerfile}` and `ports: ["3000:3000"]`, `identity` published on 8080, plus
  `postgres` and `redis` — with `DATABASE_URL =
  postgres://parlor:parlor@postgres:5432/parlor` and `REDIS_URL =
  redis://redis:6379/0` attached to both services, billing skipped with its
  reason, and none of the `x-` keys leaking into the render. Run for real, all
  four services reached healthy, and from the host: `GET http://localhost:3000/`
  answers 200, `GET /readyz` answers `{"status":"ok","deps":"none"}`, and
  identity's own `GET http://localhost:8080/readyz` answers `{"status":"ok",
  "deps":"postgres"}`.

  **What this task does not do, stated rather than discovered later:** it does
  not migrate. Migrations are a deploy step in every cafaye service, by policy
  (`e2e/docker-compose.yml:39-42`), so nothing in this stack migrates on boot.
  Against the database caf provisions, a first registration returns `500
  relation "users" does not exist` while `/readyz` reports healthy — both are
  correct. `./bin/e2e` runs the migrations and is the tier that proves the
  integration end to end.

- **One origin: a browser on a deployed parlor can complete a sign-in, and the
  fix is in the product rather than in a proxy setting.** The chain was verified,
  not inferred. `src/lib/identity.ts` fetched from the BROWSER at
  `NEXT_PUBLIC_IDENTITY_URL`, a value `next build` inlines into the client
  bundle, so the caller of identity was a person on parlor's origin; `identity`
  serves no `Access-Control-*` header anywhere in `identity/internal/`; and
  `OPTIONS /v1/session` answers 405 because the route implements POST and a
  preflight is not that. So the preflight failed, the response was unreadable,
  and `/login` rendered "Something went wrong. Try again." on a stack that came
  up green. kamal-proxy could not paper over it: it routes by HOSTNAME rather
  than by path, so one hostname cannot send `/v1/*` to identity and everything
  else to parlor.

  - **`src/app/v1/[...path]/route.ts` is the one origin.** The browser now calls
    `/v1/session` on parlor's own origin and the handler forwards it to identity
    from the server. Same-origin needs no CORS header anywhere, which is the
    whole of what makes a sign-in possible. `export const dynamic =
    "force-dynamic"` is load-bearing and is asserted: without it Next treats a
    `GET` handler with no dynamic input as a static route and answers it from a
    file written at BUILD time, which would be a `/v1/me` frozen to whoever was
    signed in when the image was built and served to everybody.
  - **A route handler, not a `next.config.ts` rewrite**, and the reason is worth
    recording because the rewrite is four lines. A rewrite is a string
    substitution the framework performs before this app sees the request: it
    cannot refuse a path (so `source: "/v1/:path*"` forwards identity's
    introspection, MFA, API-key and OIDC-client routes too), it cannot choose
    between two upstreams on the same prefix, and it cannot bound a body or drop
    an unlisted header. The allow-list has to be code with tests on it.
  - **`src/lib/upstream.ts` is the forwarder, and its header is the security
    argument.** One configured destination read on the server at request time
    (never from a header, a query string, a path segment or a body); an
    allow-list of the twenty-two routes the two clients call, with identity's
    other eight refused BEFORE an address is contacted; the upstream path
    REBUILT from that table rather than forwarded as received, so traversal, an
    absolute URL in a segment and a doubled slash are not filtered but
    inexpressible; wildcard segments value-matched (a `:accountId` must be a
    uuid, because the router percent-decodes `accounts/%2e%2e%2f%2e%2e` into a
    single `../../` segment); header allow-lists in both directions rather than
    deny-lists; a fixed-body 502 that never echoes `ECONNREFUSED 10.0.3.7:8080`;
    and upstream statuses and bodies passed through, so a 401 cannot render as a
    success. `upstream.test.ts` calls every method on both clients and asks the
    table about each URL, so a route added to a client and not to the table is a
    red suite. **Four red proofs were run and each named tests red**: letting
    `X-Forwarded-Host` choose the destination, dropping the segment value checks,
    forwarding any `/v1/*` path, and collapsing upstream errors into a generic
    200.
  - **The session cookie is real, and its attributes are stated rather than
    assumed.** `identity` sets `__Host-session` — `Secure`, `HttpOnly`,
    `SameSite=Lax`, `Path=/`, no `Domain` — and the `__Host-` prefix is a
    contract the BROWSER enforces. The transport moved from `credentials:
    "omit"` to `"same-origin"`, and the forwarder carries `Set-Cookie` back and
    `Cookie` forward **byte for byte, never rewritten**: adding a `Domain` to
    "make it work" is exactly what makes a browser reject the whole cookie, and
    dropping the prefix would trade an enforced guarantee for a convention.
    `getSetCookie()` is used rather than `get()`, because the latter returns
    values joined with ", ", which lands inside one cookie's `Expires` and
    destroys both — identity's 202 MFA branch is the case that proves it
    matters. `SameSite=Lax` is what makes this CSRF-safe and it works because
    the topology is same-origin, not because this app sets anything.
  - **`NEXT_PUBLIC_IDENTITY_URL` and `NEXT_PUBLIC_BILLING_URL` are gone, and
    they could not be replaced by the same names.** The two addresses are
    `IDENTITY_URL` and `BILLING_URL`, read on the server at request time, and
    `config/deploy.yml` moved them from `builder.args` to `env.clear`. **One
    image now serves every environment** — a real gain and not only a
    consequence, because a missing build arg used to produce a build that exits
    0 and an app pointed at `localhost`. `src/app/v1/[...path]/route.test.ts`
    asserts against the BUILT client chunks in `.next/static` that no
    `NEXT_PUBLIC_` name and no upstream hostname is in them; a source check
    cannot see what `next build` emits. `tests/validate-ci.sh` fails the gate on
    a `NEXT_PUBLIC_` name in the Dockerfile or in `src/`, and the self-test
    breaks the tree three new ways to prove it can fail.
  - **No CORS header was added to `identity` to achieve any of this**, and the
    argument is in `src/lib/upstream.ts`: `Access-Control-Allow-Origin: *` would
    have made the browser call work in about four lines, and would also have
    let every origin on the internet call identity with a bearer token it stole
    from anywhere else — solving a deployment-topology problem by weakening the
    one service that does not have the problem. The same reasoning is why
    `OPTIONS` is not exported and the forwarder emits no `Access-Control-*`
    header at all; a test reads every response header name to prove it. **If a
    different deployment shape ever needs a policy — a native client, a customer
    integrating from their own origin — that is a narrow, allow-listed decision
    with a reason per origin, and it belongs to identity.**
  - **`e2e/edge.conf`'s `location /v1/` block was DELETED.** nginx used to
    answer `/v1/*` itself, which is why the stack was green while the browser
    could not sign in. Leaving it would have kept the suite passing while the
    BFF was never exercised at all, so its absence is now the assertion. The
    `parlor` container's only identity address is `http://identity:8080` — a
    compose-network name a browser cannot resolve — so a browser still calling
    identity directly would fail this stack.
  - **Billing goes through the same forwarder**, which is why `BILLING_URL` is
    a run-time variable too. It had the identical defect: a `NEXT_PUBLIC_`
    address inlined into the bundle, a cross-origin browser call, and no CORS
    headers on billing either. Leaving it would have meant a half-fixed origin
    and the same `NEXT_PUBLIC_*` trap still armed.
  - **What did NOT change, deliberately:** the hand-written tenancy client in
    `src/lib/identity.ts`, the session token in `localStorage`, and anything in
    `identity`. The tenancy transcription is `guard`'s to retire once identity's
    OpenAPI document describes the surface; the three steps and the outstanding
    DECISION on the error envelope are written down under "Known gaps". The token
    is the guard packet's work too — the cookie now works, and identity prefers
    the bearer header, so both are live and the `HttpOnly` half does not yet
    protect anyone.

- **A deploy story: `config/deploy.yml`, the tier that proves it, and a health
  gate the app is proven to serve.** Every other service in the fleet deploys and
  this one could not — there was no config to deploy from, no accessory story,
  and nothing `kamal` could act on. `config/deploy.yml` is a copy of
  `templates/kamal/deploy.yml.erb` from `cafaye/kit` at kit commit `b9d8a30`
  (measured with `git log -1 -- templates/kamal/deploy.yml.erb`, not the tip), and
  it differs from it in exactly five places, each argued at the line it is on and
  listed in the file's header so a diff against the template shows five
  differences rather than a fork:

  - **`healthcheck.path: /readyz`, not kit's `/up`.** The App Router serves
    exactly two paths at the root — `src/app/healthz/route.ts` and
    `src/app/readyz/route.ts` — so `/up` is a 404 on every request kamal-proxy
    makes, the container never becomes healthy, and every rollout is torn back
    after `deploy_timeout` on a release that is otherwise fine. identity and
    courier had already answered this the same way, so the fleet is now uniform;
    the interesting half is not that kit's default is wrong but that a Node app
    picks its own probe and has to serve it. **It is proven to serve it.**
    `src/app/readyz/route.test.ts` gained four cases that read the path out of
    `config/deploy.yml` and assert this app answers 200 there. Nothing upstream
    can do that, and the reason was measured rather than assumed: on kamal 2.12.0
    `kamal config` exits 0 with `path: /up` set, kamal's own
    `Kamal::Configuration::Proxy` validator accepts it too, and
    `Kamal::Configuration#to_h` does not carry `proxy` or `env` at all. Breaking
    the path to `/up` was watched turning three of the four red.
  - **No `accessories:` block at all** — no postgres, no backup. See below.
  - ~~**`builder.args` carries `NEXT_PUBLIC_IDENTITY_URL` and
    `NEXT_PUBLIC_BILLING_URL`,** and the two new required operator variables
    `KIT_IDENTITY_URL` and `KIT_BILLING_URL` feed them. This is the difference
    the Node/Next shape forces and the one that would otherwise have shipped a
    **SUPERSEDED BY THE BFF PACKET ABOVE.** The two operator variables stay and
    still feed the two addresses, but they now land in `env.clear` at RUN time
    and `builder.args` is gone: `next build` inlines a `NEXT_PUBLIC_*` name into
    the client bundle, and the browser no longer needs to know where the services
    are. One image serves every environment. The argument the original entry made
    — that a service address cannot be a run-time variable, because the prefix
    inlines it — was correct and no longer applies; the same reasoning is kept in
    `Dockerfile` and `config/deploy.yml` so a reviewer is suspicious if a
    `NEXT_PUBLIC_*` address ever comes back. The original text follows.
    This is the difference
    the Node/Next shape forces and the one that would otherwise have shipped a
    broken image: `next build` substitutes every `NEXT_PUBLIC_*` into the client
    bundle, so a service address set at run time is not a later value, it is no
    value at all. Kamal's `env.clear` looks like the natural home for them and is
    not, and saying so in the file is more useful than saying so in a comment
    somewhere else.
  - **`env.clear` and `env.secret` are both empty, written out rather than
    omitted,** because the only two variables this app reads are the two build
    args above, neither of which is a credential. An absent `env:` and an empty
    one are the same document to kamal and a different question to a reader.
  - **`KAMAL_REGISTRY_PASSWORD` appears once, in `registry.password`,** not also
    in `env.secret` as kit's template has it. The application container has no
    use for a push credential, and `docker inspect` prints it to anybody who can
    read the host.

- **`bin/deploy-config`, a tier that runs the REAL binaries against the rendered
  config.** A YAML parse says nothing useful about this file, and the properties
  that break it are invisible to one: a doubled registry host is valid YAML and
  `kamal config` exits 0 on it, a missing `builder.arch` is valid YAML and kamal
  refuses the config, and a healthcheck path naming a route nothing serves is
  valid YAML and valid kamal. So the file is rendered and handed to `kamal`
  2.12.0 and to kamal's own `Kamal::Configuration::Proxy` validator, and three
  defects are PLANTED and asserted to go red. It proves each of the seven
  required variables — the five kit requires plus this service's two — fails the
  render by name.

  It is **not** in `bin/prime`, because `kamal` and `ruby` are on neither a CI
  runner nor a node-only checkout, and a check that skips itself in CI is a green
  badge over a proof nobody took. It has a three-valued exit instead: `0` proven,
  `1` a property failed, `2` the binaries are absent and nothing was proven. `2`
  is deliberately not `0`.

- **Four shape checks in `tests/validate-ci.sh`, with four more breakages in its
  self-test** — 35 to 39 checks, 34 to 39 breakages. They need no binaries: the
  deploy config exists and declares no database; every interpolated builder arg
  has a matching `ARG` in the Dockerfile (a cross-file contract whose failure is
  invisible, because `docker build --build-arg` for an undeclared name is a
  warning, not an error); every `FROM node:` carries the `engines.node` pin; and
  the tier above is executable.

### Changed

- **`bin/prime` now runs `npm run typecheck`, between the suite and the build.**
  It ran `npm ci`, `npm test`, `npm run build` and
  `tests/validate-ci.sh --self-test`, and `tsc --noEmit` was in none of them —
  typechecking happened only in the `build` job of `ci.yml`.

  The suite cannot see a type error, for a reason of its own rather than the
  build's: vitest transpiles each file it loads and hands it to a runtime, so a
  call with three arguments where the signature takes two, a property that does
  not exist on a type, or an interface implemented with the wrong member all
  execute and pass. `tsc --noEmit` is the only thing in this repository that
  reads a declaration rather than an expression.

  Cafaye/site carried **29 type errors** behind a passing local gate for as long
  as the migration ran, and the argument is the same one the build step's entry
  below makes: a check that only runs on a runner is a check its author watches
  fail from a distance. Measured on this tree: `npm run typecheck` is 4.7s and
  exits 0; with `const planted: number = money.currency` planted in
  `src/lib/money.ts` it reports `error TS2322`, exits 2, and `./bin/prime` stops
  there — before the build, with 727 tests green above it, because vitest
  transpiled the very line `tsc` rejected and never noticed.

  It is ahead of the build in the sequence on purpose: both read the tree and
  the typecheck is the cheaper and more specific of the two, so a type error is
  a sentence about a file and a line rather than a bundler error about the same
  thing.

  The check that reads `bin/prime` needed the same repair the build step's did,
  for the same reason: its alternation could not match `npm run typecheck`, so
  adding the command would have left it still reporting a three-command gate it
  could no longer see. It now names ` run typecheck` explicitly and expects the
  exact five-command list, so a gate that loses the step reports a *different*
  list rather than a shorter one, and the 52nd self-test breakage
  (`no-typecheck-in-prime`) deletes the line and asserts the check goes red.

  **The `ci-shape-checks` floor stayed at 47 and the `check-self-test` floor
  went 51 → 52**, and that asymmetry is the point rather than an oversight:
  this extended an existing check instead of adding a seventh kind of one, so
  the number of checks the script reaches a verdict on did not move while the
  number of ways it can be proven to fail went up by one.

- **`bin/prime` now runs `npm run build`, and the check that reads `bin/prime`
  was fixed so it can still see the gate.** The gate was `npm ci` then
  `npm test`, so a green gate meant "the suite passes" and nothing more.
  `src/components/ui/feedback.tsx` calls `useCallback`/`useEffect`/`useId`/
  `useRef` with no `"use client"` directive and is re-exported from the
  `@/components/ui` barrel, so a Server Component that reaches it through that
  barrel cannot compile. The suite is structurally unable to notice: jsdom has
  no server/client boundary to cross, so every test renders green on a tree
  that does not build. Only `next build` catches this class of error.

  It is a `Changed` and not a `Fixed` because the tree builds today — measured,
  `npm run build` exits 0 — since every app-code importer of that barrel happens
  to be a client component, and the only Server Components are `.test.tsx`
  files. It is one Server Component away from red. CI *does* have a
  `typecheck + build` job and *did* go red, which is the argument rather than a
  defence: cafaye/site forked this template, inherited the trap, and sat with a
  green local gate and a red CI build for months, because a developer who
  trusts the gate they can run has no reason to go read a runner's output. A
  check that only runs somewhere else is a check its author watches fail from a
  distance. The build costs seconds and is the difference between "the local
  gate is green" and "the tree compiles".

  The check that inspects `bin/prime`'s contents was a second, smaller instance
  of the same failure: its alternation `( ci| install| test)?` could not match
  `npm run build`, so adding the command would have left it still reporting
  "exactly npm ci then npm test" — a check confidently true about a gate it
  could no longer see. It now names ` run build` explicitly, and a 40th
  self-test breakage (`no-build-in-prime`) proves that check can go red.
  Measured: `bin/prime` exits 0, and `--self-test` reports 40 breakages with
  every check proven able to fail.

- **The Dockerfile's runner stage is pinned.** `FROM node:22-slim` became
  `FROM node:22.22.2-slim`, so the image is *built* on the pin and *runs* on it.
  The file's own header has claimed "One pin, four mirrors, and the image is the
  fourth — see tests/validate-ci.sh" while `tests/validate-ci.sh` checked three of
  the four; measured with `docker manifest inspect node:22-slim`, the floating tag
  resolves a moving multi-arch index. For a service with no database the runtime
  it executes on is most of what it is, and no deploy config can fix an image that
  boots a different Node than `bin/prime` verified. The claim is now a check.
- **`docker build` is no longer broken, so the CI comment saying it is has
  gone.** `ci.yml` carried "it is currently broken for an unrelated reason (its
  deps stage inherits `NODE_ENV=production`, so `npm ci` there installs no
  devDependencies and Turbopack cannot resolve `@tailwindcss/postcss`)" plus a
  DECISION NEEDED. Measured on this branch: `docker build -t parlor .` exits 0
  and produces a runnable standalone image, because the deps stage runs
  `npm ci --include=dev`. The `build` job's assertion that `.next/standalone/
  server.js` exists stays — it was never redundant — but it is no longer the only
  thing between a green job and an image that cannot start.
- **`NEXT_PUBLIC_BILLING_URL` is a declared build arg.** It was missing, and the
  way it was missing is the argument for the new check: `docker build
  --build-arg` for an undeclared name is a warning, so a caller could pass
  `--build-arg NEXT_PUBLIC_BILLING_URL=https://billing.example.com`, read the
  successful exit code, and ship an image whose billing client is
  `DEFAULT_BILLING_URL` — `http://localhost:3000`, which is this app's own port,
  so the billing screens would have asked parlor to talk to itself.
- **`mise run deploy:config`** exists for the tier above. Not part of the gate, for
  the reason the tier is not.

- **The email-verification surface: `/verify-email`, `/verify-email/confirm`, the
  post-signup state, and the affordance on the sign-in screen.** identity's Mailer
  sends verification mail for real and `POST /v1/users` does not — its contract says
  a client that wants an address proved calls `POST /v1/email-verifications`
  "afterwards" — so the platform had a service that mails a link and no page for
  the person who clicks it. Three client calls and three screens, transcribed from
  `identity/internal/httpapi/recovery.go`:

  - **`/verify-email` asks, and says one thing.** Same constant-202 discipline as
    the reset request screen: the acceptance sentence is one constant string that
    names no address, so an address with an account and one without render
    byte-identically; the form is replaced on success rather than annotated; and a
    503 gets its own sentence because identity checks the mailer before the lookup,
    so rendering it distinctly leaks nothing while "a link is on its way" when no
    mail will ever arrive is the sentence that strands somebody. It is also the
    discoverable way in from `/login`, which is the only place a person who signed
    up, closed the tab and never verified will look — a signed-in banner could not
    reach them, because `GET /v1/email-verification` answers for the caller's own
    address and they are the one who is not signed in.
  - **The 409 is rendered, and that is a decision rather than an oversight.**
    `Service.RequestVerification` answers `409 conflict` for an address that is
    already proved — the one request route in the service that is not a constant,
    and the only answer on it that distinguishes an address. Flattening it into the
    acceptance sentence was rejected: identity declares the 409 precisely to stop a
    client telling somebody to watch an inbox nothing will arrive in, and hiding a
    proved state is a smaller wrong than stranding a person. What the screen
    guarantees instead is that it never *widens* the disclosure — the sentence
    names the state, never the address, and never the service's `detail`. Recorded
    under "Known gaps" as DECISION NEEDED.
  - **`/verify-email/confirm` spends the link**, reading the **`token`** query
    parameter from the same `RECOVERY_LINK_TEMPLATE` the reset link uses, and
    `robots: noindex, nofollow` because a one-time credential in a URL should not
    be indexed. It does not submit on load, for the invitation and reset screens'
    reason. It has no fields at all — the token IS the credential and arrived in
    the URL — so the whole form is one button, which is also the double-submit
    guard: the token is single-use, and a second call is a guaranteed 404 that would
    replace a working confirmation with "this link cannot be used".
  - **The stale-token state has a way forward rather than being a dead end.** A
    404 covers four cases behind one sentinel — never existed, expired, spent, or
    minted for another flow — and a link with no `token` is a fifth state that a
    deployment can produce by pointing the template at a path segment. Both offer a
    new link, and neither names any of the four, because naming one confirms the
    token was once real and turns a guess into a probe.
  - **A confirmation that does not sign you out, because a verification does not.**
    `RedeemVerification` revokes nothing and mints nothing — it records a fact
    about an address rather than changing a credential — so the success state reads
    the session and sends a signed-in reader on to `/accounts` and a signed-out one
    to `/login`. It is the one flow that does not answer a 204 with "sign in
    again", and getting that backwards would be a confirmation that signs you out.
  - **The register screen makes the second call and can no longer be misread.** The
    account exists from the moment `POST /v1/users` returns, so a failed
    verification request says "account created" first and the mail problem second,
    in every branch. Reporting it as a failed registration would be read as "no
    account", and the obvious next move for somebody who believes that is to
    register again — into a 409 for an address they just proved they own. This is
    also the only screen that names an address it was given: the person typed it
    thirty seconds ago and the service has just created a row for it, so echoing it
    back confirms nothing, and "Account created for kaka@example.com" is how a
    reader knows the POST reached a real service and a real database — which the
    end-to-end tier asserts.
  - **`validatePasswordResetRequest` is now `validateRecoveryEmailRequest`,** used
    by both request routes, because identity declares one `emailRequest` body for
    both and pins with `TestTheTwoRequestRoutesAnswerIdentically` that they answer
    identically. Two validators here would be two places for that identity to drift.
  - **`e2e/email-verification.e2e.spec.ts`**, six specs against a real identity:
    the 503 that a courier-less deployment must not dress as a sent mail, a real
    404 for a token nobody minted, the link with no code in it, the register screen
    refusing to un-say that the account was created when the mail request behind it
    fails, the sign-in affordance, and the byte-identical rendering of a request for
    an address with an account and one without.

- **The password-reset flow: `/forgot-password`, `/reset-password`, and the
  affordance on the sign-in screen.** identity merged its Mailer (`08e346d`), so
  `POST /v1/password-resets` now actually sends a link and the platform had no
  page for the person who cannot log in to click it. Three screens and two client
  calls, built from the handler rather than a guess:

  - **`/forgot-password` asks, and says one thing.** The service answers a
    constant `202 {"status":"accepted"}` for a registered address, an
    unregistered one, and one inside its one-minute cooldown — that constant IS
    the enumeration defence. So the acceptance sentence names no address and is
    the same string for every input, the form is REPLACED on success rather than
    annotated (a second attempt inside the cooldown sends nothing while still
    answering 202, so it would be a promise the service cannot keep), and a 503
    gets its own sentence: identity checks the mailer BEFORE the address lookup,
    so rendering it distinctly cannot leak anything, and "check your inbox" when
    no mail will ever arrive is the sentence that strands somebody. A 422 is the
    only failure that names a field, and it names `email` for a malformed
    address — the caller's own input, before any lookup.
  - **`/reset-password` spends the link.** The token comes from the **`token`
    query parameter**, which is what `RECOVERY_LINK_TEMPLATE` spells in every
    example in identity (`https://…/reset?token={token}`), rendered by
    `internal/courier`'s `LinkTemplate` into courier's `url` field for a
    `password_reset` message. It does not submit on load, for the reason the
    invitation screen does not accept on load: mail clients and link scanners
    fetch a URL to preview it, and a redeem-on-render screen would set somebody's
    password before they chose one. Success redirects to
    `/login?password-changed=1`, and the sign-in screen reads only that
    parameter's PRESENCE — the 204 mints no session, so signing in again is the
    only route forward, and the sentence is there to say why.
  - **Four failure states on the reset screen, none of them a blank screen.** A
    404 covers four cases behind one sentinel — never existed, expired, spent,
    or minted for another flow — and there is no honest way to tell them apart,
    so it says the link cannot be used and offers a new one. It deliberately does
    NOT say "expired": the first draft did ("it may have expired, or it may
    already have been used"), which reads as more careful and is strictly worse,
    because naming two of the four as plausible tells anyone probing tokens that
    the one they held had once been good. The others are the weak-password 422 on
    the password field, a 503 that does not send anyone to their inbox, and a
    generic sentence for everything else — `thrown.message` is never rendered,
    which is where a proxy's host and port live.
  - **The password floor applies on reset and not on sign in**, and the two
    validators now sit in the same file so the difference is visible in one
    place. Resetting is the moment a password is being *set*; refusing to *send*
    a short password at sign-in would lock out the accounts whose passwords
    predate the rule, which are the ones the reset screen exists to rescue.
  - **`password_confirmation` / `mismatch` is a code this app invents**, because
    the service's confirm body is `{token, password}` and never sees a
    confirmation. It goes through `fieldErrorMessage` anyway — that is the one
    place a field code becomes a sentence.

  **The e2e tier covers the half a stub cannot.** `e2e/password-reset.e2e.spec.ts`
  drives the real screens against the real identity over a socket, which is what
  makes the anti-enumeration claim mean something: the unit tests prove what a
  screen does with a status it was handed, and only the stack proves the service
  hands out that status. Notably it asserts the 503 path does NOT say "check your
  inbox" (this stack runs no courier, so `recovery.Unavailable{}` makes identity
  answer 503 — which is exactly the case where that sentence is harmful), and
  that a real 404 offers a new link rather than rendering a form that could only
  fail again.

- **A real design system, replacing the placeholder palette.** `tokens.css` was
  explicitly a "PLACEHOLDER PALETTE … NOT the cafaye brand" — a neutral graphite
  ramp chosen only so the shell had something coherent. It is now a designed
  system: a warm paper-and-ink neutral (hue 38) because the product is a ledger,
  and one chromatic voice (`seal`, a deep petrol-teal) reserved for the things
  you can act on. Light and dark are both first class, and the semantic layer is
  structured so no component hardcodes a colour literal.

  **The numbers are asserted, not claimed.** `src/styles/tokens.test.ts` is a
  new 50-test suite that parses `tokens.css` and computes WCAG contrast from
  the declared pairings, in both themes, on every run. It is why four
  decisions in the system are arithmetic rather than taste:

  - **There are two text weights, not three.** The band between 4.5:1 and 7:1
    on this ramp is ~1.4 lightness steps, so a "subtle" third step either misses
    the text floor or is indistinguishable from `muted`. There is consequently
    **no `--color-placeholder` token** — a placeholder is text and owes 4.5:1,
    so a compliant one is exactly `muted`, and help text belongs in `Field`'s
    `hint`.
  - **The focus ring is a halo and its 2px offset is load-bearing.** The ring
    clears 3:1 on all three grounds in both themes, but in dark mode it is the
    *same colour* as the primary fill (1.00:1) and no hex value fixes that,
    because the ground is near-black and the fill is a light teal. What makes
    it visible is the gap `outline-offset` opens, painted by the ground. So the
    ring is tuned against grounds, never fills, and the test fails if any
    `.focus-ring` rule sets the offset to zero.
  - **`--color-brick-300` and a `neutral-500` dark border exist** because a
    pairing measured 4.11:1 and 2.95:1 respectively. A ramp earns a step when a
    pair needs one.
  - **Both ramps are tested monotone in luminance**, because a ramp with two
    steps at equal lightness is one where `-300` and `-400` are
    indistinguishable and nobody can tell which was meant.

- **`ConfirmDialog`, and the destructive-action path that needed it.** Deleting
  an account rendered its confirming button as `variant="primary"` — the same
  visual weight as "Save name" three panels up, so the most dangerous control
  on the page was the least distinguishable one. A modal confirmation replaces
  it, with focus landing on Cancel, Escape and Cancel as the only exits (the
  scrim deliberately does not dismiss), focus restored to the trigger, and
  Escape suppressed while the delete is in flight. Built on `div[role=dialog]`
  rather than native `<dialog>` because jsdom does not implement
  `showModal()`, so the native version's properties would be untestable in the
  tier this repo gates on; that trade is stated in the source.

- **`Callout`, `Spinner`, `Surface`, `VisuallyHidden`, `TextLink`, `CardLink`.**
  The ten hand-written `underline underline-offset-2` links had **no focus
  ring at all** — invisible in review, unusable by keyboard — and the ten
  hand-written cards had drifted across two paddings. `Spinner` is
  `aria-hidden` on purpose: whatever is busy already announces itself, and a
  third announcement is noise.

- **`docs/design-system.md`**, a guide for building a screen: which component
  to reach for, what each variant means, the four measured decisions, and an
  explicit list of what is deliberately absent (theme toggle, `Table`, `Tabs`,
  `Toast`, a general `Modal`, full-page skeletons) with the reason for each.

- **`e2e/design-system.e2e.spec.ts`.** Every other assertion about the
  primitives is jsdom, which does not load the stylesheet, does not evaluate
  `@media (prefers-color-scheme)`, and computes no layout — so the unit tier can
  prove a control has a focus-ring *class* and cannot prove the ring is
  *painted*. This spec asserts the rendered `outline-width` and `outline-offset`
  are non-zero on **every** control a real Tab walk lands on, measures the ring's
  contrast against the resolved surface, checks every painted text colour on the
  login page against 4.5:1 (3:1 at ≥24px, taking the background from the
  nearest painted ancestor), forces `colorScheme: 'dark'` to prove the dark
  block repaints, and drives the account deletion with no `.click()` anywhere in
  the flow. Verified by breakage: replacing `.focus-ring` with `outline: none`
  fails it in the browser and nothing in `npm test` notices.

### Fixed

- **`bin/prime` was green on the machine that produced the TanStack migration
  and red on every machine without `caf`, because two of the three `gate.yml`
  proof floors were counts of what happened to run rather than counts of what
  the repository declares.** Measured on this tree before the fix, one variable:

      environment                ci-shape-checks       check-self-test
      caf + shellcheck + docker     46 passed, 0 skipped   50 breakages, exit 0
      caf absent                    45 passed, 1 skipped   49 breakages, exit 1
      caf and docker absent         44 passed, 2 skipped   —

  Three checks in `tests/validate-ci.sh` are gated on `caf`, `shellcheck` and
  `docker`; none of the three is something this repository requires, and each
  prints SKIP rather than PASS when its tool is absent. So `46` was a
  measurement of one fully-loaded machine. It was red on every machine that is
  not that one — which is every CI runner — and on this fleet, where "a check was
  deleted" and "a check could not run" are the same event to a passed count, it
  could not tell those two apart either.

  Both floors now read a DECLARED total, which means the same thing everywhere.
  `tests/validate-ci.sh` prints `47 checks declared, 47 passed, 0 failed, 0
  skipped`: every check reaches exactly one verdict, so passed + failed + skipped
  IS the number of checks the repository declares, and it is 46 on all four
  machines above. Deleting a check moves it; an absent tool moves only the split.
  Each self-test breakage declares the environment axis it needs, so a breakage
  this machine cannot witness is printed as `UNPROVABLE`, counted separately, and
  never counted as proven — while the declared total the floor reads stays put.

  **Neither floor was lowered.** `46 -> 45` and `50 -> 49` are the edits that
  would have bought a green CI, and both are a floor that can no longer notice a
  check going missing. The unprovable breakage is named and printed rather than
  skipped, because a skip nobody is forced to notice is not a pass. Deleting one
  check, in a scratch copy, now goes red as `gate.floor: proof
  'ci-shape-checks' reported 46 and the declaration's floor is 47`.

- **A gate check called `skip`, which is not a function — exit 127 on every
  machine without `caf`, with no FAIL, no tally and no proof line.**
  `tests/validate-ci.sh` defines `skipped()`; `skip` is the counter variable
  (`skip=0`). Bash looked for a program named `skip`, found none, and died on
  the line that used it — inside the branch that runs only when `caf` is ABSENT,
  which is why the machine that wrote it was green and every CI runner was not.
  There is now a check that every tally-shaped command in that file names a
  defined function, and it is STATIC because the dynamic answer cannot exist: a
  misspelled helper has already killed the process before any tally could be
  read.

- **This template's `cafaye.yml` was not a YAML document, so no cafaye command
  could read it — and every repository generated from this file inherited that.**
  `description:` held an unquoted colon followed by a space ("The cafaye web
  app: App Router shell"), which YAML reads as a nested mapping, and the document
  stops there:

      $ caf dev --dry-run
      caf: caf dev: INVALID cafaye.yml: invalid YAML: [21:14] mapping value is
      not allowed in this context

  In a template this is worse than in a service. The whole point of the template
  is that the next repository starts from something that works, and this one
  shipped a manifest `caf dev`, `caf contract`, `caf deploy` and `caf env` all
  refused to open.

  It survived because **nothing in CI parses the manifest as YAML**. Every check
  in `tests/validate-ci.sh` reads the file through `manifest_declares`, which is
  `sed` matching `^name:` — a line pattern, not a parser — so a document that
  does not parse passes every check it has. This repository was 40 passed,
  0 failed against a manifest no tool could open.

  The value is quoted, one check now parses the file, and that check is proven
  able to go red: the self-test breakage `an-unquoted-colon-in-the-manifest`
  reproduces this exact defect in the sandbox and fails. It is deliberately
  narrow — an unquoted scalar containing `": "` or ending in `":"` — because a
  check claiming to validate YAML without a YAML parser would be the same
  false-green in a new place.

  The same fix went into `site` in the same window (`cafaye/site@0aa7494`).
  Both were unquoted sentences written by a person editing prose, which is the
  argument for the check rather than for the quoting.

- **`Callout` was unreachable from a Server Component, and the only reason the
  build was green was that no Server Component had asked for it yet.**
  `ConfirmDialog` and `Callout` shared `src/components/ui/feedback.tsx`, and the
  barrel re-exported both. The file calls `useId`/`useEffect`/`useCallback` for
  the dialog and calls nothing for the callout, so the file could only be
  resolved one way and the other component was wrong either way — as a Server
  Component the hooks fail `next build`; with a file-level `"use client"` the
  callout ships hydration JavaScript to render a `<div>` with a `role`.
  jsdom cannot see this class of defect at all, because jsdom has no
  server/client boundary to cross, so `npm test` was structurally incapable of
  catching it and green was not evidence of anything.

  Reproduced with a one-route probe before changing anything. A Server
  Component rendering `Callout` through the barrel fails the build with:

      You're importing a module that depends on `useEffect` into a React
      Server Component module.

  Note that the suggested repair in that message — "mark the file with the
  directive" — is the wrong one here, and produces a tree that builds while
  charging every page for a client bundle. So the fix is a split, not a
  directive: `ConfirmDialog` moved to `src/components/ui/confirm-dialog.tsx`
  with `"use client"`, `Callout` stayed behind hook-free, and the barrel
  re-exports both. The same probe now compiles and prerenders as a static
  page. The moved code is byte-for-byte unchanged — `git diff` of the old block
  against the new file is empty — so this is a file-boundary change and not a
  behaviour change.

- **`src/components/ui/client-boundary.test.ts` now enforces both halves.** A
  file that calls a hook must declare `"use client"`; a file that calls no hook
  and declares it anyway ships hydration JavaScript for nothing. Both are
  proven able to go red rather than assumed to: undoing the split breaks two
  tests, marking `spinner.tsx` as a client component breaks a third, and the
  blanket `"use client"` — the wrong fix — is caught only by the third, which
  is documented in the file along with why the second cannot see it.

- **The ten hand-written links in the screens had no focus ring at all.** Every
  one was `className="font-medium underline underline-offset-2 hover:no-underline"`
  with no `focus-visible` rule, so a keyboard user tabbing through the account
  screen had focus on a link and nothing to see. `TextLink` and `CardLink` exist
  partly so this cannot recur, and the ten sites are listed with their
  replacements at the end of `docs/design-system.md`.

- **Ten busy buttons had no visible busy state.** Every one set `aria-busy` and
  `disabled` but rendered no spinner, so the only visual change was reduced
  opacity — which is indistinguishable from "this control is unavailable to
  you". A person could not tell "working" from "you cannot do this". All ten
  now pass `busy`; this is the primitive being adopted, not a refactor.

- **Leaving an account is now confirmed, and that was the bigger omission.**
  Deleting was destructive and unconfirmed; leaving was a single click that
  removes your membership, on a screen whose own copy says "You will need a new
  invitation to come back". Deleting is dramatic, leaving is quiet, and quiet
  irreversible things are the ones clicked by accident. Both are confirmed now.

- **The two `aria-busy` buttons on the account screen had the same accessible
  name.** Once leaving was confirmed, the opener and the confirming control
  were both called "Leave this account" — two controls, one name, no way for
  somebody navigating by name to say which was which. The opener is now "Leave"
  and the confirm is "Leave this account", and a unit test asserts they differ.

### Changed

- **`Button` gained `destructive` and `size`, and a `busy` prop.** The accessible
  name is unchanged when busy, as before; `type` now defaults to `button` so a
  "Cancel" cannot post a form. There is deliberately no `href` — a button that
  navigates is a link, and the absence is what stops the wrong thing being
  easy.
- **`Field`'s hint and error now share one polite live region**, in reading
  order (what this is, then why it is complaining), so a message that appears
  on submit is announced without moving focus.
- **`LoadingState` takes `rows`** for a list-shaped wait, and `ErrorState` takes
  `retrying`; the retry is now a real `Button`, so it keeps its name when busy.
- **`gate.yml`'s suite floor is 484**, re-measured on this tree
  (`Tests  484 passed (484)`, 21 files) — up from 377, of which 107 are new: 50
  in `src/styles/tokens.test.ts`, 54 across the three new component suites, and
  3 in the account screen's suite for the `ConfirmDialog` work. The 35
  `validate-ci.sh` checks and 34 self-test breakages are unchanged.

- **`src/components/ui/index.ts` no longer says "shadcn/ui later".** It
  described the barrel as a staging post for a library install that is not
  happening; the primitives here are cafaye's own and the file now says so. The
  same correction is in `AGENTS.md` and `README.md`.

- **`LICENSE`, and `"license": "MIT"` in `package.json`.** parlor shipped no
  licence file at all, which is not "unlicensed, therefore free" — it is **all
  rights reserved**, the default copyright position when a public repository
  grants nothing. The README ended with a bare `MIT.` under a "Contributing"
  heading, which is not the conventional place a reader looks and is not a
  section a compliance tool reads.

  parlor is a platform consumed through the service registry, so MIT is what
  keeps a consumer's own licensing situation unchanged when they add it. The
  copyright line matches the three repositories that already shipped a licence
  exactly: `Copyright (c) 2026 cafaye`.

### Fixed (kit-18 D12 sweep)

- **The gate step's comment no longer narrates a workaround for a reader that is
  fixed.** It explained that this step used to be a `run: |` block, and why:
  core's reader collected block bodies only, so the one-line form was invisible
  to `gate.ci-disagrees`. Core `63fd319` captured the inline form too, so the
  paragraph was a workaround's obituary kept in the place a reader looks for
  reasons — and it read, to anyone skimming, as a reason the current spelling
  was load-bearing.

  What survives is the part that is still doing work: this is the ordinary
  one-line spelling, nothing about the job is YAML, and
  `tests/gate-declaration-self-test.sh` proves the checker sees this step's
  invocation and goes red the moment it stops calling the declared argv.
  `tests/gate_declaration_check.py` (kit-18) is what flagged it.

### Added

- **`gate.yml` — this repository's gate, declared instead of discovered.**
  `core` ships the standard (a `gate.schema.json`, a `harness/gate_check.py`
  and the reasoning in `docs/gate.md`), and this is the adopting packet for
  `parlor`: one file at the root saying what gates the repository
  (`./bin/prime`, behind `bin/prime`, resolved by `[tasks.prime]` in
  `mise.toml`, and by the `prime` job in `ci.yml`), what it needs from the
  machine that is not in the repository, and what its own output must contain
  before "passed" means anything. The honest answer for the second question is
  `selfContained: false`: `node_modules/` is gitignored, so a fresh clone needs
  the npm registry once, and no Node is vendored. Both requirements name a
  command you can paste and what "unmet" looks like, and the toolchain one is
  demonstrated rather than asserted — with `.npmrc`'s `engine-strict=true`, a
  Node that is not 22.22.2 makes `npm ci` exit 1 with `npm error code
  EBADENGINE`, so the pin is a red `bin/prime` and not a suite that quietly
  passed on a different runtime.
- **Three `proof` floors, because `bin/prime` runs three separately-countable
  things and "exited 0" says nothing about any of them:** 377 vitest tests,
  the 35 checks in `tests/validate-ci.sh`, and the 34 breakages in its
  self-test. A run that skipped one and exited zero is `gate.proof-missing`,
  which is a failure — the `cafaye-rb` defect, where a tier never executed once
  and the run printed `ok`. The floors are decrease-detectors, not budgets:
  they are today's counts, so a suite that quietly lost forty tests cannot
  report itself as passing. Note what this repository does **not** have, which
  `core` does: a ratchet test that forces the floor up when the suite grows.
  Here it is a thing a human has to remember.
- **`tests/gate-declaration-self-test.sh` — proof that the proof can fail.** A
  control on an unmodified clone, then every breakage asserted to go red **and
  to name the finding it expects** — including the one that is not string
  matching at all: a well-formed `bin/prime` that is `exit 0`, where every
  string in `gate.yml` is true and the repository is ungated. It is
  deliberately not in `bin/prime`: the checker is `core`'s and is not vendored
  here, and the proof cases each run the whole gate in a fresh clone. It exits
  **2**, never 0, when `core` is not beside the repository.
- **Colour cases built from captured bytes.** Four fixtures reproduce the exact
  byte sequences a real run of this gate wrote with `FORCE_COLOR=1` — the
  coloured `Tests` line, one where the suite lost tests, one where it skipped
  one, and one that printed the file count instead of the test count. They are
  transcriptions rather than hand-rendered imitations, because a fixture that
  re-drew the output would be testing the fixture.

- **The whole-stack end-to-end tier.** `./bin/e2e` brings up a Docker Compose
  stack — `parlor` built from here, `identity` and `guard` built from
  `../identity` and `../guard`, one Postgres, one Redis, and the same-origin edge
  described above — waits on each service's `/readyz` with a bounded poll,
  installs the pinned Chromium, runs six Playwright specs, checks the report and
  takes the stack down. It is deliberately *not* in `bin/prime`: a whole stack
  is not a per-commit gate. Six specs, in two files:
  `e2e/session.e2e.spec.ts` is the headline path — a person creates an account,
  signs in, sees an account row `identity` created and made them the owner of,
  creates a second account through the form, signs out, reloads, and is signed
  out — and it includes the security case that only a real service can settle,
  a wrong password and an address that was never registered rendering
  byte-identical refusals. `e2e/stack.e2e.spec.ts` is the whole deployment seen
  from a browser: every service's `/readyz` as rendered text, guard refusing an
  anonymous caller, and the one API-shaped assertion, which is there because
  guard's BFF has no page and asserts the *distinction* between 401 and 503 —
  the only way to tell that guard reached identity at all.
- **`e2e/no-token-artifacts.ts` — the credential guard, and the first version of
  it was wrong.** Playwright's config sets `trace: "off"` and `video: "off"`
  because a trace is a full request log and four of this suite's requests carry
  `Authorization: Bearer <identity session token>`. A setting is not a
  guarantee, so the global teardown walks every file the run produced and fails
  if one contains a token the run actually minted — recording tokens to a
  `0o600` file in the OS temp directory, never to the repository and never to
  the artifact directory, and destroying it on every path. The first version
  compared raw bytes and reported *"6 files scanned, none found"* on a run that
  had just written six traces each containing the full bearer header: a trace's
  network log is NDJSON **inside** a deflated zip, so the needle was not in the
  bytes of the `.zip`. It now reads archive members (`unzip`, declared a
  prerequisite rather than assumed) and deletes the offending files before
  failing, because a red run that leaves traces full of live tokens on disk has
  fixed the badge and left the problem where somebody's bug report will find
  it.
- **`tests/assert-e2e-ran.mjs` — the tier cannot pass by not running.** Fails
  when the JSON report says fewer than `MINIMUM_TESTS` passed, when anything was
  skipped, and when anything only passed on retry. It is the guard-05 mechanism
  (a gated tier that exits 0 having verified nothing) applied to a tier built so
  it cannot skip at all: there is no `test.skip`, no `test.fixme` and no
  environment variable that turns it off.
- **`.github/workflows/e2e.yml`** — the tier's own workflow and its own job, not
  `continue-on-error`. It checks out `identity` and `guard` beside this
  repository (the stack builds their images from there), installs `goose` pinned
  to an exact version, runs `./bin/e2e`, uploads the JSON report, and then runs
  the report check again with `if: always()` so the count is in the log whatever
  happened. No secrets: the fixture database, its credentials and its volumes
  are throwaway.
- **`tests/validate-ci.sh` — fifteen more checks, and the self-test grows from
  sixteen breakages to thirty-four.** The new ones are all claims about whether
  the end-to-end tier can be green without having run: it has its own workflow,
  it is not in `ci.yml` or `bin/prime`, the job calls `./bin/e2e`, it cannot be
  soft-failed, and it calls the report check. Plus the config invariants —
  `trace` and `video` off, `retries: 0`, no `test.skip` anywhere in `e2e/` — and
  the topology: every published port a substitution, inside `16000-16099`,
  colliding with nothing this workspace already owns (the observability stack's
  `15xxx`, the identity-07 worker's `5437`, darkroom's `55432`, the standard
  service ports), matching the fallbacks in `playwright.config.ts`; every image
  pinned to an exact tag; and every service carrying a `healthcheck` or a
  `FINDING` in its own block. Three of the new checks were wrong before they
  were right and the self-test is what said so — they are written up where they
  live.
- **Measured, on an M-series laptop with OrbStack: a cold `./bin/e2e` is 5m 08s
  (3m 23s of it building three images from three toolchains) and a warm one is
  1m 31s, of which 4.3s is the six specs.** The specs are 3% of a warm run. The
  stack is the cost, which is the argument for the tier not being in
  `bin/prime`, and the warm number is the one a self-hoster needs.
  `COMPOSE_PARALLEL_LIMIT` defaults to 1 because three toolchains building at
  once took the container runtime down on this machine and the error named a
  socket rather than a cause.
- **`e2e/` layout**, all documented in the files themselves: `docker-compose.yml`
  (topology, port block and readiness, with where the topology came from and
  what it cost), `edge.conf` and `proxy-headers.conf` (the same-origin edge),
  `session-tokens.ts` (the one place a token is written down and the one place
  it is destroyed), `no-token-artifacts.ts` (the teardown).

- `.github/workflows/ci.yml` — three jobs. `ci` calls kit's reusable workflow
  at `cafaye/kit/.github/workflows/ci.reusable.yml@master` with
  `language: node`, so the shared install/lint/test contract lands here
  without a copy. `prime` runs `./bin/prime` — the command a developer runs —
  and then `git diff --exit-code -- package-lock.json`. `build` deletes
  `.next`, runs `npm run typecheck`, runs `npm run build` with the two
  build-time `NEXT_PUBLIC_*` values set, and asserts that
  `.next/standalone/server.js` and `.next/BUILD_ID` exist, because those are
  what the Dockerfile copies and nothing else notices when they are missing.
- `tests/validate-ci.sh` — the half of the gate that checks the gate. Eighteen
  checks over the runtime pin, the lockfile contract, the gate command, the
  npm scripts the workflow calls, and the agreement between `package.json`,
  `mise.toml`, the workflow and `cafaye.yml`. `--self-test` breaks a
  throwaway copy 16 ways and asserts each one goes red, plus the opposite
  case: a comment that merely *mentions* `npm install` must not fail the check
  that forbids it. It reads the workflow as text with anchored greps, so it
  needs no PyYAML, no yq and no jq.
- The runtime pin, in `package.json`: `engines.node` 22.22.2 and
  `packageManager` npm@10.9.7. There was no `engines` and no `packageManager`
  before, so nothing in the repository pinned the runtime — `mise.toml` did,
  but mise is a workstation tool and a CI runner never reads it. The same
  `npm ci` on the machine this was written on ran on Node 22.12.0 one directory
  away from the pin.
- `.npmrc` with `engine-strict=true`, so the pin is a gate. Verified both ways
  on a throwaway package: with it, `npm ci` exits nonzero (`npm error engine
  Unsupported engine … Required: {"node":"99.0.0"} / Actual: {…,"node":"v12.0.0"}`);
  without it, the same command prints `npm warn EBADENGINE` and installs.
- `bin/prime` gained a third command, `bash tests/validate-ci.sh
  --self-test`. It was `npm ci` then `npm test`. A developer running the gate
  should get the same three checks CI does; otherwise the CI half is a variant,
  and a variant is the thing this removes. The two original commands are
  unchanged and still the reproduction check.

### Fixed

- **The floors in `gate.yml` and the floors this repository's self-test breaks
  things against are now asserted to be the same numbers.** `gate.yml` said so
  itself, at the `suite` proof: there is no ratchet test here, so "raising this
  number when the suite grows is a thing a human has to remember until MD12's
  machinery lands." That remembering is now a control — `control 3` reads both
  files and compares, statically, and costs nothing.

  Added because this is the **third repository in this batch** where a floor and
  a second copy of that floor drifted apart. In `billing` the copy sat inside a
  case that reported a green while proving nothing. In `caf` the merge itself
  made the floor wrong, and correcting it turned the self-test's stand-in red
  because the stand-in carried its own `432`. Here the copy is in five `printf`
  fixtures and one `sed` edit, and every failure mode is loud rather than
  silent — a stale literal makes that `edit` a no-op, which leaves the gate
  green, which the `expect_red` beneath it reports as a failure. Loud is better
  than billing's, but it is still a number held in two files by a comment, and a
  comment is not a check. Verified in both directions: green at 377, and red
  naming the proof when the floor is moved to 378 and the script is not.

- **The escape tolerance that was a workaround for a core defect is deleted,
  and the deletion is a tightening.** `core-13` (`c63af27`) landed MD17:
  `harness/gate_check.py` strips ANSI escape sequences from the gate's captured
  output in exactly one place — `prove()`, where the output is read — before it
  applies any `proof[].match`. The `suite` proof no longer needs the
  `(?:[ ]|\x1b\[[0-9;]*m)*` runs it carried for that gap, and they are gone:

      - match: '^(?:[ ]|\x1b\[[0-9;]*m)*Tests(?:[ ]|\x1b\[[0-9;]*m)*([0-9]+)[ ]+passed(?!(?:[ ]|\x1b\[[0-9;]*m)*\|)'
      + match: '^[ ]*Tests[ ]+([0-9]+)[ ]+passed(?![ ]*\|)'

  The runs could match *nothing*, and that is the half that made them a liability
  rather than only an inconvenience: on the stripped bytes
  `      Tests377 passed (377)` the old pattern matched and read 377 off it, and
  the new one refuses the line. `vitest` always prints a space between the label
  and the count, so a line without one is not a summary a floor should be read
  from. Both verdicts are asserted on the same fixture in
  `tests/gate-declaration-self-test.sh`, so the tightening is measured rather
  than argued.

  The negative lookahead `(?!…\|)` is kept untouched — it has nothing to do with
  colour, and it is what makes a suite that *skipped* a test
  `gate.proof-missing` instead of a smaller green. Every other group stays
  `(?:…)`: the floor is read from exactly one capture group, and there is now a
  case for what happens when there are two.

  Three new cases and one new assertion guard the deletion rather than trusting
  a comment: `no-separator` (a summary whose label and count are not separated
  by a space is refused), `no-separator-under-the-old-pattern` (the same line is
  accepted under the deleted tolerance, which is what makes the first case mean
  something), `floor-with-two-capture-groups` (a second group beside the first
  is `gate.proof-invalid`, not a smaller pattern), and a static check that fails
  if **any** `match:` in `gate.yml` names a terminal escape, in any spelling and
  raw ESC included. Putting the tolerance back is now a red, not a question for
  the next reviewer.
- **`ci.yml`'s `run: |` block, which was the same kind of workaround, is gone
  too.** `core-12` (`63fd319`) fixed `workflow_run_lines()` so a one-line
  `run: <command>` is read rather than invisible to `gate.ci-disagrees`, so the
  `prime` job spells the gate invocation the ordinary way again. Two cases pin
  it: `ci-disagrees` rewrites the one-line command in place, and the new
  `ci-step-deleted` removes the step entirely — so "the checker can see this
  step" is asserted from both sides instead of assumed from a green control.
- **The self-test's second control now guards `core`'s stripper rather than this
  repository's pattern, and says which it is guarding.** With stripping in
  place, control 1 cannot be made red by colour at all, so the `FORCE_COLOR=1`
  control is the only case that would go red if `core` ever stopped stripping.
  The `prefix-pattern-colour` case used to SKIP once core learned to strip; it
  now asserts which side of MD17 the repository is on and prints which answer it
  got, because "the pre-fix pattern is green *because* core strips" is a fact
  worth stating rather than a case with nothing left to say.

- **A gate proof that could not see coloured output, so a green run was
  reported as `gate.proof-missing`.** The `suite` proof reads the vitest
  summary, and the pattern it used — `^[ ]*Tests[ ]+([0-9]+) passed` — is
  correct for the output a human sees and wrong for the bytes the checker
  reads. `vitest` decorates that line, and with `FORCE_COLOR=1` in the
  environment the gate is captured in, the bytes on disk are
  `\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m377 passed\x1b[39m…` — a line that
  begins with an escape, not with a space, so `^[ ]*` cannot match it. The
  checker reported `gate.proof-missing` about a gate that had proved, in the
  same log, that it ran 377 tests, and three other cases failed the same way:
  fixtures that should have been caught by `gate.floor` were caught by
  `gate.proof-missing` instead, because a floor is never read when the proof
  never matched. The pattern now carries no escape handling at all:
  `core` strips the escapes before it matches, and the space between the
  label and the count has to be a real space.
- **A suite that *skipped* a test satisfied the suite proof.** `vitest` writes
  `Tests  2 passed | 1 skipped (3)`, and the old pattern matched that line and
  read 2 off it. The proof now refuses any line where a `|` follows `passed`,
  so a skip is `gate.proof-missing` rather than a smaller green — the rule
  AGENTS.md already states for the end-to-end tier, applied to the suite. This
  half is a tightening and is not about colour: **keep it** when the escape
  tolerance is deleted.
- **A control that could only pass on a machine whose tools do not colourise.**
  `tests/gate-declaration-self-test.sh` ran its control once, against whatever
  bytes the local toolchain happened to produce, so the pattern above was
  green here and red on the manager's. The control now runs **twice**: once as
  before, and once with `FORCE_COLOR=1` in the environment the checker captures
  the gate in. A self-test's own control going red is no longer a finding to
  disclose at the end of a report — it blocks the packet (D13).
- **A breakage that stopped applying still reported "goes red".** The script
  broke its sandboxes with a Python edit that fails loudly when the text it is
  replacing is not there, but on failure it carried on, so a case whose setup
  had gone stale would go red for an unrelated reason and be reported as
  catching the finding it was written for. An un-applied breakage is now a
  `FAIL` in its own right, and every expectation refuses to run without it.
- **A step that ran the gate was invisible to `core`'s gate checker.** (Carried
  over from the previous packet, which was not landed; re-recorded here because
  the change ships in this one.) `harness/gate_check.py`'s
  `workflow_run_lines()` collects a workflow's `run: |` block bodies and
  nothing else: its `RUN_KEY` is `^(\s*)run:\s*([|>][-+]?)?\s*$`, which a
  one-line `run: <command>` does not match. `ci.yml`'s `prime` job ran
  `./bin/prime` on one line, so `gate.ci-disagrees` reported that CI does not
  run the gate when CI does run it — on a declaration that was entirely true.
  The same reader also misses `run: git diff --exit-code` in **`core`'s own**
  `ci.yml`, so the gap is in the checker and not in this workflow. The step is
  now a block scalar, which changes what the step does not at all, and the
  reason is written above it so nobody tidies it back. The fix belongs in
  core's `workflow_run_lines`.

### Changed

- **`docker build` works, and the three faults that stopped it are fixed.** It
  could not build on `master` when this packet started; the CHANGELOG recorded
  why, and this is what changed. The `deps` stage no longer inherits
  `NODE_ENV=production` into a production-only install (`npm ci --include=dev`,
  which is what puts `@tailwindcss/postcss` and `typescript` back); `.npmrc` is
  copied into the build context, so `engine-strict=true` is enforced there and
  not only on the host; the base is `node:22.22.2-slim`, the pin
  `package.json` declares, rather than `node:22-slim` which resolved to
  22.23.3 and would have shipped a different runtime than the suite verifies
  on; and the runner no longer copies a `/app/public` this repository does not
  have. Verified by `bin/e2e`, which builds the image and runs a browser
  against it. The three were found by the previous packet and left deliberately
  — it was scoped to CI and the image is a deployment surface — and the
  end-to-end packet could not exist without them.
- `mise.toml` — no version changed. A comment now says it mirrors
  `package.json` and that the gate fails when the two disagree.
- `README.md` and `AGENTS.md` — the pin is described as living in
  `package.json` with three mirrors rather than as living in `mise.toml`, and
  both gained a CI section. The old AGENTS.md line said "Node is pinned in
  `mise.toml` … do not add a second pin", which was true when written and
  wrong the moment the pin had to be readable by npm and by CI.

- `src/lib/roles.ts` — the role vocabulary and the capability matrix, transcribed
  from identity's tenancy authorization: the order and the three names from
  `AllRoles` and `Role.AtLeast`, the matrix from `registerTenancyRoutes`, and the
  rule that splits inviting a member (admin) from handing out admin (owner) from
  `Service.InviteRole`. Plus a mirror of the service's `Slugify` and
  `ValidateName`, so a name that cannot make a handle is refused before a round
  trip. The service is the authority; this is a copy, and a reason not to offer a
  button rather than a reason to believe it would work.
- The tenancy surface on `src/lib/identity.ts` — the ten account routes:
  `POST`/`GET /v1/accounts`, `GET`/`PATCH`/`DELETE /v1/accounts/{id}`,
  `GET /v1/accounts/{id}/members`, `POST /v1/accounts/{id}/invitations`,
  `POST /v1/invitations/accept`, and
  `PATCH`/`DELETE /v1/accounts/{id}/members/{userId}`. Shapes are transcribed
  from the service's handler, not from its OpenAPI document — see "Known gaps".
- `src/lib/accounts.ts` — React Query bindings for the tenancy surface. The token
  is part of every query key, and the overlapping invalidation sets live in one
  place. `retry: false` throughout: the screens each render an explicit retry,
  and a 401/403/404/409/410/422 is the service's answer rather than a hiccup.
- `/accounts` — the accounts you belong to, and the create form. The one
  conflict `POST /v1/accounts` declares (the derived handle is taken) is placed
  on the name field, because the handle is derived from the name.
- `/accounts/[accountId]` — facts, the member panel, rename, invite, leave and
  delete. A control is offered only when the service's role table permits it: an
  admin is offered neither a rename-forbidden nor an "invite another admin"
  option, and an owner is offered neither "leave" nor a usable "remove" on
  themselves, because the service will refuse both.
- `/invitations/[token]` — redeeming an invitation, with the three answers the
  service separates kept apart: 404 unrecognised, 410 no longer usable, 409
  already a member. It does not accept on load, because the token travels in the
  URL and an email preview or a link scanner would otherwise join somebody to a
  workspace they never opened. `robots: noindex, nofollow`, since a one-time
  token in a URL is a credential.
- `src/lib/money.ts` — integer minor units in, a price out. The currency's
  exponent is read from the platform's own data through `Intl`, so 1900 minor
  units is $19.00 in USD, ¥1,900 in JPY and 12.345 KWD is not 123.45. It is the
  only division in the codebase and the last one before a number reaches a person.
- `src/lib/billing.ts` — a typed client for the five billing endpoints the
  contract declares, with its own `BillingError` because billing is a separate
  service. `POST /v1/customers` sends an `Idempotency-Key`, which the contract
  asks the client to choose. Cursors are passed back verbatim and never parsed.
- `/billing/plans` — the plan catalogue, with real cursor paging that
  accumulates. It offers nothing to buy, and says in its framing sentence that
  billing does not record a current plan, because there is no
  `/v1/subscriptions` on master.
- `/billing/customers` — billing's customer records, labelled as the whole
  platform's list, because the service scopes this collection by nothing.
- `src/components/ui/state.tsx` — `LoadingState`, `ErrorState`, `EmptyState`,
  `Panel`, `RoleBadge` and `DescriptionList`. `Panel` takes a required
  `headingId`, because a region with no accessible name is a dead end in the
  landmarks list.
- `src/components/ui/select.tsx` — a native `<select>`, so the role picker gets
  keyboard behaviour and the right thing on a phone without a hand-rolled
  listbox. `Field` accepts it, so no call site hand-wires `aria-describedby`.
- Header navigation. The plan catalogue is offered to a signed-out visitor
  because it is the one screen that needs no account; the accounts list is not,
  because it would be a dead end.

### Known gaps

These are gaps in the *services*, found while building against them. Each one is
recorded so it is not rediscovered from a UI symptom.

- **A social sign-in cannot be FINISHED on any surface of this app, because
  `POST /v1/session/mfa` is absent from the forwarder's table.** The callback can
  answer 202 with `{mfa_required, challenge, expires_at}` — identity's own
  `writeChallenge`, the same writer a password login's challenge uses — and the
  route that redeems it is deliberately refused by the allow-list, with a test
  ("does not narrow the allow-list") holding it there. So a provider account with
  a confirmed second factor reaches `src/components/social/social-callback-screen.tsx`,
  which says the sign-in is not finished, signs nobody in, and offers the sign-in
  screen. That is a DEAD END with a way out, which is the honest minimum, and it
  is not this packet's decision to fix: widening the table is a capability
  decision (`src/lib/upstream.ts` says so where the social routes arrived beside
  it) and needs the manager.

  **The same dead end exists on the PASSWORD path, and it is worse there.** This
  is the finding this packet turned up while following the brief's "reuse the
  existing MFA path" instruction — there is no existing MFA path. `identity.login`
  is `send(transport, "/v1/session", "POST")`, and `send` reads a 202 as `ok` and
  returns its body typed as `Session`. A challenge body therefore arrives at
  `store.set(result.token)` with `token` UNDEFINED: `localStorage` gets
  `{"token":undefined}`, `get()` reads it back as `null`, and the person is
  signed out having been told nothing. **Reported, not fixed** — it is a
  `src/lib/identity.ts` contract question with its own test surface, and a
  security-relevant one that belongs in its own packet rather than smuggled in
  behind a UI change. `HANDOFF-parlor-02-social-ui.md` names it.
- **A browser cannot call `identity` from this app: `identity` serves no CORS
  headers.** Measured on a running stack, and it is the first thing this
  repository's end-to-end tier found. The client bundle does the fetching
  (`src/lib/identity.ts`, base URL from `NEXT_PUBLIC_IDENTITY_URL`), so the
  caller is the user's browser on the app's origin; `identity/internal/` sets no
  `Access-Control-Allow-*` anywhere, and `OPTIONS /v1/session` answers `405`
  because the route implements `POST` and a preflight is not that. The preflight
  fails, the response is unreadable, and the sign-in form renders "Something
  went wrong. Try again." — on a stack that came up completely green and whose
  `/readyz` said `ok` on every service.

  377 unit tests could not see it, and the reason was structural: every one of
  them injects a stub transport and never opens a socket, so the browser's
  same-origin policy was never in the path.

  **RESOLVED by the BFF packet, in this repository, on the second of the two
  options.** `src/app/v1/[...path]/route.ts` answers `/v1/*` on this app's own
  origin and forwards to identity from the server, so the browser is same-origin
  and no CORS header is needed anywhere. `identity` was not touched: no
  `Access-Control-*` header was added, and the argument for refusing that
  shortcut is in `src/lib/upstream.ts` — it would have let every origin on the
  internet call identity with a bearer token it stole from anywhere else,
  solving a deployment-topology problem by weakening the one service that does
  not have the problem. The end-to-end harness's `location /v1/` block in
  `e2e/edge.conf` was DELETED rather than left in place, because nginx
  answering `/v1/*` itself would have kept the stack green while the BFF was
  never exercised.

  **What is left, and it is narrower than the entry above made it sound.** Two
  things, neither a CORS policy:

  - **`__Host-session` needs an HTTPS origin, and the symptom is silence.** The
    cookie is `Secure`, so a browser stores it only over HTTPS. kamal-proxy
    terminates TLS with `ssl: true` and the app origin is HTTPS, so production
    holds. A plain-HTTP deployment loses the cookie with no error anywhere, and
    the only symptom is a session that does not survive a reload.
  - **The session token is still in `localStorage`.** The cookie is live — the
    transport is `credentials: "same-origin"` and the header travels both ways —
    but the client keeps sending the bearer token too, and `presentedToken`
    prefers the header, so the `HttpOnly` half does not yet protect anyone.
    Retiring the token is `guard`'s work.

- **What it will take to delete the hand-written tenancy client** (recorded here
  because the packet was told not to replace it). `src/lib/identity.ts`
  transcribes ten tenancy operations from identity's Go handlers because the
  generated SDK cannot do them. Three things, in order:

  1. **identity publishes the tenancy surface in its OpenAPI document.** The
     handler is the wire today (`identity/openapi/v1.yaml` describes none of the
     ten routes), and a document has to exist before a generator can read it.
     identity-28 is doing this.
  2. **A generated client has to cover the whole surface, not most of it.** The
     transcription exists because the SDK covers four session routes and not the
     accounts, invitations, members or recovery surface. A partial migration
     leaves two clients and two error types, which is worse than one.
  3. **The error envelope has to be settled.** `src/lib/identity.ts` reads both
     RFC 9457 problem+json and the identity-02 `{error:{…}}` shape and produces
     one `IdentityError` from either. A generated client will pick one, and if
     the service still disagrees, the `IdentityError` every screen catches is
     the thing that has to be re-pointed. **DECISION NEEDED: which envelope is
     the contract.**

  None of that is this repository's to do, and doing it here would conflict with
  identity-28 in flight.

- **A deploy of `config/deploy.yml` cannot complete a sign-in** — **RESOLVED**,
  and it is the entry above seen from the deployment side. The deploy packet had
  added a fact the harness could not: **kamal-proxy routes by hostname, not by
  path**, so a single `proxy.hosts` entry cannot send `/v1/*` to identity and
  everything else to parlor. That is why the fix could not be a proxy setting
  and had to be a route handler in the product. It is now one, the deploy config
  carries the two addresses as run-time env vars, and the same image serves every
  environment.

- **No CI job builds or pushes the image, so `kamal deploy` builds on the host.**
  Measured by reading `.github/workflows/ci.yml`: three jobs — kit's `node` job,
  `./bin/prime`, and typecheck + `next build` — and none runs `docker build`,
  `docker push` or `kamal build`. The only place this image is built is
  `e2e/docker-compose.yml`, which tags it `cafaye/e2e-parlor:local` and pushes
  it nowhere. The consequence is that kit's `builder` block, whose stated reason
  for existing is that building on the host competes with the running service
  for memory, is currently the wrong shape for this repository: on a fresh host
  `kamal deploy` will run the build there. The registry cache below it still
  helps. **DECISION NEEDED.** The fix is a CI job that authenticates to `ghcr.io`
  with a credential nobody in this repository holds, and it is deliberately not
  written here: a publish job against a secret that cannot be verified from this
  tree would make every badge in CI conditional on something outside it.

- **`/readyz` checks nothing, so the rollout gate is currently a liveness gate
  wearing a readiness label.** `src/app/readyz/route.ts` answers `deps: "none"`,
  which is honest — parlor's server-side dependencies are its own disk and the
  Node runtime, and identity and billing are called from the *browser*, not from
  this process, so there is nothing for it to sweep. `AGENTS.md` already records
  that a real dependency check is its own packet, on the grounds that a slow
  identity must not necessarily mean "not ready", and that is a decision rather
  than a default. What this packet does is make the consequence explicit: the
  path is right and the meaning is not there yet, so a deploy of parlor today
  proves that a container boots and not that it can reach anything.

  **RESOLVED by the launch-honesty packet** (`worker/parlor-w66-launchhonest`,
  B2). The BFF changed the premise — identity and billing are reached
  server-side through the forwarder now, so there IS something to sweep — and
  the sweep is wired: identity's own `/readyz` with a short timeout, billing
  only when configured, `deps` an array of results, and any failure a 503.

- **`identity/openapi/v1.yaml` does not describe the tenancy surface.** The
  document was last changed before the packet that added the implementation was
  merged, so `POST /v1/accounts` and its nine siblings exist in the service, in
  its routes and in its authorization tests, and not in the published contract.
  The client is written against the handler, which is the stricter authority, but
  it is the client half of a contract nobody has written down. A draft document
  exists on the `worker/identity-04-contract` branch; merging it is the fix.
- **A member list carries no member identity.** `membershipResponses` builds each
  row as `{Role: m.Role}` and `MemberSummary` carries no user id to copy, so
  `GET /v1/accounts/{id}/members` returns rows with an empty `user_id` and a
  zero `created_at` — and the per-member routes have nothing to address. The
  member panel says so and shows the role distribution, and the per-member
  controls render the moment an id is present.
- **billing declares no authentication.** `security: []`, no `securitySchemes`,
  and the service's own header records it as a gap: `GET /v1/customers` "returns
  every customer, because there is no account to scope it by". `/billing/customers`
  is therefore labelled as a platform-wide list rather than a personal one, and
  no identity session token is sent to billing.
- **No subscription surface exists.** billing's master contract has no
  `/v1/subscriptions*` and `Customer` has no plan field, so "you are on X",
  upgrade, downgrade, cancel and the five subscription states cannot be built.
  This is `parlor-04`, once billing-04's contract is merged.
- **No `GET /v1/invitations/{token}`.** An invitation cannot be read before it is
  redeemed, so the accept page cannot show which account the invitation is for,
  who sent it or what role it grants. It says so rather than implying it knows.
- **410 conflates two states.** The service maps both an expired invitation and
  an already-accepted one to 410 with the code `gone`, separated only by prose in
  `detail`. The accept page renders one state for both, which is all the status
  supports.
- **`POST /v1/email-verifications` answers 409 for an address that is already
  verified, which makes it the one request route in the service that is not a
  constant.** Measured on a running identity while building the verification
  surface: an address with an account and an address without one both answer
  `202 {"status":"accepted"}` with identical bytes, and an address that has
  already been proved answers `409 conflict`. `Service.RequestVerification` orders
  it after the account lookup (`user.IsVerified()`) and before the cooldown, so
  409-against-202 tells a prober that an address has an account **and** is proved.
  This is deliberate on the service's side — identity declares the 409 in order to
  stop a client telling somebody to watch an inbox nothing will arrive in — so
  `/verify-email` renders it truthfully rather than flattening it into the
  acceptance sentence, and guarantees instead never to widen it: the sentence names
  the state, never the address and never the service's `detail`. **DECISION NEEDED:
  whether the constant-202 defence that `requestPasswordReset` gets should extend
  here, or whether the 409 is the intended trade.**
- **`identity/openapi/v1.yaml` declares a 422 on `POST
  /v1/email-verifications/confirm` that the handler never produces.** The
  document fixes `RecoveryTokenRequest.token` at `minLength: 43, maxLength: 43`
  and lists a 422 response; measured on a running identity, `{"token":"too-short"}`
  answers `404 not_found`, because `RedeemVerification` goes straight to
  `tokens.Live(sessions.Digest(in.Token))` and `tokenRequest` is one `string` with
  no validation on it. A truncated link is therefore one of the four cases behind
  the single `ErrTokenNotFound` sentinel, and `/verify-email/confirm` gives it the
  same sentence as a spent one. The client follows the handler over the document,
  as it does for the tenancy surface.
- **`RECOVERY_LINK_TEMPLATE` is ONE template for every recovery link, and there
  are now two kinds of link to land.** Measured: `internal/courier`'s
  `RecoveryMailer` holds a single `linkTemplate` field and renders it for both the
  `password_reset` and the `verify_email` message, so a reset link and a
  verification link resolve to the *same configured URL* with different tokens —
  and identity's mail body is courier's `welcome` template, which says nothing
  about which flow the link belongs to. A deployment serving both flows therefore
  cannot route both correctly with the configuration as it stands: point it at
  `/reset-password` and every verification link lands on a screen that answers
  "cannot be used"; point it at `/verify-email/confirm` and every reset link does
  the same. **DECISION NEEDED on the service side: per-kind link templates, or a
  landing screen that can redeem either kind.** The fix belongs in `identity`
  (`RecoveryMailer` and `LinkTemplate`) and this repository may not edit a
  sibling; the two landing screens are built and each offers the right way
  forward for its own flow, so the day one template can be per-kind both work.

### Changed

- `/register` — the confirmation now carries the whole sentence the two-call
  sequence produces. "Account created for {email}." leads it in every branch,
  including the two where the verification request behind it failed, because the
  end-to-end tier asserts that address to prove `POST /v1/users` reached a real
  service and a real database, and dropping it from the failure branches would have
  silently deleted that proof from the only place a failure is exercised. The
  sign-in link's name grew to "Sign in to your new account": the page's heading
  already carries an "Already have one? Sign in" link, and two links with the same
  name and the same destination on one screen is an ambiguous name for a screen
  reader and a coin flip for everyone else. A "Did not arrive? Send it again" link
  is the resend action, pointing at `/verify-email` rather than re-posting — the
  one-minute cooldown is the service's to answer.
- `src/lib/identity.ts` — a typed client for the four identity endpoints fixed by
  contract: `POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`,
  `GET /v1/me`. Base URL from `NEXT_PUBLIC_IDENTITY_URL`, defaulting to
  `http://localhost:8080`. The transport is a parameter, so tests inject a
  stub and the browser gets `fetch`; there is no msw and no request
  interception. Failures arrive as an `IdentityError` carrying the status, the
  reserved `code`, the `trace_id`, and the per-field `{field, code}` list from a
  422 — read from RFC 9457 problem+json, or from the `{error:{…}}` envelope the
  identity-02 brief describes, since the two disagree and neither has shipped.
- `src/lib/token-store.ts` — the session token in `localStorage` under
  `parlor.session.token`, with a subscribe hook for React. A value that does not
  parse reads as signed out rather than throwing.
- `src/lib/auth.tsx` — session state. The token is the React Query cache key
  (`["session", token]`), so a cached user can never be served to a different
  session than the one it was fetched for. A 401 forgets the token; a failure
  that is not a 401 leaves it and reads as signed out.
- `src/app/providers.tsx` — the provider stack (React Query, then auth),
  mounted once from `layout.tsx`. Both the identity client and the token store
  are injectable.
- `/register` — email and password, local validation before the request, and a
  422 placed on the field it belongs to. A 409 says the address is taken, which
  is the one place the answer is safe to give. On success the account is
  confirmed and the password leaves the screen; nothing signs anyone in, because
  `POST /v1/users` returns no token.
- `/login` — the same two fields, and one generic sentence for every refused
  sign in. A wrong password and an unknown address produce byte-identical
  output, and neither is reported on a field, so the screen cannot be used to
  find out who has an account. A service failure does not borrow that sentence:
  it says something went wrong rather than sending someone to reset a password
  that was fine.
- `src/components/shell/header.tsx` — the session-aware shell. Signed in: the
  address and a sign out control. Signed out: sign in and create account. While
  a stored token is being exchanged it renders neither, so a reload does not
  paint a sign-in link over a live session (verified against the prerendered
  HTML, which contains neither state).
- `src/components/ui/{button,input,field}.tsx` — hand-rolled primitives in
  shadcn's shape, one per file, exported from the existing barrel. `Field` owns
  the label/description/invalid wiring so a call site cannot get it half right.
  Every colour is a token from `src/styles/tokens.css`.
- `@tanstack/react-query` as a runtime dependency (the only one this packet
  adds).

### Changed

- `layout.tsx` mounts `Providers` and the shell header above the route content.
- `src/test/setup.ts` clears `localStorage` after every test. The token is read
  synchronously on render, and one test's session leaking into the next would
  make an auth suite pass for the wrong reason.

### Notes for the next packet

- The session token lives in `localStorage` because the cookie identity sets is
  `HttpOnly` and unreachable from the browser bundle. A BFF route in front of
  identity reverses this and makes the cookie the only authority. See README,
  "Sessions".
- No CORS headers, no cookie proxying, no CSRF token: the browser talks to
  identity directly, and that is a later packet.
