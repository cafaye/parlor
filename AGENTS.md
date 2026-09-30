# AGENTS.md — working rules for this repo

Orientation for agents and humans changing `parlor`. The operating contract
lives in `moon/PLAN.md` (§1 manager-worker, §3 test doctrine); this file is the
parlor-specific part.

## What this repo is

The cafaye app shell. The shell itself is thin — app router, Tailwind v4, theme
tokens, health surfaces, test rig — and the auth screens sit on top of it:
`/register`, `/login`, and a session-aware header. If you are looking for a
dashboard, settings, admin or shadcn/ui, you are looking at a later packet.

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
`POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`, `GET /v1/me`. Base
URL from `NEXT_PUBLIC_IDENTITY_URL` (default `http://localhost:8080`).

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
  becomes an array when a dependency check is wired in. Note that parlor now
  calls identity, and *that* has not been done yet — a real check is its own
  packet, because a slow identity must not necessarily mean "not ready", and
  that is a decision rather than a default. Keep the response keys stable: the
  platform contract reads them.
- Both are `no-store`. If you change either shape, change the tests and
  `cafaye.yml` in the same commit.

## Layout

```
src/app/            routes: page, login/, register/, healthz/, readyz/,
                    providers.tsx — the client provider stack, mounted by layout
src/lib/            identity.ts (contract), token-store.ts, auth.tsx (session)
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
- `src/components/ui/index.ts` is the single import path for primitives. Button,
  Input and Field are hand-rolled now and shadcn replaces them in place; call
  sites do not move.
- `Field` owns the label / description / invalid wiring. Do not hand-wire
  `aria-describedby` at a call site — that is how a screen reader ends up
  announcing "invalid" and dropping the reason.
- A button's accessible name does not change when it becomes busy. It goes
  `disabled` + `aria-busy`; a control that renames itself mid-interaction loses
  its own label for anyone navigating by name.

## Dependencies

Adding a dependency needs manager approval (PLAN.md §5). No shadcn install, no
state library, no chart library — if a screen needs one, that is a packet.
`@tanstack/react-query` is approved and installed. There is no `clsx` and no
`tailwind-merge`: `src/lib/cx.ts` is the whole of what that problem needs.
There is no `@testing-library/user-event`; `fireEvent` from the already-installed
`@testing-library/react` is what the house uses.
