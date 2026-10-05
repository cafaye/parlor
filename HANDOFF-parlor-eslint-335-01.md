# HANDOFF — parlor-eslint-335-01: 335 ESLint errors that had never been seen

**Branch** `worker/eslint-335-01` · **Base** `73f68bf` · **Six commits.** Nothing
pushed, nothing merged, no other worktree touched. `tests/validate-ci.sh` and every
floor in `gate.yml` untouched — see §7 for why the floors did not move.

**State, in one paragraph.** `ci (kit, node) / node` is green: **335 errors → 0**,
with no override, no inline disable, and no edit to `kit/lint/eslint.config.mjs`.
`bin/prime` is green (9m06s), `npm run typecheck` is clean on a tree with no
build, 781 tests pass, and both build targets emit what `Dockerfile` and
`wrangler.jsonc` need. Two of the fixes turned out to be **real defects** rather
than style (§5), and one of them — `String(record.challenge ?? "")` — would have
put the text `[object Object]` into a second-factor screen.

---

## 1. Reproducing the finding, because `npm run lint` did not reproduce it

The brief's numbers are right and they are checkable. The first thing this packet
did was measure the baseline, and it did **not** match the brief's table exactly:

```
$ npx --no-install eslint --config ../kit/lint/eslint.config.mjs . -f json
errors 332 fatal 3 total 335
```

335, matching CI exactly. But the brief's per-rule table sums to **248**, not 335,
because it omits the **second-largest rule in the tree**:

| count | rule | in the brief's table? |
|------:|---|---|
| 175 | `@typescript-eslint/require-await` | yes |
| **84** | **`@typescript-eslint/unbound-method`** | **no** |
| 21 | `@typescript-eslint/await-thenable` | yes |
| 20 | `@typescript-eslint/no-misused-promises` | yes |
| 11 | `@typescript-eslint/no-unnecessary-type-assertion` | yes |
| 5 | `@typescript-eslint/no-unsafe-member-access` | yes |
| 5 | `@typescript-eslint/no-unsafe-assignment` | yes |
| 4 | `@typescript-eslint/no-floating-promises` | yes |
| 3 | `no-console` | yes |
| 3 | *(parse errors)* | no |
| 3 | `@typescript-eslint/no-base-to-string` | yes |
| 1 | `@typescript-eslint/no-unsafe-argument` | yes |
| 1 | `@typescript-eslint/prefer-promise-reject-errors` | no |

**The missing 84 mattered more than the count.** It was the whole of one root
cause (§2), so a reader working from the brief's table would have started by
editing 175 `vi.fn(async …)` call sites and would not have known that a
**five-line change to one type declaration** was about to clear 84 more.

**`npm run lint` could not have found any of this**, and neither could a developer
who trusted it. It ran `eslint`, which found this repository's own
`eslint.config.mjs` — `recommended`, not `recommendedTypeChecked`, with
`no-explicit-any` demoted to a warning. CI never read that file; kit's job reads
its own:

```
kit/.github/workflows/ci.reusable.yml:1110
  run: npx --no-install eslint --config "$KIT_LINT_DIR/lint/eslint.config.mjs" .
```

and says so in the comment above it — *"ESLint run DIRECTLY, not `npm run lint` …
`npm run lint` is not a linter: it is whatever script the repository happens to
define."* `README.md` asserted the opposite ("`npm run lint` runs in the shared
`node` job, so there is no second copy of it here to drift"). That sentence was
false and is fixed. See §6.

**The reproduction harness is committed**, because a finding CI reports should be
one a developer can run before pushing: `./bin/lint` (and `npm run lint` is it).
It is kit's invocation with the config checkout done by hand — it populates
`.kit/lint` from a kit checkout beside the repository, and says which one it used.
`.kit/` is gitignored: kit's own config ignores `.kit/**`, and kit states the
config is not copied into a service repo.

---

## 2. `unbound-method`, 84 findings, one root cause — and the measurement first

Every one of the 84 was a call site doing something completely ordinary:

```
src/app/accounts/[accountId]/account-screen.test.tsx:129
  expect(identity.getAccount).toHaveBeenCalledWith(TOKEN, ACCOUNT_ID);
src/app/login/login-form.tsx:60
  const { login, pending } = useAuth();
src/lib/auth.tsx:129
  return useSyncExternalStore<TokenRead>(store.subscribe, store.get, …);
```

**The cause is a spelling.** `IdentityClient` declared its members with method
shorthand:

```ts
getAccount(token: string, accountId: string): Promise<AccountDetail>;
```

TypeScript reads that as a method with an implicit `this`. So reading one off its
object is "a method separated from its object", which is what
`@typescript-eslint/unbound-method` rejects — and the rule is right in general,
because a method that reads `this` and is called detached fails.

