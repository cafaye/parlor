# HANDOFF: parlor tanstack-start-01 — the route tree is moved and the build is green; the render helper is not

Branch `worker/parlor-tanstack-start-01`. Continue in this worktree, on this
branch. Do not start the migration again; it is done and the reasons are on
record in the commits.

## WHAT THE PACKET WAS FOR

Take parlor off Next.js onto TanStack Start. Next.js gone — not wrapped, not
shimmed, not coexisting. `npm run dev` / `build` / `start` drive TanStack
Start. Behaviour-preserving: the same URLs serve the same screens, and the
existing suite still passes without being weakened to accommodate the new
framework.

## WHERE IT STANDS

Three commits on top of `9b770cb`:

    9701cbf  the whole route tree, declared — 15 routes, one per former Next file
    70ab975  recover(...)  — the manager's salvage commit, not mine
    69e8422  the build is green and typecheck is green, with the reasons on record

### Verified green

    timeout 200 npm run build
      dist/client/assets/index-*.css      31649 bytes, real Tailwind output
      dist/client/assets/index-*.js      304.58 kB │ gzip: 97.69 kB
      dist/server/server.mjs              69.45 kB │ gzip: 17.71 kB
      ✓ built in 266ms

    timeout 120 npm run typecheck
      zero errors

### Verified red

    timeout 300 npm test
      Test Files  13 failed | 17 passed (30)
           Tests  156 failed | 552 passed | 2 skipped (710)
          Errors  28 errors

No test was weakened, skipped, `.skip`ped or deleted to reach those numbers.
The 2 skips predate this packet.

## WHAT SERVES EACH FORMER ROUTE

    /                          src/routes/index.tsx
    /login                     src/routes/login.tsx
    /register                  src/routes/register.tsx
    /forgot-password           src/routes/forgot-password.tsx
    /reset-password            src/routes/reset-password.tsx
    /verify-email              src/routes/verify-email.tsx
    /verify-email/confirm      src/routes/verify-email/confirm.tsx
    /accounts                  src/routes/accounts/index.tsx
    /accounts/$accountId       src/routes/accounts/$accountId.tsx
    /invitations/$token        src/routes/invitations/$token.tsx
    /billing/plans             src/routes/billing/plans.tsx
    /billing/customers         src/routes/billing/customers.tsx
    /healthz                   src/routes/healthz.ts      — server handler
    /readyz                    src/routes/readyz.ts       — server handler
    /v1/$                      src/routes/v1/$.ts         — server handler

`src/app/**` still holds the page components and the three handler modules. That
split is deliberate and it is what kept 500+ tests unmoved: a route file is the
path, the document metadata and a one-line bridge, and the page below it is
still a plain default-exported function that render tests call directly.

## THE ONE FILE THAT HAS TO CHANGE NEXT

`src/test/support/render.tsx`.

The dominant failure, repeated across the failing suites:

    TypeError: Cannot read properties of null (reading 'isServer')
      at useLinkProps (node_modules/@tanstack/react-router/dist/esm/link.js:46:25)

`Link` reads the nearest route match off a router context.
`renderWithProviders` mounts `Providers` and nothing else, so every screen that
renders a link now throws. `src/router.tsx` already exports `getRouter()`, which
is the factory this app wants — one per mount, which is the rule `app/providers.tsx`
used to own with a `useState` initializer and which survives unchanged.

Wrap the rendered children in a `RouterProvider` built from `getRouter()`, and
give it a location that matches the route under test, or `useLinkProps` will
resolve no match and the failure will simply move rather than disappear.

Two things to watch, both of which the next person will otherwise rediscover:

- **The tests that mock `@/lib/navigation`.** Six suites stub
  `useNavigation()` and assert `push` was called. Those still pass without a
  router because they never render a `Link`. Adding a router must not change
  them; if it does, the mock stopped being a mock of one thing.
- **`identity.test.ts` replaces the global `fetch` with a throwing function**, to
  keep a render test from opening a socket. A `RouterProvider` that tries to
  load routes eagerly could trip that. Use `getRouter()`'s lazy defaults rather
  than a preloaded router.

