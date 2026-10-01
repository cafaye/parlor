# AGENTS.md — working rules for this repo

Orientation for agents and humans changing `parlor`. The operating contract
lives in `moon/PLAN.md` (§1 manager-worker, §3 test doctrine); this file is the
parlor-specific part.

## What this repo is

The cafaye web app: app router, Tailwind v4, theme tokens, health surfaces, test
rig — and the screens built against identity's and billing's real contracts.
Auth (`/register`, `/login`, a session-aware header), accounts and invitations
(`/accounts`, `/accounts/[accountId]`, `/invitations/[token]`), and the two
billing surfaces the contract actually declares (`/billing/plans`,
`/billing/customers`), built on the design system in `docs/design-system.md`.
If you are looking for a dashboard, settings, admin or a subscription screen,
you are looking at a later packet — see CHANGELOG "Known gaps" for the five
service-side gaps this build works around.

## Setup

```sh
./bin/prime      # npm ci + npm test + the CI gate
mise install      # node version from mise.toml
```

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
- `npm run typecheck` must pass **without** a build: `rm -rf .next` and check.
  Layout props are typed explicitly rather than with Next's generated
  `LayoutProps`, precisely so a fresh clone can typecheck. The CI `build` job
  deletes `.next` before typechecking, so it cannot pass on generated types.

## The end-to-end tier

`bin/prime` is the per-commit gate and has no stack in it. The whole-fleet tier
is `./bin/e2e`, and it is not optional decoration — it is how a change to this
app is proved against the services it actually talks to. Read `e2e/edge.conf`
before changing the topology; the file states the measured reason the stack has
a reverse proxy in it, which is not a stylistic choice.

```
e2e/docker-compose.yml   the stack: identity + guard built from ../ and
                         siblings, one Postgres, one Redis, one edge proxy
e2e/edge.conf            the same-origin edge. WHY IT EXISTS is in the file
bin/e2e-stack            build / up / wait / down — the lifecycle, the bounded
                         readiness poll, and the logs on a failed bring-up
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
- **A service in the stack with no `healthcheck:` must have a `FINDING` in its
  own block**, and the gate checks for both. identity is the one: a distroless
  image has no HTTP client, so nothing inside it can answer a probe, and the
  harness polls from outside instead.

## CI

`.github/workflows/ci.yml` — `ci` (kit's shared `node` job), `prime`
(`./bin/prime` plus the `git diff --exit-code -- package-lock.json` guard) and
`build` (typecheck, then `next build`, then an assertion that the standalone
output the Dockerfile copies exists).

`.github/workflows/e2e.yml` — the whole-stack tier, its own workflow and its own
required job. It checks out `../identity` and `../guard` beside this repository,
because the stack builds their images from those checkouts.

- **The gate is `bin/prime`, and CI runs that script, not a list of `npm run`
  commands.** If the two can disagree, one of them is lying. Adding a check
  means adding it to `bin/prime`, not to the workflow.
- **`tests/validate-ci.sh` is part of the gate, not a CI extra.** It checks the
  shape of the tree CI assumes — the pin, the lockfile contract, the gate
  command, that every `npm run` the workflow calls still exists, and now the
  end-to-end tier's own shape. Its `--self-test` breaks a throwaway copy 34
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
- **The three `proof` floors are decrease-detectors, not budgets:** 377 vitest
  tests, 35 `validate-ci.sh` checks, 34 self-test breakages. Adding a test means
  raising `minimum: 377` in `gate.yml` in the same commit. `core` has
  `test_the_gate_floor_is_not_below_the_suite_core_claims_to_have` to force
  that; **this repository has no equivalent**, so it is a thing a human has to
  remember.
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
`POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`, `GET /v1/me`, and
the ten tenancy routes under `/v1/accounts` and `/v1/invitations`. Base URL from
`NEXT_PUBLIC_IDENTITY_URL` (default `http://localhost:8080`).

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
- The token in `localStorage` is a deliberate, temporary, weaker position — the
  BFF packet moves it into an `HttpOnly` cookie. See README, "Sessions".

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
  get the process restarted.
- `/readyz` — readiness. `deps: "none"` is a reserved placeholder string that
  becomes an array when a dependency check is wired in. Note that parlor now
  calls identity, and *that* has not been done yet — a real check is its own
  packet, because a slow identity must not necessarily mean "not ready", and
  that is a decision rather than a default. Keep the response keys stable: the
  platform contract reads them.
- Both are `no-store`. If you change either shape, change the tests and
  `cafaye.yml` in the same commit.

## Layout

```
src/app/            routes: page, login/, register/, accounts/,
                    accounts/[accountId]/, invitations/[token]/,
                    billing/plans/, billing/customers/, healthz/, readyz/,
                    providers.tsx — the client provider stack, mounted by layout
e2e/                the whole-stack end-to-end tier: the compose topology, the
                    Playwright specs, and the guards that make a green run mean
                    something
src/lib/            identity.ts (identity contract), roles.ts (role vocabulary),
                    accounts.ts (tenancy queries), money.ts, billing.ts,
                    billing-context.tsx, token-store.ts, auth.tsx (session)
src/components/ui/  primitives: one per file, re-exported from index.ts
src/components/shell/  session-aware chrome (header)
src/styles/         tokens.css — the theme
src/test/           vitest setup + support/ (stubs, render helper)
```

- App Router conventions: `page.tsx` per route, `route.ts` per endpoint, layouts
  at the top. Server components by default — add `"use client"` only for
  something that genuinely needs interactivity. The auth *pages* are server
  components that render a client *form*; the split is the point.
- Route handlers export named HTTP verb functions (`export function GET()`), no
  default export, no class instances.
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
