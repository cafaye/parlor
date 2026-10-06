# HANDOFF — W4: the two failing end-to-end tests

**Worker:** W4 · **Branch:** `worker/w4-e2e` · **Repo:** `parlor-w4-e2e`
**Outcome: the packet is NOT complete. Neither of the two target tests was
fixed, because neither could be run, and I did not guess at a fix without a
red test.** Read §1 before reading anything else.

---

## 1. The blocker, and it is the whole reason

**The end-to-end tier cannot be brought up in this worktree.** Not a slow start,
not a flake — the stack refuses to start because the fleet's sibling checkouts
are not here. Real output:

```
$ timeout 900 ./bin/e2e-stack up
[e2e] FAIL: the initdb bind source /Users/kaka/Code/any/wt/kit/templates/compose/postgres/initdb does not exist. It is a ../kit checkout: docker compose mounts a missing bind source as an EMPTY DIRECTORY rather than failing, so a healthy cluster would come up with no roles and no isolation. Check out cafaye/kit beside this repository.
EXIT:1
```

What is actually beside this worktree:

```
$ ls ~/Code/any/wt/
billing-w3-checkout   identity-w2-authgaps   kit-w1-onecluster   parlor-w4-e2e
```

`bin/e2e-stack` resolves all four siblings against `$ROOT/..`, and only two of
them exist at all, under worker-specific names:

| required | present? |
|---|---|
| `../kit` | no — `kit-w1-onecluster` |
| `../identity` | no — `identity-w2-authgaps` |
| `../gateway` | **no — no copy anywhere on this machine** |
| `../oauth-stub` | **no — no copy anywhere on this machine** |

So this is not a naming problem I can symlink past. `gateway` and `oauth-stub`
are required by `publish_siblings`, by `READY_SERVICES` (both are in it), and
therefore by `up`. Docker (29.4.0), Playwright's browsers and `goose` are all
present and fine — the missing pieces are two repositories.

**Consequence, stated plainly: I have no run of `e2e/session.e2e.spec.ts` or
`e2e/design-system.e2e.spec.ts`, so I make no claim that either test passes,
and neither claim should be inferred from this document.** The brief's rule —
never claim a passing test without the run behind it — is why this packet ends
without the two fixes rather than with two confident-looking commits.

## 2. What I did do

### 2.1 `npm ci` — done, exit 0

```
$ timeout 900 npm ci
added 374 packages, and audited 375 packages in 6s
EXIT:0
```

Warm npm cache, so it was not the long step the brief anticipated. Node 22.22.2,
matching `engines.node`.

### 2.2 Baseline, before any change

```
$ timeout 900 npm test
 ❯ src/routes/v1/auth/oauth/$provider/callback.test.ts (10 tests | 1 failed)
   × is delegated to the forwarder rather than rendered
 Test Files  1 failed | 34 passed (35)
      Tests  1 failed | 831 passed (832)
```

**The pre-existing failure, unrelated to this packet:**

```
AssertionError: expected 404 to be 502 // Object.is equality
 ❯ src/routes/v1/auth/oauth/$provider/callback.test.ts:223:41
```

A programmatic (non-document) request to the OAuth callback is expected to be
delegated to the forwarder and to answer 502 when identity is unreachable; it
answers 404, meaning it never reached the forwarder at all. Given the most
likely recent cause (§3) this is probably the same family of problem, but it is
a **different packet** and I did not touch it. Reported here so the manager
does not read it as something W4 introduced.

### 2.3 `ConfirmDialog`: the keyboard contract, now asserted where it can run

This is the one piece of real, committed work.

`ConfirmDialog` is hand-built — `<div role="dialog">`, not
`HTMLDialogElement.showModal()`, for the documented reason that jsdom does not
implement the native one. Its own header says *"the trap below is ours, and ours
is a thing that can be wrong."* The whole-stack tier is the only thing that
asserts the trap, and it cannot run here. So I read the component and then
wrote the contract down where the per-commit gate can execute it:

**New: `src/components/ui/confirm-dialog.test.tsx`, 5 tests, all passing.**

- focus lands on **Cancel** when the dialog opens;
- **Escape** closes it **and returns focus to the opener**;
- **Tab** wraps last → first, **Shift+Tab** wraps first → last;
- **Escape is inert while the confirm is in flight.**

