# AGENTS.md — working rules for this repo

Orientation for agents and humans changing `parlor`. The operating contract
lives in `moon/PLAN.md` (§1 manager-worker, §3 test doctrine); this file is the
parlor-specific part.

## What this repo is

The cafaye app shell. Phase 1 is deliberately thin: app router + Tailwind v4 +
theme tokens + health surfaces + test rig. If you are looking for login,
signup, dashboard, admin or shadcn/ui, you are looking for Phase 2 — it is not
missing, it is a later packet.

## Setup

```sh
./bin/prime      # npm ci + npm test
mise install      # node version from mise.toml
```

- Node is pinned in `mise.toml` (22.22.2 — the floor jsdom@30 demands; bump
  the pin rather than downgrading the test rig). Do not add an `.nvmrc` or a
  second pin.
- Install with `npm ci`, never `npm install` — the lockfile is the contract.
- Wrap long/networked commands in `timeout N` (`timeout 600 npm ci`).
- `npm run typecheck` must pass **without** a build: `rm -rf .next` and check.
  Layout props are typed explicitly rather than with Next's generated
  `LayoutProps`, precisely so a fresh clone can typecheck.

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
- No snapshots for behavior. No `waitFor` unless you are waiting on something
  async; the shell is synchronous by design.
- Flakes: attribute before fixing. If a test fails, can your diff reach that
  surface? Measure a clean HEAD before you loosen anything.

## Theme

- `src/styles/tokens.css` is the **only** place theme values live.
- Components use Tailwind utilities (`bg-surface`, `text-muted`,
  `text-cafaye-500`). Never a raw hex, never a `style={{ color }}` inline.
- The cafaye palette is a **placeholder** ramp. Do not treat it as brand, and
  do not sprinkle brand decisions across components — change tokens.
- Semantic layer (`--color-surface`, `--color-muted`, `--color-border`) is what
  components should reach for; the raw ramp is for tokens and accents.

## Health surfaces

- `/healthz` — liveness. Never checks a dependency; a slow upstream must not
  get the process restarted.
- `/readyz` — readiness. `deps: "none"` is a reserved placeholder string that
  becomes an array when Phase 2 wires real dependency checks. Keep the response
  keys stable: the platform contract reads them.
- Both are `no-store`. If you change either shape, change the tests and
  `cafaye.yml` in the same commit.

## Layout

```
src/app/            routes: page, healthz/route.ts, readyz/route.ts, layout.tsx
src/styles/         tokens.css — the theme
src/components/ui/  primitive barrel (empty until Phase 2)
src/test/           vitest setup file
```

- App Router conventions: `page.tsx` per route, `route.ts` per endpoint, layouts
  at the top. Server components by default — add `"use client"` only for
  something that genuinely needs interactivity.
- Route handlers export named HTTP verb functions (`export function GET()`), no
  default export, no class instances.
- `src/components/ui/index.ts` is an empty barrel on purpose. Phase 2 installs
  shadcn/ui into that directory: one component per file, named exports,
  re-exported from the barrel.

## Dependencies

Adding a dependency needs manager approval (PLAN.md §5). No shadcn install, no
state library, no chart library in Phase 1 — if a screen needs one, that is a
Phase 2 packet.
