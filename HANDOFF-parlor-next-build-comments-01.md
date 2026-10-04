# HANDOFF — parlor-next-build-comments-01

Twelve comments in `src/` and `bin/prime` argued from a tool this repository no
longer runs. All twelve are now either true of this tree or gone. Four commits,
no behaviour changed, `./bin/prime` exits 0.

```
5a57bbb  bin/prime: the build's justification named a tool this tree no longer runs
a2ebeb3  the BFF route: `next build`, a 405 the framework does not send, two inert exports
b28a1c2  the client-boundary trio: a check that argued it was standing in for a compiler
7701adb  the two clients and the bundle test: name the mechanism this build actually has
```

## The one fact everything turned on

`package.json` `scripts.build` is `vite build`. There is no `next build`, no
`.next/`, no `next start`. And the hazard the Next-era comments were really
about still exists under a different name:

* Vite substitutes a variable into client code only through `import.meta.env`
  (its `envPrefix`, `VITE_` by default) or an explicit `define` in the config.
* `vite.config.mts` declares **neither** a `define` nor a widened `envPrefix`.
* `grep -rn "import.meta.env" src/` returns **nothing**.

So the claim "the addresses are not in the client bundle" is true here — and
true for a stronger reason than the one it replaced.

## Comments corrected, and what grounds each

### `bin/prime` — the build's justification (`bin/prime:13-28,30-41,50-52`)

The header said the build is in the local gate because
`src/components/ui/feedback.tsx` called four hooks with no `"use client"`
directive, and that "the only thing that catches it is `next build`". Both halves
were stale.

* `feedback.tsx` is hook-free. `src/components/ui/client-boundary.test.ts:383`
  asserts exactly that: `expect(feedback, "Callout's file must stay
  hook-free").not.toMatch(/\buse[A-Z]\w*\s*\(/)`.
* `vite build` enforces no server/client split, so it cannot raise that error.
  What catches it is the source scan in `client-boundary.test.ts`, in the suite.

The reasoning underneath survives for the build generally, and is now written
against two things that are measurable: the `copyFontFiles` header in
`vite.config.mts` (a build that printed sixteen lines about an unresolved
`./files/geist-*.woff2`, emitted a stylesheet pointing at a directory the build
never creates, and left a 404 on every font request while every test passed), and
`package.json` `scripts.start` → `server/index.mjs` → `dist/server/server.mjs`,
an artifact only the build produces. The cafaye/site history paragraphs are
untouched.

### `src/app/v1/[...path]/route.ts` — five claims

1. **`:41-47`, the `NEXT_PUBLIC_`/`next build` claim.** The brief's clearest
   example, and it was wrong twice. Rewritten against the vite mechanism above.
   The argument — *a value the browser can read is a value the browser can
   change, and for a forwarder that is the difference between a fixed
   destination and an attacker's* — is kept intact and now points at
   `route.test.ts`'s byte search of `dist/client/assets` and at
   `tests/validate-ci.sh`'s standing `NEXT_PUBLIC_` refusal.
2. **`:8`, "`next.config.ts` can express the same routing in four lines."** The
   equivalent tool exists and is also code: `createMiddleware({ type: "request" })`,
   exported from `@tanstack/react-start`, taking the `Request` and a `next`
   function (`RequestServerNextFn`,
   `node_modules/@tanstack/start-client-core/dist/esm/createMiddleware.d.ts`).
   The three limits that reject the shape are unchanged.
3. **`:79-89`, `export const dynamic` stops Next prerendering.** Inert.
   `grep -rn "force-dynamic" node_modules/@tanstack/` → no reference; no
   `revalidate` reference either. What actually prevents a frozen `/v1/me` is
   written in its place: `@tanstack/start-plugin-core/dist/esm/prerender.js`
   gates the whole pass on `if (startConfig.prerender?.enabled)` and this tree
   configures none; and `createStartHandler.js` sets the terminal handler per
   `Request`.
4. **`:94-102`, "a 405 from the framework … `OPTIONS` is never answered."**
   Wrong, and measured rather than argued — see Findings below.