The runtime objects are object literals of arrow functions closing over
`transport` and `base`. **There is no object for a `this` to belong to.** The
method spelling asserts a binding that does not exist; the property spelling
states the truth and is the same type at run time.

I checked that in isolation before touching twenty files, because the whole claim
rests on it:

```
$ cat t.ts
type A = { get(): string | null };
type B = { get: () => string | null };
declare const a: A; declare const b: B;
export const r1 = a.get;
export const r2 = b.get;

$ npx --no-install eslint --config ../kit/lint/eslint.config.mjs t.ts
  4:19  error  A method that is not declared with `this: void` … @typescript-eslint/unbound-method
✖ 1 problem
```

**One finding between the two spellings, and it is on the method one.**

`IdentityClient`, `BillingClient`, `AuthValue`, `TokenStore`, `ConfirmDialogProps`,
`ErrorState`, `RoleChangeControl` and `Retry`'s inline prop type went to property
declarations holding function types. **84 → 0.**

This is a *better type*, not a suppressed rule: `createIdentityClient` returns
arrows, and the old declaration said otherwise.

---

## 3. `require-await`, 175 findings — 155 of them one pattern, and the rest were lying

The bulk is `me: vi.fn(async () => aUser())`, the mock for a client method whose
declared return type is `Promise<T>`. Dropping `async` and returning the bare value
breaks the type at every call site, so the promise has to be *spelled*:

```ts
- me: vi.fn(async () => aUser()),
+ me: vi.fn(() => Promise.resolve(aUser())),

- getAccount: vi.fn(async () => { throw anIdentityError(404, "not_found"); }),
+ getAccount: vi.fn(() => Promise.reject(anIdentityError(404, "not_found"))),
```

`Promise.reject` and **not** a bare `throw`: an `async` function's throw arrives
as a rejection, a plain function's arrives at the call. Every caller here is
`try { await … } catch`, so both work today — which is exactly why the difference
is worth writing down rather than discovering. (`no-misused-promises` would also
fire on the non-async alternative, which is the same fact seen from the other
side.)

### The version I wrote first was wrong, and the suite said so

The first attempt was a `resolving(value)` helper in `src/test/support/`, which
reads better and is *shorter* than what it replaced. It broke a test:

```
FAIL  account-screen.test.tsx > renaming > shows the renamed name in the heading
Expected element to have text content: Acme Ltd
Received:                            Acme Corp
```

`resolving(current)` captures `current` when the mock is **built**;
`async () => current` read it when the mock was **called**. That test's own
comment says it:

> *"A stateful stub: a real service returns the new name afterwards, so a
> `getAccount` that kept answering with the old one would be testing the stub
> rather than the screen."*

The helper made exactly that, and the test went red. Reverted. **A helper cannot
be both lazy and short**, and the lazy spelling is the correct one.

### Four render helpers were hiding 21 other findings

`renderResetPage`, `renderArrival`, `renderConfirmPage` and `renderRequestPage`
were `async` when the page component was async. The route now resolves the
location and hands the page a plain object, so the page is synchronous and so are
these — and **53 `await`s at their call sites were inert**, because awaiting a
non-promise is legal and yields a microtask. That is the whole of the
`await-thenable` cluster, and it survived a refactor because nothing about it
throws.

Removing the awaits made four `it()` bodies synchronous, which is the other 18
`require-await` findings, found by re-running rather than predicted.

### `e2e/no-token-artifacts.ts` cannot suspend

All three of that file's checks are `readFileSync` and `execFileSync`. The
`async`/`await` they carried said otherwise to every reader. Playwright types
`globalTeardown?: (config) => void | Promise<void>`, so the truthful signature is
also the documented one.

---

## 4. The rest, briefly

- **`no-misused-promises` (20) + `no-floating-promises` (4)** — one shape: a
  promise handed to something typed `=> void`. React's `onSubmit`/`onClick`, and
  `Retry`'s `onRetry`. `void` at the boundary; the reasoning is written out once,
  on `login-form.tsx`'s `onSubmit`, rather than copied nineteen times.
