# AGENTS.md — working rules for this repo

Orientation for agents and humans changing `parlor`. The operating contract
lives in `moon/PLAN.md` (§1 manager-worker, §3 test doctrine); this file is the
parlor-specific part.

## What this repo is

The cafaye web app: file-based routes under `src/routes/` (TanStack Start),
the screens and handler modules they render under `src/app/`, Tailwind v4, theme
tokens, health surfaces, test rig — and the screens built against identity's and
billing's real contracts.
Auth (`/register`, `/login`, a session-aware header), accounts and invitations
(`/accounts`, `/accounts/[accountId]`, `/invitations/[token]`), and the two
billing surfaces the contract actually declares (`/billing/plans`,
`/billing/customers`), built on the design system in `docs/design-system.md`.
If you are looking for a dashboard, settings, admin or a subscription screen,
you are looking at a later packet — see CHANGELOG "Known gaps" for the five
service-side gaps this build works around.

There is no Next.js here. `grep -rn "from 'next" src/ e2e/` is empty,
`package.json` has no `next` dependency, and `dev`/`build` are `vite dev` and
`vite build`. There is no `start` script and there is no `server/` directory:
this app deploys to Cloudflare Workers, Cloudflare supplies the server, and the
hand-rolled Node-to-Web adapter that used to bind the built fetch handler to a
socket is deleted. Text below that explains a Next-era decision as *history* is
doing so on purpose; text that tells you how to add a screen describes
`src/routes/` and `src/app/`.

## Setup

```sh
./bin/prime      # npm ci + npm test + typecheck + build + the CI shape checks
mise install      # node version from mise.toml
```

- **`npm run lint` needs `cafaye/kit` checked out BESIDE this repository**, and
  that is not this repository's quirk — it is how kit's shared lint configs are
  delivered, and `e2e/docker-compose.yml` bind-mounts `../kit` for the same
  reason. `./bin/lint` will find it at `../kit` and say so if it cannot. It is
  NOT in `bin/prime`, because a fresh clone does not have it; see "The lint
  standard".

- **The runtime pin of record is `engines.node` in `package.json`** (22.22.2 —
  the floor jsdom@30 demands; bump the pin rather than downgrading the test
  rig). `packageManager` records the npm that ships with it, and `.npmrc`'s
  `engine-strict=true` is what makes `npm ci` fail on a Node that does not
  match instead of warning. `mise.toml` and `.github/workflows/ci.yml` mirror
  the number; `tests/validate-ci.sh` fails when the mirrors drift, and
  `bin/prime` runs it. Do not add an `.nvmrc` or a fifth place to write it.
- Install with `npm ci`, never `npm install` — the lockfile is the contract,
  and `npm install` in a CI path resolves a disagreement that `npm ci` should
  have reported. `tests/validate-ci.sh` fails if either appears in one.
