# parlor

The cafaye app shell — the template every cafaye-built product starts from, and
the admin surface they all inherit.

From [PLAN.md](../PLAN.md): `parlor` is *"app shell template + admin (Next.js)"*,
built in Phase 2 alongside `guard`. The shell arrived first (routing, theme,
health surfaces, test rig); the auth screens arrived next, against a client for
the identity contract with a mocked transport underneath it.

## The philosophy: you own the code

This is a **template**, not a platform-as-a-service dependency.

- You clone it. You read all of it. It is a few hundred files of ordinary
  Next.js you can reason about end to end.
- You change whatever you need and ship your fork. There is no license key, no
  feature gate, no call home, no vendor that can raise your prices or pull the
  rug.
- We ship improvements upstream, so keeping in sync means a merge, not a
  migration.
- Anything cafaye later adds — identity screens, billing screens, team
  management — arrives as code in your repo, not as a runtime dependency.

The test of whether this philosophy is real: if cafaye disappeared tomorrow,
would your product still build? It has to be.

## What is here today

| Surface | Path | Purpose |
| --- | --- | --- |
| Landing | `/` | Directory of the sections below. |
| Register | `/register` | Email + password against `POST /v1/users`. |
| Sign in | `/login` | Email + password against `POST /v1/session`. |
| Accounts | `/accounts` | The accounts you belong to, and the create form. |
| One account | `/accounts/[accountId]` | Facts, members, rename, invite, leave, delete — gated by your role. |
| Accept an invitation | `/invitations/[token]` | Redeem a token. Does not accept on load. |
| Plan catalogue | `/billing/plans` | What can be bought, at what price, on what cadence. Paged. |
| Customers | `/billing/customers` | Billing's customer records. Platform-wide, and labelled so. |
| Session shell | `src/components/shell/` | Header: navigation, sign out when authed, sign in when not. |
| Identity client | `src/lib/identity.ts` | Typed, transport-injected client for identity's fourteen endpoints. |
| Role vocabulary | `src/lib/roles.ts` | The capability matrix, transcribed from identity's authorization. |
| Tenancy queries | `src/lib/accounts.ts` | Query keys and invalidation for the account surface. |
| Money | `src/lib/money.ts` | Integer minor units in, a price out. |
| Billing client | `src/lib/billing.ts` | Typed client for billing's five endpoints, with its own error type. |
| Session state | `src/lib/auth.tsx` | React Query cache keyed by token + auth context. |
| Token store | `src/lib/token-store.ts` | `localStorage` persistence, injectable. |
| Liveness | `/healthz` | `{"status":"ok"}` — process is up. No dependency checks, on purpose. |
| Readiness | `/readyz` | `{"status":"ok","deps":"none"}` — `deps` is a reserved placeholder. |
| Theme tokens | `src/styles/tokens.css` | Tailwind v4 `@theme` block, placeholder cafaye palette. |
| Primitives | `src/components/ui/` | Hand-rolled Button, Input, Field, Select, Panel, state components. shadcn/ui later. |
| Tests | `src/**/*.test.{ts,tsx}` | vitest + `@testing-library/react`. |

## Talking to identity

The endpoints are fixed by contract. `src/lib/identity.ts` is the only file that
knows them.

| Call | Endpoint | Success |
| --- | --- | --- |
| `register({email, password})` | `POST /v1/users` | `201 {id, email}` |
| `login({email, password})` | `POST /v1/session` | `200 {token, expires_at}` |
| `logout(token)` | `DELETE /v1/session` | `204` |
| `me(token)` | `GET /v1/me` | `200 {id, email}` |

The tenancy surface, with the minimum role each route needs:

| Call | Endpoint | Minimum role | Success |
| --- | --- | --- | --- |
| `listAccounts(token)` | `GET /v1/accounts` | any session | `200 [{id, name, slug, personal, role, created_at}]` |
| `createAccount(token, {name})` | `POST /v1/accounts` | any session | `201 {id, name, slug, personal, role, …}` |
| `getAccount(token, id)` | `GET /v1/accounts/{id}` | member | `200 {… , members}` |
| `renameAccount(token, id, {name})` | `PATCH /v1/accounts/{id}` | admin | `200 {…}` |
| `deleteAccount(token, id)` | `DELETE /v1/accounts/{id}` | owner | `204` |
| `listMembers(token, id)` | `GET /v1/accounts/{id}/members` | member | `200 {memberships, role}` |
| `inviteMember(token, id, {email, role})` | `POST /v1/accounts/{id}/invitations` | admin (owner for `role: admin`) | `201 {…, token}` |
| `acceptInvitation(token, {token})` | `POST /v1/invitations/accept` | any session | `200 {account_id, user_id, role, created_at}` |
| `changeMemberRole(token, id, userId, {role})` | `PATCH /v1/accounts/{id}/members/{userId}` | owner | `200 {…}` |
| `removeMember(token, id, userId)` | `DELETE /v1/accounts/{id}/members/{userId}` | admin | `204` |

> **The tenancy shapes come from the service's handler, not from its OpenAPI
> document.** `identity/openapi/v1.yaml` on master describes five paths and
> none of these: the document was last changed before the packet that added the
> tenancy implementation was merged, so these routes exist in the service, in its
> routes and in its authorization tests, and not in the published contract. A
> struct tag is the wire and a document is a description of one, so the handler
> is the authority here — but the gap is real, and merging the
> `worker/identity-04-contract` draft is the fix. See CHANGELOG, "Known gaps".

### Talking to billing

`src/lib/billing.ts` is a separate client with its own `BillingError`. Billing is a
different service with its own codes, and a change to identity's envelope should
not be a change to this one.

| Call | Endpoint | Success |
| --- | --- | --- |
| `listPlans({cursor, limit, order})` | `GET /v1/plans` | `200 {data: Plan[], page}` |
| `getPlanBySlug(slug)` | `GET /v1/plans/{slug}` | `200 Plan` |
| `listCustomers({cursor, limit})` | `GET /v1/customers` | `200 {data: Customer[], page}` |
| `getCustomer(id)` | `GET /v1/customers/{id}` | `200 Customer` |
| `createCustomer(input, idempotencyKey?)` | `POST /v1/customers` | `201 Customer` |

The base URL comes from `NEXT_PUBLIC_BILLING_URL`, defaulting to
`http://localhost:3000`. Three things about it are decisions rather than
accidents:

- **No identity session token is sent.** billing declares `security: []` with no
  `securitySchemes` at all, and records the gap in its own header: `GET
  /v1/customers` "returns every customer, because there is no account to scope
  it by". There is nothing to authenticate with, and handing a live identity
  session token to a service that does not authenticate it would put a credential
  in a third party's request logs. `/billing/customers` is therefore labelled as
  the platform's list, not somebody's.
- **There is no subscription surface.** No `/v1/subscriptions*` exists and
  `Customer` has no plan field, so nothing on the wire records which plan a
  customer is on. A `Plan` is a catalogue row. This is why `/billing/plans` is a
  catalogue with no buy button, and why "you are on X", upgrade, downgrade,
  cancel and the five subscription states are a separate packet — `parlor-04`,
  once billing-04's contract is on master.
- **Money is integer minor units.** `formatMoney` reads the currency's exponent
  from `Intl` rather than from a table, so 1900 minor units is $19.00 in USD,
  ¥1,900 in JPY, and 12,345 is 12.345 in KWD. It is the only division in the
  codebase and the last one before a number reaches a person.

The base URL comes from `NEXT_PUBLIC_IDENTITY_URL`, defaulting to
`http://localhost:8080` — the identity service in the compose stack.

> **It is read at build time.** Next inlines `NEXT_PUBLIC_*` into the client
> bundle, so `docker run -e NEXT_PUBLIC_IDENTITY_URL=…` changes nothing; the
> string is already in the JavaScript. The Dockerfile takes it as a build arg:
>
> ```sh
> docker build --build-arg NEXT_PUBLIC_IDENTITY_URL=https://identity.example.com .
> ```