- **`no-unsafe-*` (11) at four boundaries** — the brief predicted this correctly
  ("`no-unsafe-*` findings clustered together in one file are usually a SINGLE
  root cause … Find the boundary before you start editing call sites"). It was
  `await response.json()`, which is `any`. Each read now goes through a named
  helper that states the shape once: `healthzBody`, `readyzBody`, and the gateway
  problem document in `stack.e2e.spec.ts`.
- **`no-unnecessary-type-assertion` (9)** — removed. One of them was the `as
  StubIdentity` on `stubIdentity`'s return, which converted nothing.
- **`no-console` (3)** — `process.stdout.write` through a named `report()`, with
  the reasoning at the helper. `console.warn` was not available either: these lines
  report that a check **ran and passed**, and a log full of warnings is a log
  nobody reads. `bin/e2e` and `bin/e2e-stack` already `printf` these same `[e2e]`
  lines; this is the TypeScript spelling of the same choice.
- **`no-unbound-method`'s last holdout** (`describe.each(SCREENS)("$name", ({ render })`)
  was the same spelling decision on an inline type in a test.

---

## 5. Two of these were real defects, not style

### `[object Object]` as somebody's MFA challenge

```ts
challenge: String(record.challenge ?? ""),
```

`record` is `Record<string, unknown>`, so `record.challenge` may be an object —
and `String({})` is `"[object Object]"`. Identity's document says `challenge` is
a string, so this only fires on a service that disagrees with its own contract,
and then a second-factor screen is handed the literal text `[object Object]` as
somebody's challenge. `src/lib/identity.ts` already had the right helper:

```ts
challenge: readString(record.challenge) ?? "",
```

### `await`ing a navigation would have reported a successful sign-in as a refusal

Every form ends with `router.push(...)` inside its `try`. `await` is the obvious
fix for `no-floating-promises` and it is **wrong**:

```ts
try {
  await login(…);
  await router.push("/");        // ← a failed navigation lands in the catch
} catch (thrown) {
  setState(failureState(thrown)); // ← renders INVALID_CREDENTIALS
}
```

A navigation that failed would be rendered as **"Invalid email or password"** to
somebody who had just signed in correctly. On the screen `AGENTS.md` says must
never be an account-existence oracle. So it is `void`, which says what happens
instead: the navigation was requested, and if it does not complete the reader is
still on a page that is now signed in. Same shape in `reset-password-form` (a
redeemed reset reported as a failed one) and in `account-screen`'s
`leave`/`destroy`. Each site says so where it is.

---

## 6. The second standard is gone, and one more measured surprise

`eslint.config.mjs` is deleted and `npm run lint` is `./bin/lint`.

This is a judgement call and it is the one change here that was **not** forced by
a finding, so it is worth being explicit about. The argument: the file was a
second, looser standard that `npm run lint` read and CI never did, and the README
told developers to run it. Two configs in one tree is the drift the shared step
exists to end, and "overrides are how a standard dies quietly" applies to a
weaker local copy just as much as to a rule turned off in kit.

**The measured surprise is that `kit`'s config cannot type `.mjs` files at all.**
`tests/assert-e2e-ran.mjs` — the script that fails a run of the end-to-end tier
that verified nothing — was one of the three parse errors, which means every
type-aware rule on it had been dying silently since the linter woke up. kit's own
config header describes `allowDefaultProject` as the answer and explains why it
does not help a caller. So the fix is on this side: `**/*.mjs` is in the tsconfig
`include`, with `dist`, `.output` and `.kit` in `exclude` so a build cannot put
its own output into the program (`npm run typecheck` must pass without a build).

Three parse errors became **twelve findings in that one file**, all fixed at the
boundary they describe. Two things came out of it worth keeping:

- **A JSDoc cast on a `.mjs` file is not a TypeScript `as`.** `checkJs` is off,
  so `npm run typecheck` reported nothing about an `as` in that file; ESLint's
  project service was perfectly happy with one; and `node` then refused to run the
  file at all — `SyntaxError: Unexpected identifier 'as'`. A green lint and a
  green typecheck over a script the end-to-end job runs by name. Measured, and
  written into the file's header.
- **Narrowing out of `any` needs two steps.** A JSDoc cast on the `JSON.parse`
  call itself is not applied (still `no-unsafe-assignment`); nor is one on a
  `return` expression (`no-unsafe-return`). A cast whose operand is **already
  `unknown`** is applied and is clean — and it is the only one of the three that
  is also honest: you cannot narrow bytes you have not admitted you know nothing
  about. Measured with a four-variant probe; the file carries the result.

I then exercised the script against nine reports to confirm the behaviour was
unchanged: passing (5), under the floor (1), skipped, retried, unreadable,
missing file, `null`, and `{"stats":"nope"}`. All as before.

---

## 7. What I did not touch, and why

- **`kit/lint/eslint.config.mjs` — untouched.** No override, no `lint-args`, and
  no `eslint-disable` introduced by this packet. The one occurrence in the tree is
  `src/routeTree.gen.ts:1`, which is generated and committed, predates this work,
  and carries `// @ts-nocheck` beside it. If a rule is genuinely wrong here, §8 is
  where that goes.
- **`gate.yml`'s floors did not move, and did not need to.** `suite` declares
  `minimum: 781` and the suite is 781 — no test was added, removed, or skipped.
  `ci-shape-checks` declares 47 and `validate-ci.sh --self-test` reports 52
  breakages, both unchanged. AGENTS.md's "adding a test means raising the floor"
  rule is a decrease-detector and this change added no tests.
- **The gate's own coverage is unchanged.** `bin/lint` is **not** in `bin/prime`,
  for the same reason `bin/deploy-config` is not: it needs a kit checkout beside
  the repository, which neither a CI runner nor a fresh `npm ci` has. That is a
  real cost and the right trade — a check that only runs on a runner is a check
  its author never watched run, and this one *was* only on a runner for four days.
- **`node_modules` was cloned once, then thrown away.** The APFS clone the brief
  suggests produced an incomplete tree (no `@cloudflare/vite-plugin`), which made
  `route.test.ts` red on a build it runs itself. `npm ci` is 10s here. The brief's
  advice is about not paying for installs repeatedly; paying once was cheaper than
  debugging the clone.

---

## 8. Findings for kit, not fixes in parlor

These are the ones I would not have wanted to override, so they are written down
instead. **None of them is a rule that is wrong; three are places the standard has
no answer.**

1. **`recommendedTypeChecked` cannot see a `.mjs` file, and the failure is silent
   per-rule.** The config's own header says so, and it names `allowDefaultProject`
   as the mechanism — but it also explains at length that `allowDefaultProject`'s
   globs resolve against `tsconfigRootDir`, so a caller cannot add the entry
   itself. In a TypeScript service the honest fix is in the service's tsconfig,
   which is what this packet did. Worth kit deciding whether that should be a
   documented caller obligation rather than a per-service discovery.
2. **`no-undef` is on for `.mjs` and there are no globals declared.** It is off
   for `ts/tsx/mts/cts` by typescript-eslint's own override, so a `.mjs` file is
   the one place in a TypeScript service where `process` is an undefined
   identifier. This repository's answer was `import process from "node:process"`,
   which is better code anyway, so I would not change the rule. Noting it because
   every service in the fleet will hit it the moment it has a `.mjs` file.
3. **A JSDoc cast on a `.mjs` file is silently not applied.** Two of the four
   spellings I tried (on the call, on a `return`) were accepted by the parser and
   then ignored by the type checker. The only working form needs an intermediate
   `unknown`. That is a real trap for a service maintaining a `.mjs` gate script,
   and the reason it took four attempts here.
4. **`no-unsafe-call` on `cloudflare()` and `nitro()` is an upstream packaging
   defect, not a code defect.** `@cloudflare/vite-plugin@1.62.5`'s published
   `dist/index.d.mts` imports a type from `@cloudflare/workers-utils`, which is in
   its **devDependencies** and therefore not installed. `npx tsc --noEmit
   --skipLibCheck false` names it: `error TS2307: Cannot find module
   '@cloudflare/workers-utils'`. `skipLibCheck: true` hides it, and ESLint's
   project service does not, which is why two of the original 335 were
   `no-unsafe-call` on the build configs. **`kit/lint` should not paper over this
   and neither should this repository** — the two findings cleared the moment
   `npm ci` had run properly (my first baseline was taken against the incomplete
   APFS clone), and they are NOT reproduced in the final count. Written down
   because a service that hits it will be tempted to add a skip.

---

## 9. What I would do next

1. **`kit`: decide on (8.1) and (8.2)** and put the answer in the config's header,
   where the two existing paragraphs about `tsconfigRootDir` already are. A service
   should not have to discover either.
2. **`kit`: `@cloudflare/vite-plugin`'s type dependency is upstream.** A services
   repository cannot fix it and should not skip around it. If the plugin ships a
   `.d.mts` that imports a devDependency, every TypeScript service that deploys to
   Workers hits the same two findings.
3. **`gate.yml` could declare the lint tier**, and I would argue for it. It cannot
   run in `bin/prime` today because `bin/prime` must work on a fresh clone, but
   `gate.yml` has a third vocabulary for exactly this (`bin/deploy-config` is in
   it and not in `bin/prime`). Declaring it would make "the lint tier ran" a thing
   the gate reports rather than a thing only CI knows.
4. **`src/app/[...path]/route.test.ts` and the `require-await` change deserve one
   more look from someone who did not write it.** 149 mechanical rewrites of test
   doubles is the largest single diff here, and the correctness argument is "every
   one of them was `async` with no `await`, and `async () => x` and
   `() => Promise.resolve(x)` differ only by one microtask". The suite is green
   and the stateful-stub test is the one that would have caught a real mistake
   (and did, for the version I threw away) — but it is a big diff and it deserves
   a second reader rather than my assurance.
5. **A test that pins the lint config's scope**, in the shape of
   `tests/validate-ci.sh`'s existing checks. The three parse errors were invisible
   because nothing asserted that a linted file is inside a tsconfig, and that will
   be true of the next `.js`/`.cjs`/`.mjs` file somebody adds.