```
$ timeout 300 npx vitest run src/components/ui/confirm-dialog.test.tsx
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

These pass against the code as it stands. **That is the finding, not a
non-finding:** `ConfirmDialog`'s own keyboard logic is correct, so the design-
system e2e failure is *not* in the dialog. It is upstream of it — see §3.

`gate.yml`'s vitest floor went `832` → `837` in the same commit, as AGENTS.md
requires ("adding a test means raising `minimum:` in the same commit").

### 2.4 After

```
$ timeout 600 npm test
 Test Files  1 failed | 35 passed (36)
      Tests  1 failed | 836 passed (837)

$ rm -rf dist && timeout 600 npm run typecheck
TYPECHECK_EXIT:0
```

**Before → after: 832 → 837 tests; 831 → 836 passing; failures 1 → 1 (the same
one, §2.2).** So "the rest of the suite is no worse" is a measurement, not a
claim. Typecheck passes with `dist` removed, per the rule that it must not need
a build.

## 3. Where I think both failures actually live — with evidence

Both failing tests fail on the **same shared surface**: the first assertion each
one makes that needs a *signed-in* `/accounts` screen.

- `e2e/session.e2e.spec.ts:173-186` — header "Accounts" link → `/accounts` → list with one row.
- `e2e/design-system.e2e.spec.ts:425-431` — nav "Main" → `/accounts` → list with one row → into the account → `region "Account"`.

Neither gets to its dialog / reload assertion if that surface does not render.
That is a coherent single-cause story, and it fits the history: the last commit
before these tests were written is the Next.js → **TanStack Start** migration,
and `HANDOFF-parlor-tanstack-start.md` says, in its own successor list:

> `./bin/e2e` against a real identity — **the tier that would catch a sign-in
> completing and then not surviving a reload.**

i.e. **the migration was never run against the tier, and these two tests are very
probably the bill for that.** I audited the session path for anything I could
prove by reading (`src/lib/auth.tsx`, `src/lib/token-store.ts`,
`src/lib/accounts.ts`, `src/app/providers.tsx`, `src/components/shell/header.tsx`)
and found no defect I was willing to call a bug without a red test: the token is
in `localStorage`, it is the React Query key, `deriveSession` distinguishes
loading / anonymous / authed, `useAccounts` is `enabled: token !== null`. The
router's generated tree does contain both `/accounts/` and `/accounts/$accountId`.

### 3.1 A second finding, and it is a *test* defect — reported, not edited

`e2e/session.e2e.spec.ts` says it is testing a page load:

```
163  // A navigation, not a client-side link swap. This is the assertion that the
164  // token is in storage and that the session it names is still good: a new
165  // document, a fresh React Query cache, a fresh GET /v1/me.
173  await header(page).getByRole("link", { name: "Accounts" }).click();
```

**That is not what the code does.** `header.tsx:63-69` renders `NavLink` as
TanStack's `<Link>`, so the click is a client-side navigation: same document,
same React Query cache, and with `staleTime: Infinity` (`providers.tsx:50`)
**no fresh `GET /v1/me` at all** — the cached user is served. The file's only
real `page.reload()` is at line 234, which is in the *signed-out* direction.

So the test titled *"the session survives a page load"* never performs a page
load while signed in. Per the brief ("if you conclude a test is genuinely wrong,
that is a finding to report with evidence — not a silent edit") I am reporting
it rather than rewriting it, because fixing it changes what the tier proves and
that is the manager's call. The one-line fix, when wanted, is a real reload:
`await page.reload()` after reaching `/accounts`, asserting the header still
carries the address — **add it, do not replace** the navigation.

## 4. Decisions, and why

- **I did not fix either defect speculatively.** A green e2e suite is
  unreachable here, so any change I made could not be shown to fix anything.
  Writing a plausible-looking patch to `auth.tsx` and calling it done would be
  the exact failure mode this packet warns about, one layer up.
- **I did not touch `e2e/docker-compose.yml`.** The brief forbids it and it is
  owned elsewhere.
- **I did not relax, skip, re-time or delete an assertion** to make anything
  green. Nothing in `e2e/` changed at all.
- **I committed passing tests rather than a risky fix.** The new file is
  regression cover for exactly the property the packet names, it runs in a
  second in the per-commit gate, and it costs nothing if the successor
  disagrees with my diagnosis. It is the largest honestly-verifiable unit of
  this packet.
- **The pre-existing `callback.test.ts` failure was left alone.** Different
  packet; touching it would widen the blast radius and hide a real signal behind
  an unrelated green.

## 5. What I deliberately did NOT do, and why

- **Did not write the sibling checkouts myself, or `git clone` them.** Two
  reasons: the brief forbids spawning agents/processes that do independent work
  and the hour was not there; and more importantly `gateway`/`oauth-stub` at a
  pinned ref is exactly the kind of thing that silently turns the tier into a
  different tier than it claims. `oauth-stub` is **pinned to `v0.1.0`** for a
  documented reason (a fixture that moves under the harness changes what a green
  run means). Provisioning those four repos is a decision for the manager.
- **Did not add a `test.skip`, a `retries`, a `timeout`, or a `waitForTimeout`**
  anywhere.
- **Did not rewrite the session spec's navigation.** §3.1 — reported with
  evidence, not silently edited.
- **Did not do a repo-wide sweep, cleanup, or component-library swap.**
- **Did not chase the `verify-email.index.tsx` filename**, which is not in
  AGENTS.md's route listing and looked odd for ~30 seconds. Not this packet, and
  I did not want to end the hour on an open question.
- **Did not run the full e2e suite at the end.** It cannot start; §1 is the real
  output of trying. Reporting a run that did not happen would be worse than
  reporting this.

## 6. Successor's first move

1. **Provision the siblings, or get a machine that has them.** `kit`, `identity`,
   `gateway`, `oauth-stub` beside the worktree (see `.github/workflows/e2e.yml`
   for the four `repository:` lines, and `bin/e2e-stack`'s `SIBLING_SERVICES`).
   Nothing else in this packet moves until that is done.
2. **Get the two failures' actual output**, then check it against §3: does each
   one die on the first signed-in `/accounts` assertion, or somewhere later? That
   single question splits "one shared root cause behind the migration" from "two
   unrelated bugs", and it is worth two minutes before editing anything.
3. **Run the new file first** — `npx vitest run src/components/ui/confirm-dialog.test.tsx`.
   If it is still 5/5, `ConfirmDialog` is exonerated and the dialog bug is
   upstream, exactly as reported here.
4. Then §3.1: add a real signed-in `page.reload()` to the session spec. Do not
   remove the navigation assertion.

**Currently-failing command, verbatim, for whoever picks this up:**

```
$ timeout 900 npm test
 Test Files  1 failed | 35 passed (36)
      Tests  1 failed | 836 passed (837)
 FAIL  src/routes/v1/auth/oauth/$provider/callback.test.ts > a programmatic request to the callback > is delegated to the forwarder rather than rendered