Two things about the contract are worth stating plainly, because both are
decisions rather than accidents, and one of them is not settled:

- **The error body is ambiguous.** `core/docs/openapi-conventions.md` requires
  every cafaye service to answer with RFC 9457 problem+json (`code`, `detail`,
  `trace_id`, and `errors[]` of `{field, code}` on a 422). The identity-02 brief
  writes the failure shape as `{error:{…}}`. The client reads both and produces
  the same `IdentityError` either way, so the screens work against whichever one
  ships. The manager should pick one and delete the other path.
- **Registering does not start a session.** `POST /v1/users` returns the new
  user and no token, so `/register` confirms and links to `/login` rather than
  signing anyone in. If registration is meant to mint a session — the way
  jumpstart's signup does — that belongs in the contract, not in this screen.

## Sessions

The session token is kept in `localStorage` under `parlor.session.token`.

That is the weaker of the two available options, and it is here for a specific
reason: identity sets an `HttpOnly` session cookie, which by definition cannot
be read by this bundle, and the browser sends it only to same-origin requests
while identity sits on another port. With no server between the browser and
identity, the token is the only credential this code can actually hold.

What it buys: a session that survives a reload, and a shell that knows who you
are on the first paint. What it costs: any XSS on this origin becomes a session
compromise, and a token readable by script is a weaker thing to hand out than a
cookie the browser owns.

**The BFF packet reverses this.** A server route in front of identity, same
origin, a `Secure`/`HttpOnly`/`SameSite=Lax` cookie as the only authority, a
CSRF token on the mutating calls, and nothing in script-reachable storage. When
that lands: drop the token from the query key, read the session from a server
component, add the CSRF header, and let identity own CORS instead of the browser
calling it cross-origin. Until then, `SESSION_TOKEN_KEY` in
`src/lib/token-store.ts` is the one string to keep in step.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · @tanstack/react-query ·
vitest · @testing-library/react · Node pinned in `package.json`.

## Getting started

```sh
mise install      # node 22.22.2, the same pin package.json declares
./bin/prime       # npm ci + npm test + the CI gate
npm run dev       # http://localhost:3000
```

`bin/prime` is the reproduction check: it installs **exactly** the committed
lockfile, runs the full suite, and then checks that the tree still says what
CI assumes about it. If it is green, your checkout is sound *and* the gate is
the gate.

```sh
npm test           # vitest, single run
npm run test:watch # vitest, watching
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

### The runtime pin is `package.json`, and the gate keeps it honest

`engines.node` is the pin of record: **22.22.2**, the floor jsdom@30 demands.
`packageManager` records the npm that ships with it. `.npmrc` sets
`engine-strict=true`, which is what makes that a gate rather than a
suggestion — with it, `npm ci` exits nonzero on a Node that does not match;
without it, the same command prints `npm warn EBADENGINE` and installs anyway.

Three other files carry the same number, and that is deliberate: `mise.toml`
so a developer's local toolchain is the pinned one, the CI workflow so the
runner is, and `cafaye.yml` records the major line (`"22"`). A number in four
places is four pins unless something holds them together, so
`bash tests/validate-ci.sh` fails when they disagree — as a pre-commit-ish
habit, as part of `bin/prime`, and therefore in CI:

```sh
bash tests/validate-ci.sh              # 18 checks
bash tests/validate-ci.sh --self-test  # break a throwaway copy 16 ways,
                                       # assert each one goes red
