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