5. **`:120-124`, "Next's catch-all context, `params` is a Promise."** It is a
   plain object: `createStartHandler.js` builds it with
   `Object.assign(Object.create(null), ctx.params)`, keyed `_splat`. The type and
   the `await` are left exactly as they are — that is a signature, not a comment.

### `src/components/ui/client-boundary.test.ts` — `:10,52,98,304`

The header described a check standing in for a compiler (`next build` catches it,
jsdom cannot, the cost is hydration JavaScript). It now says what the file
checks: the correspondence between "calls something shaped `useX(`" and "starts
with `"use client"`", in both directions, plus the test that names
`feedback.tsx` and `confirm-dialog.tsx` by hand. The directive is described as a
**marker**, not a switch — which is what it is here.

The historical failure is kept as the reason the marker exists: the real
compiler error, and the trap in reading it literally.

### `src/components/ui/feedback.tsx:21` and `confirm-dialog.tsx:21`

Same correction, plus a fix neither was in the audit's list for: both named
**`no-hooks-without-use-client` in `tests/validate-ci.sh`** as the check keeping
the split honest. `grep -n "no-hooks-without-use-client" tests/validate-ci.sh`
is **empty** — the check is `src/components/ui/client-boundary.test.ts`, which is
not in `tests/validate-ci.sh` at all. Both comments now point at the file that
exists and record what the old name no longer resolves to.

### `src/lib/upstream.ts:11` and `:42`, `src/lib/identity.ts:35`

Same mechanism restatement. The `NEXT_PUBLIC_*` history is kept and labelled;
the live security argument is kept verbatim and now names `import.meta.env`.

### `src/app/v1/[...path]/route.test.ts:11, 89`

`:11` explained the assertion by a `NEXT_PUBLIC_` prefix "would inline the value
at build time". Restated for vite, **and the `SERVICE_ENV_VARS` name list left
alone on purpose** — it still searches for `NEXT_PUBLIC_` so a value that was
ever inlined cannot return quietly. `:89`'s account of the first version of that
file skipping its bundle assertions was reworded away from `.next/static`.

### One file the audit did not list

`src/routes/v1/$.ts:27-29` carries the identical false 405 claim about the
identical code path. Correcting `route.ts` and leaving it would have put two
contradictory statements about one mechanism four lines apart. Same correction.

## Findings — not tasks. Nothing below was changed.

### 1. An unnamed method is answered 200 with the app shell, not 405

Measured against a built server (`npm run build`, `PORT=16739 node
server/index.mjs`, one `curl -X <method>` per verb on `/v1/me`):

| method | status | where it came from |
|---|---|---|
| GET | 502 | the forwarder — identity was not running |
| POST / PATCH / DELETE | 405 + `allow: GET` | the forwarder's own per-route refusal (`upstream.ts:491`; `/v1/me` is a GET route) |
| **PUT** | **200, `text/html`** | **the SSR renderer — the rendered app shell** |
| **OPTIONS** | **200, `text/html`** | **the SSR renderer — the rendered app shell** |

`createStartHandler.js:496` reads `handlers[METHOD] ?? handlers["ANY"]`. With no
`ANY` declared, an unnamed method leaves the terminal handler as the SSR
renderer, which answers the matched route — and this route declares no
component, so what comes back is the document `__root.tsx` renders.

**This is not an open proxy and not a CORS hole**, and both properties survive on
grounds that hold:
* an unnamed method never reaches the forwarder, so it can never reach an
  upstream — that is structural, not a status code;
* no response from this app carries an `Access-Control-*` header, which
  `upstream.test.ts` already proves by reading every response header name, and a
  cross-origin preflight needs one.

But the comment claimed a 405 that the framework does not send, and named that
405 as the thing making this a non-CORS endpoint. Both comments now carry the
measurement and the real mechanism.

### 2. `route.test.ts` has a test whose name overstates what it asserts

`it("is not statically renderable, because a frozen /v1/me is a session leak")`
asserts only that the **source text** contains two strings:

```ts
expect(source).toContain('export const dynamic = "force-dynamic"');
expect(source).toContain("export const revalidate = 0");
```