## WHAT I DELIBERATELY DID NOT DO, AND WHY

### 1. `next` is still in `package.json`, and `next.config.ts` is still on disk.

The packet's goal says both must be gone. They are not, and the reason is
mechanical rather than a judgement call: removing them without regenerating
`package-lock.json` breaks `npm ci`, which is what `bin/prime` runs first. The
regeneration is `timeout 300 npm install` followed by a commit of the lockfile,
and I did not have the clock for a network install on a machine the packet warns
is shared and loaded. That command plus deleting `next.config.ts`,
`next-env.d.ts` and the `plugins: [{name: "next"}]` block in `tsconfig.json` is
the successor's second move. **`npm ci` must still pass afterwards** — do not
hand-edit the lockfile.

### 2. The `Dockerfile` still copies `.next/standalone` and runs `node server.js`.

The packet calls the Dockerfile part of this packet, not a follow-up, and it is
right that it is. It was not done, for two reasons.

First, the shape is now known and it is a three-line change:
`COPY --from=builder /app/dist ./dist`, and `CMD ["node", "dist/server/server.mjs"]`.
Second — and this is the part that should not be rushed — `bin/deploy-config`
runs the real kamal binary against `config/deploy.yml`, and CI's `build` job
asserts that the standalone output the Dockerfile copies exists. That assertion
is in `.github/workflows/ci.yml` and it currently asserts something that will no
longer exist. **Changing the Dockerfile without changing that assertion leaves
CI red in a way that looks like a migration bug.**

Keep: the pinned `node:22.22.2-slim` base, the non-root user, the healthcheck on
`/healthz`, and the "NO BUILD ARGS, AND THAT IS THE BFF" header, which is still
true — the BFF did not move, only the framework in front of it did.

### 3. `src/app/v1/[...path]/route.test.ts` still points at `.next/static/chunks`.

Its `beforeAll` runs `npm run build` and then byte-searches `.next/static` for a
service address. That is the right assertion and it is still the right
assertion; the path is wrong and the artifact is now `dist/client/assets`. The
assertion must be re-pointed, NOT weakened or skipped — it is one of the three
tests that keep `IDENTITY_URL` out of the browser, and the file's own comment
says the build is unconditional on purpose.

Also note the same file asserts `export const dynamic = "force-dynamic"` and
`export const revalidate = 0` are present in the handler module. Those are
Next's exports. The equivalent guarantee now is structural — a route that
declares `server.handlers` and no `component` — so this is a test that has to be
**rewritten to assert the new property**, not deleted. What must survive: a
`/v1/me` can never be answered from a build-time artifact.

### 4. `next/font/google` became `@fontsource`, and I did not verify the rendering.

`src/app/layout.tsx` used `next/font/google`, which fetched Geist at build time.
It is now `@fontsource-variable/geist` plus three static `@fontsource/geist-mono`
weights, imported from `src/app/globals.css`, with `--font-geist-sans` and
`--font-geist-mono` declared in `src/styles/tokens.css`. The stylesheet builds
and the family names are the same, but nobody has looked at a rendered page. If
the mono ramp looks wrong, that is the first thing to check — and note the
comment in `globals.css` says the mono faces are imported at 400/500/600 because
there is no variable cut of `@fontsource/geist-mono`. Verify that claim; it was
inherited, not measured.

### 5. No page was loaded in a browser, and `bin/e2e` was not run.

Not because it is slow — because there was no honest way to. The route tree
builds and typechecks, but nothing has confirmed that `/login` renders, that
hydration happens, or that `/v1/session` still forwards. `AGENTS.md` is
insistent that omitting `Scripts` yields a page that looks right in a
screenshot and is dead in the browser, which is precisely the failure a build
cannot see. `src/routes/__root.tsx` renders `<Scripts />`; that it is enough is
an assumption, not a measurement.

### 6. `src/router.test.tsx` was never written.