AssertionError: expected 404 to be 502 // Object.is equality
```
---

# HANDOFF — W4b: the blocker is gone, one defect was real, one was never real

**Worker:** W4b · **Branch:** `worker/w4-e2e` · **Repo:** `parlor-w4-e2e`
**Commits:** `bdce1cf`, `ada16ab`, `bf676a2` (on top of `b844144`).
**Outcome: the whole tier now runs. 25 of 26 pass. The one remaining failure
is in `identity`, measured at the SQL, and this repository may not fix it.**

| | before | after |
|---|---|---|
| tier bring-up | impossible (§1 of the report above) | `./bin/e2e`, 59s |
| whole tier | never measurable | **26 tests: 25 passed, 1 failed, 0 skipped, 0 retried** |
| the two target specs (9 tests) | 4 passed, 5 failed | **8 passed, 1 failed** |
| `e2e/session.e2e.spec.ts` | 0 passed, 3 failed | **3 passed, 0 failed** |
| `e2e/design-system.e2e.spec.ts` | 4 passed, 2 failed | 4 passed, 1 failed |
| vitest | 836 passed / 1 failed of 837 | **836 passed / 1 failed of 837 (unchanged)** |
| `gate.yml` vitest floor | 837 | 837 — still matches reality, no edit needed |

## 1. The blocker was one character wide

The manager's symlinks were correct. What was left was a harness bug that had
nothing to do with worktrees being absent:

```
$ ./bin/e2e-stack up
[e2e] FAIL: no git checkout of identity at /Users/kaka/Code/any/wt/parlor-w4-e2e/../identity
       — ../identity is not a repository