- Wrap long/networked commands in `timeout N` (`timeout 600 npm ci`).
- `npm run typecheck` must pass **without** a build: `rm -rf dist` and check.
  The only generated types in the tree are `src/routeTree.gen.ts`, which is
  **committed** rather than produced by a build (see `.gitignore`'s "the route
  tree is the deliberate exception"), so a fresh clone typechecks against the
  same router the build does. The CI `build` job deletes `dist` before
  typechecking, so it cannot pass on anything a build produced.

## The end-to-end tier

`bin/prime` is the per-commit gate and has no stack in it. The whole-fleet tier
is `./bin/e2e`, and it is not optional decoration — it is how a change to this
app is proved against the services it actually talks to. Read `e2e/edge.conf`
before changing the topology; the file states the measured reason the stack has
a reverse proxy in it, which is not a stylistic choice.

```
e2e/docker-compose.yml   the stack: identity + gateway + oauth-stub PULLED BY
                         TAG from ${E2E_REGISTRY:-localhost:16010} (a registry:2
                         in the same file), one Postgres, one Redis, one edge
                         proxy, TWO instances of the fake provider (one per
                         client pair), and parlor itself built from this tree
                         (`context: .`).
                         E2E_BUILD_SIBLINGS=1 layers
                         e2e/docker-compose.siblings.yml to put the sibling
                         `build:` stanzas back. The Postgres is provisioned by
                         kit's script, MOUNTED from ../kit — see below
e2e/edge.conf            the same-origin edge. WHY IT EXISTS is in the file
bin/e2e-stack            build / publish-siblings / up / wait / down /
                         verify-sibling-images — the lifecycle, the named-ref
                         publish, the bounded readiness poll, and the logs on a
                         failed bring-up
bin/e2e                  the tier: stack up, browser installed, suite run, the
                         report checked, stack down
playwright.config.ts     trace OFF, video OFF, retries 0, one worker
e2e/*.e2e.spec.ts        the specs. All assertions are on rendered text
e2e/no-token-artifacts.ts global teardown: no artifact holds a session token,
                         the tier ran, nothing was skipped
```

- **The rules this tier holds, and how each is enforced.** No sleep: every wait
  is Playwright's own auto-waiting assertion, and `bin/e2e-stack` polls
  `/readyz` with a budget. No retries: `retries: 0`, and a check fails the build
  if it is raised. No skip: there is no `test.skip` anywhere, and a check greps
  for one. No secret in an artifact: `trace` and `video` are off, a check fails
  the build if either is not, and the teardown scans every produced file —
  archive members included — for a token the run actually minted, and deletes
  what it finds.
- **Never add a `trace` to debug a failure.** Read the assertion and the
  `error-context.md` Playwright writes next to the screenshot; both are in the
  output directory. If they are not enough, the answer is a better message, not
  a network log.
- **A screenshot of a failure is safe and a trace is not**, because the session
  token is in `localStorage` and is never rendered. Keep it that way: a new
  `page.screenshot` of a screen holding a credential is a new leak, and the
  teardown only knows about tokens it has been told.
- **Ports are `16xxx`** and `tests/validate-ci.sh` checks every published port
  is inside the block, collides with nothing the workspace owns, and matches
  the fallbacks in `playwright.config.ts`. `bin/e2e` reads the real numbers out
  of the compose file rather than restating them.
- **`../kit` is a REQUIRED CHECKOUT, and it is a different kind of requirement
  from `../identity` and `../gateway`.** Nothing is built from it, nothing is
  pushed from it, and it is NOT in `SIBLING_SERVICES` — adding it there would
  send `publish_siblings` looking for a build recipe and kill the default path.
  It is required because `e2e/docker-compose.yml` MOUNTS
  `../kit/templates/compose/postgres/initdb` over `/docker-entrypoint-initdb.d`,
  and that script is the only thing in the fleet that creates the two roles per
  service: `identity` (owner) and `identity_app` (a LOGIN that owns nothing).

  **The consequence of not having it is a silent healthy cluster**, and that is
  the sentence worth keeping. Docker mounts a missing bind source as an EMPTY
  DIRECTORY rather than failing, so initdb runs no script, the cluster comes up
  with the superuser the image created and nothing else, and `pg_isready` says it
  is fine. Sixty seconds later identity's `migrations/00016_account_isolation.sql`
  dies at `select cafaye.protect_table('account_users')` with

  ```
  ERROR:  cafaye.protect_table(account_users, identity_app):
          identity_app is not a LOGIN role on this cluster. (SQLSTATE 42704)
  ```

  which names a missing ROLE rather than a missing CHECKOUT. So TWO assertions
  guard it and the duplication is deliberate: the e2e job's presence step checks
  the directory is non-empty, and `bin/e2e-stack`'s `check_cluster_initdb` reads
  the mount **out of the compose document** and checks the same thing before
  anything starts. Reading it out of the document is what stops the two from
  drifting into disagreeing about where the script lives. The measurement, and
  why the failure took this shape, is in
  `HANDOFF-parlor-e2e-protect-table-01.md`.
- **`POSTGRES_USER` is `postgres` and it cannot be `identity`.** The official
  image creates `POSTGRES_USER` as a superuser BEFORE initdb runs, and kit's
  script then does `CREATE ROLE <name>` per `KIT_POSTGRES_DATABASES`; with
  `POSTGRES_USER: identity` the cluster refuses to start with `role "identity"
  already exists` at initdb. `postgres` is the one name that is not in that list.
  **This also changed what `identity` IS:** it was a superuser, and kit's script
  creates it `NOSUPERUSER NOCREATEDB NOCREATEROLE`. A superuser bypasses
  row-level security, so the previous shape had the policies and **no
  enforcement** — the same defect as having no policies, and harder to notice
  because the catalog reads as correct. Because that password is the cluster's
  `POSTGRES_PASSWORD`, identity's `DATABASE_URL` and `bin/e2e-stack`'s migrate
  DSN both carry it; kit hands every role it creates the same one, which is its
  stated position that isolation here is by privilege and never by secret.
- **The known gap, stated rather than left to be discovered:** identity's
  `DATABASE_URL` names the **owner** role rather than `identity_app`, so the
  process serving the browser holds the one privilege the substrate exists to
  remove — it could `ALTER TABLE … DISABLE ROW LEVEL SECURITY`. What `FORCE` still
  buys is real and is measured in the handoff. The residual gap needs a change in
  **identity's** repository, which this one may not edit.
- **A service in the stack with no `healthcheck:` must have a `FINDING` in its
  own block**, and the gate checks for both. identity is the one: a distroless
  image has no HTTP client, so nothing inside it can answer a probe, and the
  harness polls from outside instead.

## CI

`.github/workflows/ci.yml` — `ci` (kit's shared `node` job), `prime`
(`./bin/prime` plus the `git diff --exit-code -- package-lock.json` guard) and
`build` (`rm -rf dist && npm run typecheck`, then `npm run build`, then an
assertion that the Cloudflare Worker output exists — `dist/server/index.mjs`,
the plugin's own `dist/server/wrangler.json` and `dist/client/assets`, with a
`.woff2` under `dist/client` — then `npm run build:node` and the same assertion
for the Node target, against `.output/server/index.mjs` and `.output/public`).

`.github/workflows/e2e.yml` — the whole-stack tier, its own workflow and its own
required job. It checks out `../identity`, `../gateway` and `../oauth-stub`
beside this repository — **every checkout names a `repository:`**, and that is
not boilerplate: `actions/checkout` with only `path:` checks out
`${{ github.repository }}` into the directory `path:` names, so for this job's
whole life `../identity` held a copy of *parlor* and the sibling assertion below
was satisfied by this repository's own Dockerfile. The job had never checked out
a sibling, and a renamed path is not a checkout of a renamed repository.
**There are FIVE checkouts and the fifth is `../kit`, which is not a sibling**:
no image is built from it, nothing is pushed from it, it is not in
`SIBLING_SERVICES` (adding it there would send `publish_siblings` looking for a
build recipe and kill the default path), and it is required purely by the initdb
bind mount described above. The presence step asserts it separately from the
sibling loop, and by DIRECTORY rather than by Dockerfile, because a Dockerfile is
what a build reads and this is what a mount reads — `find … -print -quit` rather
than `[ -f 10-cluster.sh ]`, so a kit that renames or splits its script is
picked up rather than going red on a rename while the mount keeps working.
**The mechanism is `bin/e2e-stack publish-siblings`, not a compose build
stanza**: `e2e/docker-compose.yml` carries `image:` and no `build:` for any
sibling, so the checkouts are load-bearing because of *where the tags come
from* — the stack's registry is a `registry:2` container the run starts itself
with no volume, so on a fresh runner it holds nothing, and
`ensure_sibling_artifacts` can only fill it by building each sibling from a
named ref of its checkout. The `oauth-stub` checkout is at the pinned tag and
carries `fetch-depth: 0`, because a shallow single-branch clone has no tags and
`publish-siblings` resolves the pin with `git rev-parse <tag>^{commit}`; the pin
itself lives in `bin/e2e-stack`, not in the workflow. The same checkouts supply
`../identity/migrations`, which `migrate()` reads from the host. The assertion
step sets `working-directory: parlor` (it was the only `run:` step that did not,
so `../identity` resolved *beside* the workspace, where a `path:` checkout puts
nothing) and reads `SIBLING_SERVICES` out of `bin/e2e-stack` rather than
restating it, failing loudly on an empty extraction.
`E2E_BUILD_SIBLINGS=1` is the developer's hatch that puts the `build:` stanzas
back, and this job does not set it.

- **`SIBLING_SERVICES=(identity gateway oauth-stub)` is THREE entries and that is
  decided, not inherited.** The list is not a wish list: it is what four loops in
  `bin/e2e-stack` iterate — `preflight`'s Dockerfile check, `publish_siblings`'
  build and push, and `ensure_sibling_artifacts`' probe, pull and checkout test.
  `pantry` appears nowhere in this tree, and adding it is not a widening but a
  red build: `publish_siblings`' `case` has recipes for identity, gateway and
  oauth-stub and a `*)` arm that dies with "no build recipe for sibling pantry",
  on the default path, in CI. (`cafaye/site`'s list has four entries and that is
  right for `site`.) Adding a service to this tier is four edits in one commit — a
  `publish_siblings` recipe, a `build:` context in
  `e2e/docker-compose.siblings.yml`, the entry in `SIBLING_SERVICES`, and a
  `repository:` checkout in `.github/workflows/e2e.yml` — and never the last one
  alone.

- **`oauth-stub` is PINNED to `v0.1.0` and `identity`/`gateway` are not, and
  that asymmetry is the whole design.** A test double is a dependency of this
  tier's *assertions* rather than of the product: if `oauth-stub`'s `/github/user`
  starts answering an address inline, the GitHub test in `social.e2e.spec.ts`
  stops exercising the `/user/emails` fallback and still passes, so a double that
  moves under the harness changes what a green run means without changing a line
  of this repository. `identity` and `gateway` are the product under test,
  released continuously; a pin would mean a security fix in either could not reach
  the tier until somebody edited `bin/e2e-stack`. A pin is right for a fixture and
  wrong for a service. The pin lives in `sibling_default_ref` (a `case`, because
  macOS ships bash 3.2 and `declare -A` is 4.0 — a second parallel array indexed
  against `SIBLING_SERVICES` is a thing where a sibling added at the front
  silently takes the first sibling's pin), and `E2E_SIBLING_REF_OAUTH_STUB` still
  overrides it for a developer testing an unmerged double.

- **`publish_siblings` builds from a NAMED REF, not from the checkout directory,
  and `verify-sibling-images` is how you find out.** This is `cafaye/site`'s
  measured defect, not a preference: a stack built from a sibling checkout parked
  on another agent's unmerged branch came up green with every readiness probe
  passing, and the one request the tier exists to prove answered 401. The build
  context is `git archive <sha> | tar -x` into a temp directory (not
  `git worktree add`, which would leave a trace in another session's repository),
  and the image carries `cafaye.e2e.source`/`.revision`/`.dirty` — not
  `org.opencontainers.*`, which on gateway's image belongs to bun and satisfies
  `--verify` with a confident false answer. `ensure_sibling_artifacts`' fast path
  runs the check too: "published and cached" is not "right".

- **`oauth-stub` runs TWICE, one instance per provider, and the reason is the
  stub's own configuration.** `OAUTH_STUB_CLIENT_ID` is "the only `client_id` this
  server accepts" and identity holds two providers under two different ids, as two
  real providers would be, so one instance cannot serve both — whichever id it was
  not given gets `invalid_client` on every authorization and the browser stalls
  with an error naming the variable. The two escapes are both unavailable here:
  pointing identity at the stub's defaults makes the fixture agree with itself
  about a credential nothing independently holds, and loosening the check is a
  change to a sibling this repository may not make. So there are two compose
  services (`oauth-stub` on 16004, `oauth-stub-github` on 16005), both in
  `READY_SERVICES` because one entry for two services is a silent gap in an array
  keyed on service name. Neither has a `healthcheck:` — distroless, no HTTP client
  — so both say `FINDING` in their own block, which `tests/validate-ci.sh`
  requires per block rather than by reference.

- **The endpoint overrides are in TWO DIALECTS and that is not redundant.** The
  AUTHORIZE url is browser-context (`127.0.0.1` and a published port, because a
  browser cannot resolve a compose service name); the TOKEN and USERINFO urls are
  identity-context (service name, because a deploy reaches a sibling by name). The
  token paths are asymmetric on purpose: `/google/token` and
  `/github/access_token`, each provider's real last segment per `oauth-stub`'s
  `routes()`. `OAUTH_REDIRECT_BASE_URL` is derived from the EDGE's port, because
  the browser is on the edge and the `__Host-oauth-state` cookie is scoped to the
  origin the 302 arrived on.

- **The gate is `bin/prime`, and CI runs that script, not a list of `npm run`
  commands.** If the two can disagree, one of them is lying. Adding a check
  means adding it to `bin/prime`, not to the workflow.
- **`tests/validate-ci.sh` is part of the gate, not a CI extra.** It checks the
  shape of the tree CI assumes — the pin, the lockfile contract, the gate
  command, that every `npm run` the workflow calls still exists, and now the
  end-to-end tier's own shape. Its `--self-test` breaks a throwaway copy 52
  ways and asserts each one goes red; a check that has only ever been green has
  verified nothing.
- **Do not write `grep -q` into that script inside a pipeline.** Under
  `set -o pipefail`, `grep -q` exits on its first match and the writer takes
  SIGPIPE, so the pipeline reports 141 and a check that *found* the thing reads
  as "not found". Capture the match into a variable instead; `found()` and
  `found_fixed()` exist for that. Two more gotchas in the same family are
  recorded where they were found: BSD grep does not know `\s`, and an ERE
  `[A-Z_]` does not match a variable name with a digit in it.
- **A new environment-gated test tier must be forced in CI, and the report must
  say how it was counted.** A gate that prints `0 passed; 14 ignored` has
  verified nothing. The end-to-end tier is the same rule with one fewer moving
  part: it has no skip mechanism at all, and two readers of its report fail the
  run when fewer than two tests passed.

## The lint standard

The gate is `ci (kit, node) / node`, and its lint step is kit's, not this
repository's:

```
npx --no-install eslint --config "$KIT_LINT_DIR/lint/eslint.config.mjs" .
```

with `KIT_LINT_DIR` = `<working-dir>/.kit` and kit's `lint/` directory checked out
**inside the tree** by the same job. Inside is the only thing that works: kit's
config does `import js from '@eslint/js'`, and node resolves that from the config
file's own directory upward, so a copy *beside* the repository resolves nothing
and dies with `ERR_MODULE_NOT_FOUND`.

- **`npm run lint` is that same invocation.** It is `./bin/lint`, which is the
  command above with the config checkout done by hand — it populates `.kit/lint`
  from a kit checkout beside the repository if it is not already there, and says
  so which one it used. `.kit/` is gitignored: kit's own config ignores
  `.kit/**`, and kit says the config is not copied into a service repo, so a
  committed copy would be both a copy nobody reviewed and a copy the linter never
  reads.
- **There is no `eslint.config.mjs` here any more, and that is the point.** This
  tree used to carry one (`recommended`, not `recommendedTypeChecked`,
  `no-explicit-any` demoted to a warning) because `eslint-config-next` had gone
  with the framework that named it. It was a *second, looser* standard that
  `npm run lint` read and CI never did — and a developer who ran the documented
  command got a green they had not earned. One lint command, the fleet's, and it
  cannot drift from the gate. (`HANDOFF-parlor-eslint-335-01.md` is the packet
  that removed it, with the measurements.)
- **`kit/lint/eslint.config.mjs` is not this repository's to edit.** Overriding a
  rule there, or with an inline disable that is really an override, is how a
  shared standard dies quietly. If a rule is genuinely wrong here, that is a
  finding to write down in a handoff, not a flag to add.
- **`bin/lint` is not in `bin/prime`, for the same reason `bin/deploy-config` is
  not.** It needs kit checked out beside the repository, which a CI runner and a
  fresh `npm ci` do not have. That is a real cost and the right trade: a check
  that only runs on a runner is a check its author never watched run, and this
  one *was* only on a runner for four days.

The rules that carry weight in this tree, and what each one is protecting:

| rule | what it means here |
|---|---|
| `require-await` | an `async` that never awaits. In test stubs the promise is real (`IdentityClient` returns `Promise<T>`), so the fix is `() => Promise.resolve(x)` / `Promise.reject(e)`, never a bare `throw` and never `vi.fn().mockResolvedValue` (which gives up the check on what resolved). |
| `unbound-method` | a member declared with **method shorthand** read off its object. `IdentityClient`, `BillingClient`, `AuthValue`, `TokenStore` and every prop type in `src/components/ui/` are **property** declarations holding function types, which is both what the rule asks for and the truth: they are object literals of arrow functions with no `this` to lose. Do not reintroduce `foo(): void`. |
| `no-misused-promises` | a promise handed to something typed `=> void` — React's `onSubmit`/`onClick`, `Retry`'s `onRetry`. `void` at the JSX boundary. `src/app/login/login-form.tsx` is where the reasoning is written out. |
| `no-floating-promises` | a promise with nobody waiting. Every `router.push` in a form is `void` and specifically **not** `await` — awaiting puts the navigation inside the surrounding `try`, so a failed navigation would be rendered as a refused sign-in. |
| `no-base-to-string` | `String(x)` on something that may not be a string. `identity.ts` uses `readString`, which returns a string or nothing; the alternative put `[object Object]` into an MFA challenge. |
| `no-unsafe-*` | an `any` travelling further than it should. `Response.json()` is `any`, so every read of a probe body goes through a named helper that states the shape once. |

**`.mjs` files are in the tsconfig on purpose.** `**/*.mjs` is in `include`
because kit's config lints `**/*.mjs` and typescript-eslint's project service
cannot place a linted file that belongs to no program — without it, every
type-aware rule on a `.mjs` file dies as one parse error and the file is
effectively unlinted. That is what was happening to `tests/assert-e2e-ran.mjs`,
which is the script that decides whether the end-to-end tier verified anything.
The cost is real and stated in `dist`/`.output`/`.kit` being listed in
`exclude`: without them, a build would put its own output into the program, and
`npm run typecheck` must pass *without* a build. Note `checkJs` is off, so
`tsc --noEmit` still reports nothing about a `.mjs` file's types — ESLint's
project service does read them, and a TypeScript `as` in one of those files will
make ESLint happy and `node` refuse to run it.

## Deploying to Cloudflare Workers

- **`npm run build` emits a Worker. `npm run build:node` emits a Node server.**
  They are two configs because `cloudflare()` and `nitro()` each take over the
  `ssr` environment: `vite.config.mts` is the default and produces
  `dist/server/index.mjs` plus the plugin's generated
  `dist/server/wrangler.json`, and `vite.node.config.mts` produces `.output/`.
  The Dockerfile ships the second; `wrangler deploy` consumes the first.
  `vite.shared.ts` holds what they must agree on — the `@/*` tsconfig-path
  resolution, postcss/Tailwind, and the webfont copy — imported by both rather
  than restated, because each of those three fails invisibly.
- **`wrangler.jsonc` is the deployment config and it is committed.** `main` is
  the framework's `@tanstack/react-start/server-entry`, and
  `compatibility_flags: ["nodejs_compat"]` is what keeps `process.env` working
  at all — those two names are the BFF's only source of where identity lives.
  `.wrangler/` is gitignored; `.output/` and `dist/` are gitignored.
- **`process.env` AT MODULE SCOPE IS A LIVE QUESTION, and it was measured rather
  than assumed.** `src/app/v1/[...path]/route.ts` builds its forwarder at module
  scope (the `const forward = createUpstreamForwarder({ identityUrl: identityUrl(),
  billingUrl: billingUrl() })` at the top of the file), so `identityUrl()` and
  `billingUrl()` read `process.env` at module scope, NOT per request — its own
  header says so ("read once, when this module is first imported"). The
  framework's deployment guide warns that `process.env.X` at module scope
  evaluates to `undefined` even on the server. Measured on the built Worker
  under `wrangler dev --local` with `nodejs_compat`: it **works** —
  `--var IDENTITY_URL:http://127.0.0.1:16980` sent `GET /v1/me` to exactly that
  fake identity, and with no var the same build fell back to
  `DEFAULT_IDENTITY_URL` and answered 502. So the warning does not bite here,
  but the read IS a module-scope read, and that is a fact the next person needs
  rather than one this comment can settle for them. It is deliberately NOT
  converted to a `cloudflare:workers` import, because that would break the Node
  target this tree still ships and is a larger decision than this packet.
- **The BFF's allow-list is unaffected and was re-checked on the Worker.** With
  the fake identity running, `GET /v1/probe/abc` — a route identity serves and
  the table refuses — answered 404 and never reached it. That is the property
  worth having proven on the new runtime rather than only in jsdom.
- **Static was not an option**, and the reason is in the BFF's own header: a
  browser-readable service address is a browser-changeable one, and for a
  forwarder that is the difference between a fixed destination and an attacker's.
  No `prerender`, no `ssr: false`, no SPA mode, no `defaultSsr` — and
  `/healthz` and `/readyz` are runtime checks that could not be prerendered in
  any case.

## The gate is declared, not guessed

`gate.yml` at the root declares what gates this repository: the command, the
file behind it, the mise task it has to resolve to, the three lines the gate's
own output must contain, and what the gate needs from the machine that is not
in the repository. The format, the checker and the reasoning are `core`'s —
`schemas/gate.schema.json`, `harness/gate_check.py`, `docs/gate.md`.

- **`selfContained: false` is the honest answer, and it is a claim somebody has
  to re-check when the gate changes.** `node_modules/` is gitignored, so a
  fresh clone needs the registry once, and no Node is vendored. Both are
  enumerated with a `satisfy` command and what "unmet" looks like. A
  requirement nobody can demonstrate is worse than no requirement.
- **The three `proof` floors are decrease-detectors, not budgets:** 727 vitest
  tests, 47 `validate-ci.sh` checks, 52 self-test breakages. Adding a test means
  raising `minimum: 727` in `gate.yml` in the same commit. `core` has
  `test_the_gate_floor_is_not_below_the_suite_core_claims_to_have` to force
  that; **this repository has no equivalent**, so it is a thing a human has to
  remember.
- **Two of those three floors are DECLARED totals, not counts of what ran, and
  that is load-bearing rather than a phrasing.** `ci-shape-checks` reads the
  first number on `47 checks declared, …` — the sum of passed, failed and
  skipped — and `check-self-test` reads `self_test: 52 breakages declared, …`.
  Three checks in `tests/validate-ci.sh` are gated on `caf`, `shellcheck` and
  `docker`, none of which this repository requires, and each prints SKIP rather
  than PASS when the tool is absent. A floor on the PASSED count is therefore a
  measurement of one fully-loaded machine, it is red on every machine that is
  not that one — which is every CI runner — and on this fleet, where "a check was
  deleted" and "a check could not run" are the same event, it cannot tell the two
  apart either. Measured on this tree: `47 checks declared`, and the declared
  number is the same on every machine while the *passed* number is whatever that
  machine could actually run (46/45/44/43 across four machines when the declared
  total was 46). Never lower these two floors to accommodate a
  missing tool; the sum is the number that means the same thing everywhere.
- **A self-test breakage declares the ENVIRONMENT AXIS it needs.** `breakage_axis`
  in `tests/validate-ci.sh` maps a breakage name to `caf`, `shellcheck`, `docker`
  or `-`, and `axis_available` mirrors the gate's own condition for that tool. A
  breakage whose axis is absent is printed as `UNPROVABLE`, counted separately,
  and **never counted as proven** — it is in the declared total the floor reads,
  and it is not in the number that was proved. It is not skipped to make the gate
  green: a skip nobody is forced to notice is not a pass (PLAN.md §1). A new
  env-gated breakage added without a line in `breakage_axis` goes RED loudly
  rather than passing quietly, which is the direction this file will be wrong in.
- **Write a proof for the line a TERMINAL SHOWS, because `core` strips the
  escapes first.** `vitest` colours its summary, so with `FORCE_COLOR=1` in the
  environment the bytes `core` writes to its log are
  `\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m377 passed\x1b[39m…`. Since
  `core-13` (MD17) the checker removes terminal escapes in `prove()` before it
  applies any `proof[].match`, so what a pattern is given is the rendered line.
  This repository was bitten before that ruling landed: `suite` shipped as
  `^[ ]*Tests[ ]+([0-9]+) passed`, could not match the captured bytes, and the
  checker reported `gate.proof-missing` about a gate that had just proved, in
  the same log, that it ran 377 tests. **Do not write escape tolerance.** It is
  dead weight now that core strips, it also WEAKENS the pattern (the run could
  match nothing, standing in for a space that has to be there), and
  `tests/gate-declaration-self-test.sh` fails if any `match:` in `gate.yml`
  names a terminal escape in any spelling.
- **The negative lookahead is the half worth keeping, and it has nothing to do
  with colour.** `[ ]+passed(?![ ]*\|)` refuses a
  `Tests  2 passed | 1 skipped (3)` line, so a suite that *skipped* a test is
  `gate.proof-missing` rather than a smaller green — the rule this file already
  states for the end-to-end tier, applied to the suite. Both the coloured and
  the plain spelling are asserted, because a tightening that only holds on one
  of them is a property of the runner rather than of the declaration.
- **One capture group, and only one.** The floor is read from exactly one, so
  every other group in a pattern here is `(?:…)`. `core` reports
  `gate.proof-invalid` for zero groups and for two, and the self-test has a
  case for each.
- **The other two proofs carry no escape tolerance on purpose.** The
  `35 passed, …` tally and the `self_test: …` line are both bash `printf`s in
  `tests/validate-ci.sh`, which contains no ESC byte and no `tput`, so it
  cannot colourise. The self-test asserts that source property, so a
  future attempt to add colour there is caught in the same commit that the
  proofs go red.
- **A one-line `run: <command>` in `ci.yml` is fine, and it is what the file
  says.** `core-12` (`63fd319`) fixed the reader that used to miss it, so the
  `run: |` block the `prime` job carried as a workaround is gone. Both halves of
  "the checker can see this step" are asserted rather than assumed: the
  `ci-disagrees` case rewrites the one-line command in place, and the
  `ci-step-deleted` case removes the whole step.
- **`bash tests/gate-declaration-self-test.sh` proves the declaration is
  load-bearing** — a control, then every breakage asserted to go red naming the
  finding it expects, then one documented blind spot asserted to stay green. It
  is deliberately **not** in `bin/prime`: the checker is `core`'s and is not
  vendored here, and the proof cases each run the whole gate. It needs `core`
  beside this repository or `CAFAYE_CORE_HARNESS`; without either it exits 2,
  never 0.
- **THE CONTROL RUNS TWICE, and the second run guards something else now.** Once
  as before, and once with `FORCE_COLOR=1` in the environment the checker
  captures the gate in. It was written when `core` did NOT strip, so the second
  control was the one that could see colour; a control that only passes where
  nothing colourises reports the day, not the repository, which is exactly how a
  red control got shipped as a green one here, and why **a self-test's own
  control going red BLOCKS a packet** (D13). Now that core strips, control 1
  cannot be made red by colour at all, and control 2 is the regression control
  on the **stripper**: the day `core` stops stripping, that is the case that goes
  red and the only one that would.
- **The colour cases reproduce captured bytes, not an impression of them.** The
  fixtures in that script are transcriptions of lines captured from a real run
  of this repository's own gate. A fixture that re-rendered the output by hand
  would be testing the fixture. If `vitest`'s reporter changes, re-capture the
  bytes and update the fixtures — do not make them pass by loosening them.

## Tests first

House rule (PLAN.md §3): write the test, watch it fail, then implement.

- `npm test` — single run (vitest). `npm run test:watch` while iterating.
- Tests live next to what they test: `foo.ts` → `foo.test.ts`.
- Route handlers are pure `GET()` functions returning `Response`; test them by
  calling `GET()` and asserting on `status`, `headers` and `await res.json()`.
  No HTTP server, no supertest — there is nothing to listen on.
- Render tests use `@testing-library/react` + `jsdom`. Assert on role and
  accessible name (`getByRole("heading", { level: 1 })`), never on class names —
  classes change with the brand, roles should not.
- Anything under `Providers` is rendered with `renderWithProviders` from
  `src/test/support/render.tsx`, which injects a scripted identity client and
  the **real** token store. Assert on a failure through the screen, not through
  the stub: a test that only checks `identity.login` was called passes just as
  happily when the result is never rendered.
- `noValidate` forms, so the browser's own bubbles never stand in for the
  message the service would have sent.
- No snapshots for behavior. No `waitFor` unless you are waiting on something
  async; the shell is synchronous by design. A React Query mutation resolves a
  microtask after you click, so a call assertion after `fireEvent.click` needs
  `waitFor` — asserting synchronously there tests nothing.
- Flakes: attribute before fixing. If a test fails, can your diff reach that
  surface? Measure a clean HEAD before you loosen anything.
- A test that cannot fail is worse than no test. When you add a guard, break it
  on purpose and watch the suite go red.

## Identity

`src/lib/identity.ts` is the **only** file that knows the identity contract:
`POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`, `GET /v1/me`, the two
password-reset routes under `/v1/password-resets` and the three verification
routes under `/v1/email-verification(s)` (see "Recovery" and "Verification" below),
and the ten tenancy routes under `/v1/accounts` and `/v1/invitations`. **The base
URL is `""`** — same-origin. Every call goes to this app's own `/v1/*`, and
`src/routes/v1/$.ts` wires `src/app/v1/[...path]/route.ts` to those methods,
which forwards to identity from the server. The
service address is `IDENTITY_URL`, a server-only variable, and is **not in the
client bundle**; do not reintroduce a `NEXT_PUBLIC_` prefix on it. Nothing in
this toolchain would inline that prefix, which is the stronger reason: a name
only reaches a browser if something deliberately substitutes it, and a value the
browser can read is a value the browser can change.
`tests/validate-ci.sh` fails the gate on a `NEXT_PUBLIC_` name in the Dockerfile
or in `src/`.

- **The tenancy shapes are transcribed from the service's handler, not from its
  OpenAPI document** — `identity/internal/httpapi/accounts.go`, because
  `identity/openapi/v1.yaml` does not describe any of them (see CHANGELOG
  "Known gaps"). If the document lands and disagrees with the handler, the
  handler is right and the file is the bug, same as every other contract
  disagreement in this repo. **Do not** "fix" these shapes to match the document
  without checking which side moved.

- **The transport is a parameter.** `createIdentityClient({baseUrl, transport})`.
  Never call `fetch` from a screen, a form or a context. A component test
  injects a stub client, so a render test cannot open a socket even by accident.
  `identity.test.ts` replaces the global `fetch` with a throwing function to keep
  it that way.
- **No msw.** Four endpoints and a recording stub is a smaller thing to trust
  than request interception.
- **Failures are `IdentityError`**, carrying `status`, `code`, `title`,
  `fieldErrors` (`{field, code}[]` from a 422) and `traceId`. Anything that
  reaches a screen as a failure is one of these or a plain `Error` — and plain
  `Error`s get a generic sentence, never `err.message`, which is where a
  service's internals leak.
- **The error envelope is ambiguous** between RFC 9457 problem+json (`core`'s
  rule) and the `{error:{…}}` shape in the identity-02 brief. The client reads
  both. If the manager settles it, delete the other path rather than leaving
  both to rot.
- Field codes are contract vocabulary. Turn one into English with
  `fieldErrorMessage`, never inline in a component, and never show an unknown
  code to a person — it stays on the error for telemetry.
- `MIN_PASSWORD_LENGTH` mirrors the service's own floor. The service is the
  authority; if the two disagree, the constant is the bug.

## Session

`src/lib/auth.tsx` holds session state; `src/lib/token-store.ts` holds the token.

- **The token is the React Query cache key** (`["session", token]`). That is why
  signing in as someone else cannot flash the previous user. Do not add a
  second source of truth for "who is signed in".
- Sign out always clears the local half, even when the `DELETE` fails. Someone
  who asked to leave is not held hostage to a service that is already down.
- A 401 forgets the token. Anything else leaves it and reads as signed out.
- **A guard against a double submit is a `useRef`, not `pending`.** The disabled
  button is a frame too late; a closure read of `pending` is stale in exactly
  the window where the second click lands.
- **The token in `localStorage` is still the credential this app exercises.** The
  BFF made the `HttpOnly` cookie real — the transport is now
  `credentials: "same-origin"` and `__Host-session` travels both ways — but
  identity prefers the `Authorization` header over the cookie, so both are live
  and the header is what is being used. Retiring the token is the guard packet's
  work, and until it lands an XSS on this origin still reads it. See README,
  "Sessions".

## Social login

`/login` and `/register` each render `SocialProviderButtons`, and
`/v1/auth/oauth/$provider/callback` renders `SocialCallbackScreen`. Three rules
hold the flow together, and each of them is a place where the obvious
implementation is wrong.

- **The two legs are not the same shape, and that is the service's, not ours.**
  The START leg answers a 302 that the browser follows. The CALLBACK leg answers
  200 with a JSON body and a `Set-Cookie` — identity does **not** redirect onward.
  So the start control is a plain `<a href>` to this origin and nothing else: a
  `fetch` resolves the 302 and hands back a provider's HTML, and a `<button>`
  cannot navigate at all. It is not the router's `Link`, either — that URL is the
  forwarder, not a route this app renders.
- **A document request gets the page and everything else gets the forwarder.**
  `src/routes/v1/auth/oauth/$provider/callback.tsx` takes that one URL away from
  the `/v1/$` splat and branches on `Accept: text/html`, which is what a top-level
  navigation sends and a `fetch` does not. This is what makes the exchange happen
  **exactly once**: the authorization code is one-shot, so a document navigation
  that also reached identity would spend it and then the page's own request would
  fail on a spent code. Do not "simplify" that branch into forwarding.
- **Three of the four answers are not a sign-in.** `completeSocialLogin` returns a
  discriminated union and `linked` and `mfa_required` are both 2xx that minted no
  token. Each gets its own state, and each is asserted by what the screen does not
  do. `adoptSession` exists because the token cannot be fetched again — it was
  spent on the code. A decline is **not** short-circuited from `?error=` locally:
  identity's answer clears the one-shot state cookie, and it is the only party that
  can tell a decline from a forged state.

`SOCIAL_PROVIDERS` in `src/lib/social.ts` is a constant because identity mounts
only the two routes and offers no discovery endpoint; a deployment adding a
provider edits that array. `redirect_uri` remains a deployment fact this
repository does not own: identity builds it from its own configured public base,
and if that is not **this app's origin** the round trip completes on the wrong
origin, where the state cookie is not in scope. **No unit test here can see
that** — see `HANDOFF-parlor-02-social-ui.md` — but the end-to-end tier now
does, and that is the return on `parlor-e2e-social-01`: `social.e2e.spec.ts`
drives a real browser through a real identity and a real provider, and
`OAUTH_REDIRECT_BASE_URL` is the edge's published port. Point it at identity's
own address and the whole round trip completes — 302, code, exchange,
userinfo — and then fails, or sets the cookie where the app is not. The link
case is asserted there too: attaching a provider must not mint a second
session, and the callback decides that from a record the start route left, not
from the session cookie.
## Recovery

`POST /v1/password-resets` and `POST /v1/password-resets/confirm` are **anonymous**.
Both are wrapped in identity's `sessionCredentialOnly`, which refuses a scoped API
key outright, so neither call carries an `Authorization` header at all — the token
in a reset link IS the credential, and a session token alongside it would be a
second one for no reason. There is a test per route in `identity.test.ts` that
asserts the header is absent.

- **The request route's answer is a constant and this app must not unmake it.**
  identity answers `202 {"status":"accepted"}` for a registered address, an
  unregistered one, and one inside the cooldown. So `forgot-password-form.tsx`
  names no address, uses one sentence for every input, and replaces the form on
  success rather than annotating it — a second request inside
  `RequestWindow` (one minute) sends nothing and still answers 202.
- **A 503 is the one failure on that route that may read differently.** identity
  checks the mailer BEFORE looking the address up, so `503 against 202` cannot be
  an existence oracle. It must NOT borrow the acceptance sentence: no mail is
  coming, and "check your inbox" is what strands somebody.
- **A 404 on the confirm route must never say "expired."** One sentinel,
  `ErrTokenNotFound`, covers never-existed, expired, spent, and another flow's
  token. Naming "expired" tells anyone probing tokens that the one they held had
  once been good.
- **The reset link's parameter is `token`**, from `RECOVERY_LINK_TEMPLATE`
  (`https://…/reset?token={token}` in every example in identity). It is
  deployment configuration rather than something the service fixes, so a link with
  no `token` is a rendered state with a way forward, not an exception.
- **The password floor applies on reset and NOT on sign in.** See
  `src/lib/credentials.ts`: refusing to *send* a short password at sign-in would
  lock out the accounts whose passwords predate the rule.

## Verification

Three routes, and the sign-in screen offers `/verify-email` because that is where
the person who signed up, closed the tab and never verified will actually look —
a signed-in banner could not reach them, since `GET /v1/email-verification`
answers for the caller's own address.

- **The two POSTs are anonymous and the GET is not.** `POST
  /v1/email-verifications` and `POST /v1/email-verifications/confirm` are wrapped
  in `sessionCredentialOnly` like the reset pair and send no `Authorization`
  header. `GET /v1/email-verification` resolves a session through `currentUser`
  and does take the token. Note the singular route: one word, against the two
  plural routes that start and redeem a flow.
- **`POST /v1/users` sends nothing.** A client that wants an address proved calls
  `POST /v1/email-verifications` afterwards, so `register-form.tsx` makes a second
  call. **The account exists from the moment the first one returns**, so that
  second call must never be able to report a failed registration — a person who
  reads it as "no account" registers again, into a 409 for an address they just
  proved they own. Every branch says "Account created for {email}" first.
- **`/verify-email` may not name an address; `/register` may.** The rule is not
  "never name an address", it is "never name one you did not just create". The
  resend screen is reachable by a stranger who typed somebody else's address;
  the register screen is showing back what was typed thirty seconds ago.
- **The 409 on the request route is the one answer that is not constant.**
  `Service.RequestVerification` orders `user.IsVerified()` after the lookup, so
  an address that is already proved answers 409 where every other address answers
  202 — which does tell a prober that an account exists. It is rendered, because
  identity declares it deliberately (so a client does not send somebody to an
  inbox nothing will arrive in) and flattening it would be unmaking a published
  contract decision. What this app guarantees is that it never *widens* it: the
  sentence names the state, never the address, never the service's `detail`. See
  CHANGELOG "Known gaps" — DECISION NEEDED.
- **A verification revokes nothing and mints nothing**, so the success state reads
  the session: a signed-in reader continues to `/accounts`, a signed-out one signs
  in. It is the only flow whose 204 is not followed by "sign in again".
- **A short token is a 404, not a 422.** The OpenAPI document declares
  `minLength: 43` on `RecoveryTokenRequest.token` and lists a 422; measured
  against a running identity, `{"token":"too-short"}` answers `404 not_found`,
  because `RedeemVerification` goes straight to `tokens.Live(digest)` and
  `tokenRequest` validates nothing. The client follows the handler. A truncated
  link is one of the four cases behind `ErrTokenNotFound` and gets one sentence.
- **`RECOVERY_LINK_TEMPLATE` is one string for both link kinds.** Measured:
  `internal/courier`'s `RecoveryMailer` holds a single `linkTemplate` and renders
  it for `password_reset` and `verify_email` alike, so a deployment cannot route
  both mails correctly with it. That is a service-side fix (per-kind templates) in
  a repository this one may not edit; DECISION NEEDED in CHANGELOG.
- **The confirmation does not submit on load.** Same reason as the reset and
  invitation screens: a mail client or link scanner fetching the URL would spend
  the token, and the link would be dead for the person who then clicked it.

## Security copy

Non-negotiable, because it is the property the screen exists to protect:

- A refused sign in says **one** sentence, in the summary, naming no field. A
  wrong password and an unknown address must be byte-identical, or the form is
  an account-existence oracle. There is a test that asserts exactly this; do not
  make it pass by weakening the assertion.
- A service failure must not borrow that sentence. 401 means "those are wrong";
  503 means "we could not find out", and telling someone their password is
  invalid when the service is down sends them to reset a good one.
- `409` on **register** may say the address is taken. That is the one place the
  answer is safe to give.
- Never render a field message the person did not cause, and never render an
  internal code, host, or port.

## Roles and capabilities

- `src/lib/roles.ts` holds the role order, the capability matrix, and the
  invitable-role list. It is a **transcription** of identity's
  `registerTenancyRoutes` and `Service.InviteRole`, so it is a reason not to
  *offer* a control and never a reason to believe one would have worked. The
  service answers 403 to anything it gets wrong, and the screen defers to that.
- `can(role, capability)` is how a screen asks. If you add a capability, add the
  row to the matrix test in the same commit — that table is the guard, and it was
  broken on purpose to prove it.
- A control for an action the service will refuse is worse than no control. "Leave"
  is not offered to an owner, an admin is not offered the admin invite option, and
  the last owner gets no usable "remove": each of those is a guaranteed 422.
- `slugify` and `validateAccountName` mirror the service so a name is refused
  before a round trip. The service is the authority; if they disagree, the
  service is right.

## Billing

- `src/lib/billing.ts` is a **separate** client with its own `BillingError`.
  Billing is a different service with its own codes, and a change to identity's
  envelope should not be a change to this one. Same envelope shape, no shared
  code.
- **No identity session token is sent to billing.** The contract declares
  `security: []` with no `securitySchemes` and records the gap itself. Handing a
  live identity session token to a service that does not authenticate it puts a
  credential in a third party's request logs for nothing. This is deliberate; do
  not "helpfully" add the header.
- `/billing/customers` is labelled as the **whole platform's** list, because the
  service scopes that collection by nothing. Do not put it behind account
  tenancy or call it somebody's billing page.
- **No subscription screen exists, and one cannot be built yet.** billing's master
  contract has no `/v1/subscriptions*` and `Customer` has no plan field, so "you
  are on X", upgrade, downgrade, cancel and the five subscription states have
  nowhere to read from. That is `parlor-04`, after billing-04's contract merges.
- `amount_minor` is an integer, always. `formatMoney` is the only division in the
  codebase and it happens last. Do not add a hand-written currency exponent table
  and do not do arithmetic on amounts anywhere else.
- `processor_customer_id` is always null in v0. No row may imply a card is on
  file.

## Theme

- `src/styles/tokens.css` is the **only** place theme values live.
- Components use Tailwind utilities (`bg-surface`, `text-muted`,
  `text-link`). Never a raw hex, never a `style={{ color }}` inline. A test
  walks `src/components` and fails on any colour literal.
- The palette is **designed, not a placeholder**: a warm paper-and-ink neutral
  and one chromatic voice (`seal`) reserved for interactive things. The reasoning
  and the measured contrast numbers are in `src/styles/tokens.css`'s header and
  in `docs/design-system.md`.
- Semantic layer (`--color-surface`, `--color-muted`, `--color-border`) is what
  components should reach for; the raw ramps are for tokens and accents.
- **`src/styles/tokens.test.ts` measures the palette on every run.** It parses
  `tokens.css`, resolves the `var()` chains, and asserts WCAG contrast for every
  pairing in both themes, plus ramp monotonicity and light/dark parity. Adding
  a semantic token means adding it to **both** blocks or the parity test fails.
- **The focus ring is one utility (`focus-ring`) and its 2px offset is
  load-bearing.** A ring drawn flush against a filled control is 1.00:1 against
  it in dark mode; what makes it visible is the gap, painted by the ground. Do
  not give a control its own ring, and do not set the offset to zero.
- Do not add a theme toggle without deciding where the preference is persisted;
  `prefers-color-scheme` is the only switch today and that is deliberate.

## Health surfaces

- `/healthz` — liveness. Never checks a dependency; a slow upstream must not
  get the process restarted. It is what the image's own `HEALTHCHECK` and
  `e2e/docker-compose.yml` both use, and that is a decision rather than a
  default: a supervisor asking "is this process alive?" wants the
  unconditional answer.
- `/readyz` — readiness. `deps: "none"` is a reserved placeholder string that
  becomes an array when a dependency check is wired in. Note that parlor now
  calls identity, and *that* has not been done yet — a real check is its own
  packet, because a slow identity must not necessarily mean "not ready", and
  that is a decision rather than a default. Keep the response keys stable: the
  platform contract reads them.
- Both are `no-store`. If you change either shape, change the tests and
  `cafaye.yml` in the same commit.

## Deploying to Node with Kamal

This is the SECOND target, not the default one. The default deploy is Cloudflare
Workers (see "Deploying to Cloudflare Workers" above); `config/deploy.yml` and
the Dockerfile are kept because `e2e/docker-compose.yml` builds this
repository's `Dockerfile` on every run of the whole-stack tier, and that tier is
the only thing here that proves the app against a real `identity` and `billing`.

`config/deploy.yml` is a copy of kit's template with five differences, and the
file says all five in its own header. The three worth carrying in your head:

- **The rollout gate is `/readyz` and the restart check is `/healthz`, and the
  difference is the whole content of the choice.** A probe is code, not config:
  `config/deploy.yml`'s `proxy.healthcheck.path` names a route this app has to
  serve, and `src/app/readyz/route.test.ts` reads that path out of the config
  and asserts a 200 there. Nothing upstream can — measured on kamal 2.12.0,
  `kamal config` exits 0 and kamal's own proxy validator accepts a path the app
  does not serve, and every rollout is then torn back after `deploy_timeout` on a
  release that is otherwise fine.
- **`NEXT_PUBLIC_*` is a Next-era convention, and no service address reaches the
  browser at all.** Nothing in this toolchain substitutes that prefix, so
  `IDENTITY_URL` and `BILLING_URL` are ordinary
  run-time variables in `env.clear`, fed by two extra required variables
  (`KIT_IDENTITY_URL`, `KIT_BILLING_URL`) on top of the five kit requires.
  **One image now serves every environment**, which is a real gain and not only a
  consequence — a missing build arg used to produce a working image and a broken
  app, because `docker build --build-arg` for an undeclared name is a warning, not
  an error. `tests/validate-ci.sh` now fails the gate on a `NEXT_PUBLIC_` name in
  the Dockerfile or in `src/`, and `src/app/v1/[...path]/route.test.ts` asserts
  against the **built** client chunks (`dist/client/assets`) that no service
  address is in them.
- **No accessories, no `DATABASE_URL`, no `config/kamal-backup.yml`.** parlor's
  state is identity's and billing's, over HTTP. The absence is argued in
  `config/deploy.yml` where the template would have put the postgres block,
  because an absence with no reason reads as an oversight and the next re-copy of
  the template quietly fills it back in.
- **A deploy of that config now completes a sign-in.** This used to be the first
  thing under "known gaps". `src/app/v1/[...path]/route.ts` answers `/v1/*` on
  this app's origin and forwards server-side, so the browser is same-origin and no
  CORS header is needed anywhere. No `Access-Control-*` header was added to
  identity to achieve it, and `src/lib/upstream.ts`'s header says why that was
  the shortcut not taken.

## The forwarder is not an open proxy

`src/lib/upstream.ts` forwards a browser's `/v1/*` to identity or billing. It is
the one place in this app that sends a request somewhere a caller named, so its
properties are the security properties of the whole deployment. Read the header
of that file before changing anything in it.

- **One configured destination, read on the server.** The two addresses are
  constructor parameters, from `process.env` at request time. There is no code
  path that reads a destination from a header, a query string, a path segment or
  a body. `Host`, `X-Forwarded-Host` and `?url=` are all ignored, and there are
  tests that assert each of them by name.
- **An allow-list, and the upstream path is REBUILT from it.** Twenty-six routes,
  transcribed from the two clients: twenty-one to identity, five to billing —
  the count is `grep -oE 'upstream: "[a-z]+"' src/lib/upstream.ts | sort | uniq -c`.
  identity serves thirty; token introspection, the MFA routes, API keys, OIDC
  clients, email changes and `/v1/probe/{id}` are refused **before an address is
  contacted**. Because the path is rebuilt from the table rather than forwarded
  as received, traversal, an absolute URL in a segment and a doubled slash are
  not filtered — they are not expressible.
- **Wildcard segments are value-matched.** `:accountId` and `:userId` must be
  uuids. The router percent-decodes each segment before the handler sees it, so
  `accounts/%2e%2e%2f%2e%2e` arrives as one segment reading `../../`; a check
  that only counted positions would splice it into the upstream URL.
- **Header allow-lists in both directions, never deny-lists.** A header this
  file does not name cannot be a smuggling channel.
- **`location` is relayed only for a route that DECLARES itself a redirect.**
  `redirect: "manual"` means the forwarder never *follows* a redirect, and the
  response allow-list means it does not *hand one over* either — so a 302 from
  an undeclared route reaches the browser as a 302 with nowhere to go, which is
  the honest dead end. `GET /v1/auth/oauth/{provider}` is the one route whose
  answer *is* a redirect, and it carries `browserRedirect: true` on its entry in
  `ROUTES`; `relay` reads that mark to decide whether to pass `Location` on. The
  decision was taken deliberately against adding `location` to the global list,
  because the hazard being relaxed is an *undeclared* upstream redirect steering
  the browser somewhere the allow-list never approved, with a session cookie
  riding it off-origin. A declared route is the service's own 302 on a path the
  table already names. `../site` uses the same mechanism and declares nothing
  with it; if you add a redirect route there, add the mark.
- **`Set-Cookie` goes through `getSetCookie()`, never `get()`.** The second
  returns values joined with ", ", which lands inside one cookie's `Expires` and
  destroys both. The 202 MFA branch is the case that proves it matters.
- **Cookies are relayed on a 302, not only on a 200.** The social start leg is
  the 302 *and* the leg that sets `__Host-oauth-state`, so a relay that treated
  cookies as a success-response detail would hand the browser a redirect to a
  provider with no state cookie — and the callback would then refuse the round
  trip with a 400 that says the flow "did not start in this browser". It did.
  Three tests in `upstream.test.ts` hold this: the start leg's 302 carrying both
  `Location` and `Set-Cookie`, a 302 on an *undeclared* route arriving with no
  `Location`, and the whole round trip walked end to end. All three were proved
  able to fail by breaking the implementation and watching them go red.
- **The cookie's attributes are never rewritten.** `__Host-` is a contract the
  *browser* enforces: `Secure`, `Path=/`, and no `Domain`. Adding a `Domain` to
  "make it work" is exactly what makes the browser reject the cookie, and
  dropping the prefix would trade an enforced guarantee for a convention.
  `SameSite=Lax` is what makes this CSRF-safe, and it works because the topology
  is same-origin rather than because this app sets anything.
- **The `__Host-` cookie needs HTTPS.** `Secure` means the browser stores it only
  on an HTTPS origin. `proxy.ssl: true` gives production that; a plain-HTTP
  deployment would silently lose the cookie, and the symptom is a session that
  does not survive a reload rather than an error.
- **Upstream failures stay failures.** Status and body pass through, so a 401
  cannot render as a success. A transport failure answers 502 with a fixed body:
  a fetch error message is `connect ECONNREFUSED 10.0.3.7:8080`, which is the
  fleet's internal topology.
- **`OPTIONS` is not exported and no `Access-Control-*` header is ever emitted.**
  A same-origin request sends no preflight, so this endpoint is not a CORS
  bypass, and there is a test that reads every response header name to prove it.

`upstream.test.ts` has a section that calls every method on both clients and
asks the table about each URL, so a route added to a client and not to the table
is a red suite. **The red proofs have been run**: letting `X-Forwarded-Host`
choose the destination, dropping the segment value checks, forwarding any
`/v1/*` path, and collapsing upstream errors into a 200 each turn named tests
red. A check that has only ever been green has verified nothing.

## Layout

```
src/routes/           the router. One file per path, TanStack Start's
                      createFileRoute: __root.tsx (the document shell — it
                      replaced src/app/layout.tsx), index.tsx, login.tsx,
                      register.tsx, forgot-password.tsx, reset-password.tsx,
                      verify-email.tsx, verify-email/confirm.tsx,
                      accounts/index.tsx, accounts/$accountId.tsx,
                      invitations/$token.tsx, billing/plans.tsx,
                      billing/customers.tsx, healthz.ts, readyz.ts,
                      v1/$.ts — the BFF, as a splat route with server.handlers
src/routeTree.gen.ts  GENERATED and COMMITTED (.gitignore says so at the line).
                      The router in src/router.tsx is built from it.
src/app/              NOT the Next.js app router and NOT scanned by the
                      framework. Screens and handler modules, imported by the
                      route files: */page.tsx (default-exported screen
                      components), */route.ts (pure `GET()`-style handler
                      functions returning a Response), the `*-screen.tsx` and
                      `*-form.tsx` they are split into, providers.tsx (the
                      client provider stack, mounted by __root.tsx),
                      globals.css, favicon.ico
wrangler.jsonc         the Cloudflare Workers deployment config, committed:
                      `main` is the framework's server entry, `nodejs_compat`
                      is what keeps `process.env` working, and its comments say
                      which field earns its place. `.wrangler/` is gitignored.
vite.shared.ts         the half of the build config the Cloudflare target and
                      the Node target must agree on — the `@/*` tsconfig-path
                      resolution, postcss/Tailwind, and `copyFontFiles` —
                      imported by both configs rather than restated in each
config/deploy.yml   the Kamal configuration, copied from kit's template with
                    five differences. NO accessories key: parlor keeps no
                    database, and the reason is written where the template
                    would have put the postgres block. `env.clear` carries the
                    two service addresses at RUN time; there are no
                    `builder.args` at all, because a `NEXT_PUBLIC_*` address
                    would be inlined into the browser bundle
bin/deploy-config   the tier that runs the real kamal binary against the
                    rendered config. NOT in bin/prime — kamal and ruby are on
                    neither a CI runner nor a node-only checkout. Three-valued
                    exit: 0 proven, 1 failed, 2 could not run
bin/lint            `npm run lint` is this: kit's ESLint config, fetched into
                    .kit/ and run over the tree, which is what CI's
                    `ci (kit, node)` lint step does. NOT in bin/prime — it needs
                    a kit checkout beside the repository, for the same reason
                    the deploy tier is not. Two-valued exit like every other
                    command. There is NO eslint.config.mjs in this tree; see
                    "The lint standard" for why there is not
e2e/                the whole-stack end-to-end tier: the compose topology, the
                    Playwright specs, and the guards that make a green run mean
                    something
src/lib/            identity.ts (identity contract), roles.ts (role vocabulary),
                    accounts.ts (tenancy queries), credentials.ts (what to check
                    before asking the service), money.ts, billing.ts, social.ts
                    (the provider list and the start path),
                    upstream.ts (the forwarder's allow-list and the only code that
                    names a service address at run time),
                    billing-context.tsx, token-store.ts, auth.tsx (session)
src/components/ui/  primitives: one per file, re-exported from index.ts
src/components/shell/  session-aware chrome (header)
src/components/social/  the two provider controls: the start buttons and the
                     callback landing screen
src/styles/         tokens.css — the theme
src/test/           vitest setup + support/ (stubs, render helper)
```

- **Adding a screen is two files, not one.** A route file under `src/routes/`
  declares the path and renders a screen; the screen itself is a
  default-exported component in `src/app/**` with its test beside it. See
  `src/routes/index.tsx`, which is the smallest complete example, and
  `src/routes/__root.tsx` for the document shell.
- **A route file is not the screen and a route handler is not a `route.ts`
  convention.** `createFileRoute("/healthz")({ server: { handlers: { GET } } })`
  is how a pure `GET(): Response` gets onto the wire, and a route that declares
  **both** a handler and a `component` serves the handler and then renders into
  the same response — which is why `/healthz` and `/v1/$` declare no component.
  The method names are explicit, with no catch-all: a method a route does not
  name gets a 405 from the router before the handler is reached, and `OPTIONS` is
  never answered.
- Server components are not a thing to choose here. `src/app/providers.tsx` is
  the only place client-only context is mounted, and `__root.tsx` renders the
  `<html>` document with `HeadContent` and `Scripts` beside `Outlet`.
- `src/components/ui/index.ts` is the single import path for primitives. The
  primitives are cafaye's own design, not a wrapper over a library; call sites
  do not move when one is added or restyled.
- `docs/design-system.md` is the guide for building a screen: which component
  to reach for, what the variants mean, and what is deliberately absent.
- `Field` owns the label / description / invalid wiring. Do not hand-wire
  `aria-describedby` at a call site — that is how a screen reader ends up
  announcing "invalid" and dropping the reason.
- A button's accessible name does not change when it becomes busy. It goes
  `disabled` + `aria-busy`; a control that renames itself mid-interaction loses
  its own label for anyone navigating by name. `Spinner` is `aria-hidden`
  because the `aria-busy` is the announcement.
- **`variant="destructive"` and `ConfirmDialog` are the only way to run
  something irreversible.** The confirming button used to be `primary`, which
  made the most dangerous control on the account screen look exactly like
  "Save name". There is no `href` on `Button`: a button that navigates is a
  link, and the absence is what stops the wrong thing being easy.

## Dependencies

Adding a dependency needs manager approval (PLAN.md §5). No shadcn install, no
state library, no chart library — if a screen needs one, that is a packet.
`@tanstack/react-query` is approved and installed. There is no `clsx` and no
`tailwind-merge`: `src/lib/cx.ts` is the whole of what that problem needs.
There is no `@testing-library/user-event`; `fireEvent` from the already-installed
`@testing-library/react` is what the house uses.