`src/router.tsx` and `src/lib/search-params.ts` both reference a
`src/router.test.tsx` that asserts every file under `src/routes/` appears in the
committed `routeTree.gen.ts` — the guard against a stale generated tree. It does
not exist. The comments promise a test that is not there, which is worse than no
comment, so either write the test or delete the two paragraphs that describe it.
The test is small: walk `src/routes/`, walk the committed tree, compare.

### 7. Residual Next vocabulary in paths

`src/app/**` still uses `page.tsx` and `[accountId]` / `[token]` directory names,
and `__root.tsx` imports `@/app/globals.css` and `@/app/providers`. None of it
affects behaviour and renaming it would touch a dozen relative test imports for
no functional gain inside the hour. It IS worth doing eventually — the point of
the migration is that the tree speaks one framework's vocabulary, and right now
`src/app` speaks the old one in the middle of a new tree. Flagged, not done.

## DECISIONS AND WHY

- **`src/routeTree.gen.ts` is committed.** CI typechecks before it builds and
  `tsc --noEmit` has to resolve `src/router.tsx`'s import on a clean checkout. A
  typecheck that needs a prior build is a typecheck nobody has run.
- **The three server routes declare no `component`.** A route with both a
  `server.handlers` entry and a component serves the handler and *then* renders
  into the same response. A forwarder's body is an upstream's bytes.
- **The three `robots: noindex` directives moved to `head().meta` on the same
  three routes** — the two that spend a credential from a query string and the
  one that carries a bearer token in a path segment. `/verify-email` is
  deliberately *not* one of them: it carries no credential in its URL.
- **`src/lib/navigation.ts` exists rather than a direct `useRouter()` per call
  site.** Six suites mock `next/navigation`; that module is gone. Mocking
  `@tanstack/react-router` wholesale would also replace `Link`. The mock has to
  stay a mock of one thing.
- **`@import "../../node_modules/tailwindcss/index.css"`.** Ugly, and honest. The
  bare specifier resolves in the client environment and not in the SSR one,
  because Vite's compat resolver takes a different branch there. The reason, the
  three fixes that do not work, and the dependency that probably should be added
  are all in `69e8422`'s message.
- **Route handlers were not rewritten, only re-hosted.** `healthz`, `readyz` and
  the `/v1` forwarder keep their bodies and their own tests. Only the wiring from
  "a `route.ts` the framework scanned for" to "`server.handlers` on a route the
  router knows" changed.

## WHAT SURPRISED ME

The CSS one. The migration's hard parts were the ones the packet predicted —
route params, `Link`, server handlers, the generated route tree. The thing that
cost real time was `@import "tailwindcss"` failing only in the SSR environment,
and it cost it because the error names neither PostCSS nor Vite nor Tailwind, and
because the obvious remedies (configure PostCSS explicitly, add the `style`
condition to the SSR environment) both do nothing. It needed reading Vite's
bundled `postcss-import.js` to find that Vite always unshifts its own importer
ahead of any configured plugin.

The other surprise is the shape of the test damage. 156 failures that all look
like one failure, in one helper, that nobody changed.

## FIRST MOVE, PRECISELY

1. Add a `RouterProvider` to `renderWithProviders` (`src/test/support/render.tsx`).
2. `timeout 300 npm test`. Expect the 156 to collapse. Triage what remains —
   each one is then a real assertion about behaviour rather than a missing
   context.
3. `timeout 300 npm install` to regenerate the lockfile, then delete `next`,
   `next.config.ts`, `next-env.d.ts` and the `"plugins": [{"name": "next"}]`
   block in `tsconfig.json`. Confirm `npm ci` still passes.
4. The Dockerfile and the `build` job's standalone-output assertion, together.
5. `bin/prime` is the manager's gate, not this list's. Do not run it repeatedly
   mid-flight.

## ON THE HOUR

This run went past its clock. Two transport failures in this packet cost
roughly twenty-five minutes of it — the second one landed immediately after the
build first went green, and the manager's `recover(...)` commit is what kept that
state from being lost. Everything above is verified or quoted from real output;
nothing in this handoff is inferred from a conclusion the previous worker drew.