```

`../identity` IS a repository. It is a **linked worktree**, and in a linked
worktree `.git` is a *file* — one line naming the real gitdir — not a directory.
`bin/e2e-stack` asked `[ -d "$dir/.git" ]` in three places (`sibling_revision`,
`verify_sibling_image`, `verify_sibling_images`), and all three answers were
wrong about a perfectly good checkout.

Fixed in `bdce1cf` with one helper and `-e`. It was not cosmetic:

* `sibling_revision` **dies**, so `publish-siblings` cannot name a source at
  all — the whole tier is unreachable from a `wt/` directory, which is what every
  worker session on this fleet is;
* `verify_sibling_image` takes its "no checkout beside this repo" branch and
  reports a sibling as attributable **on its stamp alone** — the silent
  weakening this script's own header warns about, arrived at by accident.

Measured: `up` goes from that `FAIL` to the whole stack ready, and
`sibling origins: 3/3 attributable, 3 verified against a checkout in ../`
(three, where before it would have been two).

`.github/workflows/e2e.yml:246` already spelled the same check `-e`. The two
disagreeing is how this survived.

## 2. The defect that was real: nothing hydrated, anywhere

With the stack up, the two target specs failed **5 of 9** — and not where the
report above predicted. They failed at `/register`, on
`expect(getByRole('status'))`, having never submitted a form.

One Playwright session, listening to the page, said why:

```
[pageerror] n.AsyncLocalStorage is not a constructor
```

`src/start.ts` declares `createStart()`, so the framework compiles it into the
**client** entry as well as the server one. It imported `@/lib/telemetry` at
module scope and called `install()` there. So the whole OpenTelemetry SDK was
compiled into `dist/client/assets/index-*.js`, and the browser ran the provider
setup on load. `AsyncLocalStorageContextManager` is `node:async_hooks` behind
`new n.AsyncLocalStorage`, and no browser has one. The throw happens while the
entry chunk is still evaluating, so **nothing hydrates**: the SSR'd HTML is
there, every link works, and no form submits, no dialog opens, no button ever
becomes busy. Confirmed in the built artifact before the fix — the client entry
carried `AsyncLocalStorage`, `OTEL_SDK_DISABLED` and the literal `telemetry off`.

This is why the two target specs shared a surface, and it is why
`ConfirmDialog` looked guilty: it was never reached. The three session specs and
the busy-button spec were all the same bug wearing four hats.

**The fix uses the framework's own enforcement, not a comment** (`ada16ab`):

* `telemetry.ts` → `telemetry.server.ts`. That filename is one of the two
  `serverOnly` markers `@tanstack/react-start`'s import-protection plugin reads.
  Measured: with the static import still in `start.ts`, **the build fails** and
  names `src/start.ts:31` — the rule is doing work, and the fix had to satisfy
  it rather than explain it.
* `start.ts` reaches it through `await import()` inside the `.server()`
  middleware body — which the plugin already strips from the client build — and
  calls `install()` immediately before opening the span rather than at module
  scope. `install()` is idempotent, so per-request is free.

After: no client chunk contains any of those three strings, and telemetry is its
own server chunk (`dist/server/assets/telemetry.server-*.mjs`). The client build
drops 2.5M → 2.4M for zero functionality, which is the honest size of what was
being shipped to every browser.

**Why nothing caught it.** jsdom has no `node:async_hooks`, and
`src/lib/telemetry.server.ts` is not in the jsdom module graph, so
`npm test` was 836/837 green throughout, and `ConfirmDialog`'s five unit tests
passed at every commit in this report. The unit tier cannot see a module that
only exists in a browser bundle.

## 3. The defect that was NEVER real: the session survives a page load

The report above (§3.1) was right that `session.e2e.spec.ts` was not doing what
it claimed, and its §6 step 4 is what `bf676a2` does. The header link is
TanStack's `<Link>` (`header.tsx:63-69`), so the click was a client-side
navigation: same document, same React Query cache, and `staleTime: Infinity`
means `/v1/me` is not called again. The file's only `page.reload()` was in the
signed-**out** direction.

Corrected, and **added rather than substituted** — the client-side transition is
still worth asserting and this file is the only place that does:

```
$ npx playwright test e2e/session.e2e.spec.ts
  3 passed (2.8s)
```

So the answer to the packet's question is: **the underlying defect was not real
— the bug was entirely in the test, and in the app not hydrating at all.** A
real signed-in document load leaves the header naming the address and leaves
"Sign in" absent, and that assertion is sharper than it looks: `ShellHeader`
renders **neither** session control while a stored token is being exchanged, so
a header that had not finished re-deriving the session against a live
`GET /v1/me` could not pass either.

**The red proof, and what it does not establish.** With
`token-store.ts`'s `storage.getItem` stubbed to `null`, the spec goes red at the
signed-in header assertion — at `signIn` (line 106), *not* after the reload. So
it proves the stored token is load-bearing, not specifically that the new reload
line asserts something a navigation would not. A sharper proof (break only the
*second* `/v1/me`, the one the reload forces) was not run; the hour was over.
The non-vacuity of the reload rests on run 1 above — with the app dead, nothing
on the tier could pass — and on the fact that a fresh document empties the React
Query cache by construction.

## 4. What is still red, and it is not in this repository

`e2e/design-system.e2e.spec.ts:399` — "the account's destructive actions are
confirmed, and the dialog is keyboard-only operable". It now gets all the way to
the account screen and finds:

```
- heading "Account not found" [level=1]
- paragraph: We could not find that account.
```

Not the dialog, and not a keyboard problem. The account screen 404s. Measured,
with `curl` and no browser in the way:

```
$ curl -s localhost:16000/v1/accounts -H "authorization: Bearer $TOK"
[{"id":"d6c3445d-…","name":"probe-…","personal":true,"role":"owner", …}]