Nothing reads either export. So the test would pass unchanged if the property
were abandoned, and its name claims a behavioural guarantee it does not test. The
real guarantees are the two structural ones now written in `route.ts`. **Per the
brief I did not touch the assertion** — this is the finding, and it is a
one-line change to whoever owns the test.

### 3. `client-boundary.test.ts`'s second test is justified by a cost that does not exist here

`it("a file with no hooks does not declare itself a Client Component")` was
justified by "the cost lands on every user as hydration JavaScript for markup
that could have been sent as markup". That cost is not paid and cannot be:
`Callout` is hook-free and unmarked, and it is in the client bundle anyway —
`grep -l bg-positive-surface dist/client/assets/*.js` →
`dist/client/assets/ui-BseiPOyp.js`, because `login-form.tsx` and
`register-form.tsx` render it and both are client components. With no RSC split,
marking `feedback.tsx` would not keep `Callout` out of the browser.

**The test is still worth keeping** — it is what keeps the markers descriptive —
and I did not weaken it. But it is a marker check, not a bundle-size check, and
its failure message now says so rather than repeating a cost that cannot occur.

### 4. "Read at request time" is true of the bundle and not of the timing

`AGENTS.md`, this file's header, and `tests/validate-ci.sh` all say the addresses
are read "on the server, **at request time**". The read is
`process.env.IDENTITY_URL` inside `identityUrl()`, called at **module scope**
(line 74), so it happens once, when the module is first imported — an SSR server
caches modules. Both facts are safe; they are not the same claim, and
`route.test.ts` checks the bundle, never the timing. `route.ts` now records the
distinction. **A claim to re-check rather than a defect**, and not something to
change under a comments-only brief.

### 5. A path the audit missed, outside the assigned scope

`grep -rn "next build\|NEXT_PUBLIC_\|next.config"` over the tree still finds
Next-era prose in files this packet was told not to touch or that sit outside
the assignment:

* `cafaye.yml:90` — "it is a Next.js app"; `:186` — "The routes are Next.js App
  Router files". Both flatly false of this tree.
* `playwright.config.ts:53,62` — "a cold Next.js server", "Next.js and React log".
* `e2e/session.e2e.spec.ts:275`, `e2e/password-reset.e2e.spec.ts:95`,
  `e2e/email-verification.e2e.spec.ts:92` — "Next.js renders its own
  `role="alert"` route announcer".
* `e2e/docker-compose.yml:399-400,422`, `config/deploy.yml`,
  `account_scope.yml:46`, `caf.dev.json:22`, `tests/validate-ci.sh` — all either
  correct history or prose that already says "the previous framework".

`cafaye.yml` is the one worth a packet: it describes the service to other people
and two of its lines are wrong. Untouched here — not in scope, and the brief
named a dozen claims, not this tree.

## Verification

```
./bin/prime                 exit 0
  npm ci                    (the gate's own first step)
  npm test                  Test Files 31 passed (31) · Tests 755 passed (755)
  npm run typecheck         clean, with dist/ removed first
  npm run build             ✓ built in 150ms
  validate-ci.sh --self-test 47 checks declared, 47 passed, 0 failed, 0 skipped
                            self_test: 52 breakages declared, 52 proven able to fail
```

No file's behaviour changed: comments and prose only. `git diff ce9bfa5 -U0 --
src | grep -vE "^[+-][[:space:]]*(\*|/\*|\*/|//|#)"` comes back with exactly one
kind of line, and it is worth being precise about it rather than rounding it to
"comments only": **the two `expect()` failure-message strings in
`client-boundary.test.ts`.** Those messages are what a human reads when the
suite goes red, and they were two of the twelve comments — one of them said the
file "fails `next build`". The assertions they belong to are untouched: both are
still `expect(offenders, …).toEqual([])`, same variable, same condition. No test
was added or removed and no test name changed — the vitest count is the 755 that
was already declared, above `gate.yml`'s floor of 727. Everything else in the
diff is a comment line, `bin/prime`'s changed lines included (all `#`).

The gate's `47 passed` and `52 proven` are the *passed* figures on a machine
where `caf`, `shellcheck` and `docker` are all present. Per `AGENTS.md` those
two numbers are machine-dependent; the declared totals are what mean the same
thing everywhere.