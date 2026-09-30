# parlor

The cafaye app shell — the template every cafaye-built product starts from, and
the admin surface they all inherit.

From [PLAN.md](../PLAN.md): `parlor` is *"app shell template + admin (Next.js)"*,
built in Phase 2 alongside `guard`. Phase 1 (this commit) is the shell itself:
routing, theme, health surfaces and a test rig, with no product screens on top.

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
| Landing placeholder | `/` | Brand text only. Real screens land in Phase 2. |
| Liveness | `/healthz` | `{"status":"ok"}` — process is up. No dependency checks, on purpose. |
| Readiness | `/readyz` | `{"status":"ok","deps":"none"}` — `deps` is a reserved placeholder. |
| Theme tokens | `src/styles/tokens.css` | Tailwind v4 `@theme` block, placeholder cafaye palette. |
| Primitive barrel | `src/components/ui/` | Empty until Phase 2 installs shadcn/ui. |
| Tests | `src/**/*.test.{ts,tsx}` | vitest + `@testing-library/react`. |

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · vitest ·
@testing-library/react · Node pinned in `mise.toml`.

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

- Auth: signup, login, MFA enrollment, sessions — served by `identity`.
- Product screens: dashboard, settings, team and invite management.
- Admin skeleton (`madmin`-style).
- **shadcn/ui** — installs into `src/components/ui/` so there is one import
  path for the whole product. The barrel is already there, waiting.
- Playwright E2E suite (signup, login, MFA, invites, checkout) against the
  compose stack — PLAN.md §3 puts its birth in Phase 2.
- Real brand colors. `tokens.css` carries a neutral placeholder ramp; when the
  palette decision lands it is a one-file change by design.

## Contributing

Read [AGENTS.md](AGENTS.md) first — it holds the test-first rule, the token
rules, and the health-surface contracts. Long-running commands get `timeout N`.

MIT.