$ curl -s localhost:16000/v1/accounts/d6c3445d-… -H "authorization: Bearer $TOK"
404 {"detail":"no such account is visible to you"}
```

and the same 404 **against identity directly** (`localhost:16080`), with the
exact id identity itself returned. It is identity's bug, not the forwarder's.

**Root cause, to the line.** `internal/accounts/service.go` (identity `master`,
which is what `publish_siblings` builds):

* `Service.ListMine` — `GET /v1/accounts`, which works — opens a transaction and
  calls `tenancy.BeginUser(ctx, q, userID)` first. Its own comment explains
  exactly this: without it the RLS policy on `account_users` matches no rows and
  the answer is `[]` for a user who owns an account.
* `Service.Get` — `GET /v1/accounts/{id}` — reads `store.Member` on
  `s.read.Queryer()`: **no transaction, no `BeginUser`**. The policy
  `account_users_cafaye_members` is `user_id = (select cafaye.current_user_id())`,
  so with the GUC unset the membership row is invisible, `Member` maps `no rows`
  to `ErrNotAMember`, and `writeTenancyError` renders the deliberate 404.

The row is there — `select account_id, user_id, role from account_users` shows
`(d6c3445d-…, d0181927-…, owner)` — and the policies are as quoted. Every
`requireAccountRole` route reads the account this way, so account detail, the
member list and both destructive actions are all behind it. **This is
`identity`'s to fix, in `internal/accounts/service.go`, by giving `Get` the same
`BeginUser` seam `ListMine` has.** Nothing in this repository can move it, and
`GET /v1/accounts` cannot substitute: the destructive actions live behind the
account screen.

## 5. What I deliberately did NOT do, and why

- **Did not weaken, skip, re-time or delete the one red assertion.** The only
  way to make that spec green is to assert less about the dialog, which is
  precisely the regression the brief names. It stays red and says why.
- **Did not work around identity's 404 in parlor.** Fetching the account out of
  `GET /v1/accounts` and rendering the screen from a list response would make the
  spec green and would be a lie about the contract, in the repository that is
  *not* where the defect is.
- **Did not edit `e2e/docker-compose.yml`.** And did not edit `bin/e2e-stack`
  beyond the `.git` spelling that was blocking the tier — no port, timeout,
  retry or readiness change.
- **Did not add a sleep, a `waitForTimeout`, a `test.skip`, a `retries` value or
  a longer expect timeout anywhere.**
- **Did not touch the pre-existing `src/routes/v1/auth/oauth/$provider/callback.test.ts`
  failure** (`expected 404 to be 502`, 836/837 before and after). It is a
  different packet; the stack may well have an answer to it now that the tier
  runs, and that is worth more than a speculative edit from here.
- **Did not chase `verify-email.index.tsx`** in the built assets, which the
  report above also declined to chase. Still unexplained, still not this packet.
- **Did not run the two target specs as the last word.** The numbers above are
  the whole tier (`./bin/e2e`), because a filtered run trips the tier's own
  `MINIMUM_TESTS` floor in the global teardown — which is the guard working, not
  a failure of the specs.

## 6. Successor's first move

1. **Fix `identity`'s `Service.Get`.** Give it the `tenancy.BeginUser` call
   inside a transaction that `ListMine` already makes, then re-run
   `./bin/e2e` from this worktree: the account-detail spec should go green with
   no change here at all. Nothing in `e2e/` or `src/` needs editing for it.
2. **Decide whether `bin/e2e-stack` should tolerate a re-`up` on a live volume.**
   `E2E_ALLOW_STALE_CLUSTER=1` exists and works, but `bin/e2e` does not pass it
   through, so a second full run in a session needs a `down -v` first. Fails
   loudly, so it is safe — just slow to work out.
3. **Consider a vitest floor on the client bundle.** The defect in §2 is exactly
   what a unit test cannot see, and `src/app/v1/[...path]/route.test.ts` already
   reads `dist/client/assets` for a service address. One more assertion there —
   no server-only module in a client chunk — would have caught it in CI.