```

## CI

`.github/workflows/ci.yml`, three jobs:

| Job | What it runs | Why it is here |
| --- | --- | --- |
| `ci` | kit's reusable workflow, `language: node` | The shared contract. Called, not copied, so a fix in kit lands here with no per-repo PR. |
| `prime` | `./bin/prime`, then `git diff --exit-code -- package-lock.json` | CI runs the command a developer runs, and fails if the gate moved the lockfile. |
| `build` | `rm -rf .next && npm run typecheck`, then `npm run build`, then an assertion that `.next/standalone/server.js` and `.next/BUILD_ID` exist | The suite renders components in jsdom and never asks Next to compile a route, so a broken server/client boundary or a failing prerender is invisible to it. |

Two decisions worth knowing about:

- **`lint` is in CI, and it is kit's step.** `npm run lint` runs in the shared
  `node` job, so there is no second copy of it here to drift.
- **`typecheck` runs before `next build`, and the order is the assertion.** A
  typecheck that runs after a build can pass on types Next generated. Layout
  props are typed explicitly rather than with Next's generated `LayoutProps`
  precisely so a fresh clone typechecks, and the workflow deletes `.next`
  first so it has to.
- **The build is given `NEXT_PUBLIC_IDENTITY_URL` and
  `NEXT_PUBLIC_BILLING_URL` explicitly.** Next inlines `NEXT_PUBLIC_*` at
  build time, so an unset value leaves a live `process.env` lookup in a
  browser bundle — `undefined` there — and the app quietly talks to
  `localhost`. The workflow passes RFC 2606 `.invalid` names, which resolve
  nowhere, so a build that somehow reached for one fails loudly.

`language: none` and coverage: kit's coverage gate is **0** here on purpose.
Raising it needs a `coverage` script, which needs `@vitest/coverage-v8`, which
is a dependency and therefore a manager decision. A threshold that reports a
number nobody measured is worse than an honest 0 with a comment.

## Container

> **`docker build` is broken on `master` today**, and this section is the
> record of that rather than an instruction that works. The `deps` stage
> inherits `NODE_ENV=production`, so `npm ci` there installs no
> devDependencies and the builder dies on `Cannot find module
> '@tailwindcss/postcss'`. Two faults sit behind it — the runner copies an
> `/app/public` that does not exist, and `node:22-slim` is 22.23.3 rather than
> the pinned 22.22.2. See CHANGELOG "Known gaps" for the measurements and the
> minimal fix. The CI `build` job is unaffected and asserts the standalone
> output the image needs.

```sh
docker build -t parlor .          # currently fails, see above
docker run --rm -p 3000:3000 parlor
```

Multi-stage `node:22-slim`, standalone Next output, non-root user, `/healthz`
wired to the image `HEALTHCHECK`.

## Not yet — Phase 2

Deliberately absent, by packet boundary rather than oversight:

- **The session cookie.** The token is in `localStorage` until a BFF route owns
  it. See "Sessions" above — this is the one item with a security cost, and it
  is the first thing a reviewer should look at.
- OAuth sign-in and MFA enrollment (TOTP, recovery codes) — the service side
  lands in identity's later packets; the UI follows its contract.
- Password reset, email verification, and every other identity screen.
- **The subscription lifecycle** — upgrade, downgrade, cancel, and the five
  subscription states. billing's master contract has no `/v1/subscriptions*` and
  `Customer` has no plan field, so none of it can be read from anywhere. This is
  `parlor-04`, dispatched once billing-04's contract is merged; building it now
  would mean inventing five states and their copy.
- **Per-member management in the member panel.** The service sends no `user_id`
  on a member row, so the per-member routes have nothing to address. The panel
  shows the role distribution and says why; the per-member controls render the
  moment identity fixes the projection.
- Dashboard, settings, and admin skeleton (`madmin`-style).
- **shadcn/ui** — installs into `src/components/ui/` so there is one import
  path for the whole product. The barrel is there, and already holding
  hand-rolled Button, Input and Field for shadcn to replace in place.
- Playwright E2E suite (signup, login, MFA, invites, checkout) against the
  compose stack — PLAN.md §3 puts its birth in Phase 2.
- CORS configuration on identity for a cross-origin browser. The client sends
  no credentials cross-origin, so identity has to allow the origin before any of
  this runs against a real service.
- Real brand colors. `tokens.css` carries a neutral placeholder ramp; when the
  palette decision lands it is a one-file change by design.

## Contributing

Read [AGENTS.md](AGENTS.md) first — it holds the test-first rule, the token
rules, and the health-surface contracts. Long-running commands get `timeout N`.

MIT.
