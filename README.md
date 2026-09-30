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
| Landing placeholder | `/` | Brand text only. Product screens land in Phase 2. |
| Register | `/register` | Email + password against `POST /v1/users`. |
| Sign in | `/login` | Email + password against `POST /v1/session`. |
| Session shell | `src/components/shell/` | Header: sign out when authed, sign in when not. |
| Identity client | `src/lib/identity.ts` | Typed, transport-injected client for the four endpoints. |
| Session state | `src/lib/auth.tsx` | React Query cache keyed by token + auth context. |
| Token store | `src/lib/token-store.ts` | `localStorage` persistence, injectable. |
| Liveness | `/healthz` | `{"status":"ok"}` — process is up. No dependency checks, on purpose. |
| Readiness | `/readyz` | `{"status":"ok","deps":"none"}` — `deps` is a reserved placeholder. |
| Theme tokens | `src/styles/tokens.css` | Tailwind v4 `@theme` block, placeholder cafaye palette. |
| Primitives | `src/components/ui/` | Hand-rolled Button, Input, Field. shadcn/ui later. |
| Tests | `src/**/*.test.{ts,tsx}` | vitest + `@testing-library/react`. |

## Talking to identity

The four endpoints are fixed by contract. `src/lib/identity.ts` is the only file
that knows them.

| Call | Endpoint | Success |
| --- | --- | --- |
| `register({email, password})` | `POST /v1/users` | `201 {id, email}` |
| `login({email, password})` | `POST /v1/session` | `200 {token, expires_at}` |
| `logout(token)` | `DELETE /v1/session` | `204` |
| `me(token)` | `GET /v1/me` | `200 {id, email}` |

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
vitest · @testing-library/react · Node pinned in `mise.toml`.

## Getting started

```sh
mise install      # node from mise.toml
./bin/prime       # npm ci + npm test
npm run dev       # http://localhost:3000
```

`bin/prime` is the reproduction check: it installs **exactly** the committed
lockfile and runs the full suite. If it is green, your checkout is sound.

```sh
npm test           # vitest, single run
npm run test:watch # vitest, watching
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Container

```sh
docker build -t parlor .
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
- Product screens: dashboard, settings, team and invite management.
- Admin skeleton (`madmin`-style).
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
