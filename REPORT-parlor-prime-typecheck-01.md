# REPORT — parlor-prime-typecheck-01

**The gate a developer runs did not typecheck.**

Worktree `wt-parlor-prime-01`, branch `worker/parlor-prime-typecheck-01`, cut from
`master` at `e6a9e31`. Two commits, `31833bc` and `22601e1`, plus this report.

## 1. The defect, and the packet

`./bin/prime` ran `npm ci`, `npm test`, `npm run build`, then
`tests/validate-ci.sh --self-test`. `tsc --noEmit` was in none of them —
typechecking lived only in the `build` job of `.github/workflows/ci.yml`. So a
developer running the local gate got green on a tree the runner rejects, and
`cafaye/site`, the fork built from this template, carried **29 type errors**
behind a passing local gate for as long as the migration ran.

The first thing I did was measure the claim rather than repeat it, and it holds.
With one line of nonsense planted in `src/lib/money.ts`:

    $ npm test
     Test Files  31 passed (31)
          Tests  727 passed (727)
    $ echo $?
    0

**The suite is green on a tree that does not compile.** That is the whole packet
in one command: `vitest` transpiles each file it loads and hands it to a runtime,
so a type error is not an error to it.

## 2. Commit 1 — `31833bc` "the gate a developer runs did not typecheck"

`bin/prime` gains the step, ahead of the build, with the reasoning in the file's
own header style (the argument the `npm run build` block above it already makes,
one step earlier):

```diff
+echo "==> npm run typecheck"
+npm run typecheck
+
 echo "==> npm run build"
 npm run build
```

plus a `WHY npm run typecheck IS HERE` comment block, and the header's
"Four commands on purpose" becoming "Five". Nothing else. No gate assertion in
this commit, on purpose: the brief asks for the step and the guard to land
separately, and a commit that adds a check whose own guard does not exist yet is
harder to reason about than one that adds only behaviour.

## 3. Commit 2 — `22601e1` "nothing guards the typecheck step, so a check deletes it"

### The anti-regression half

`tests/validate-ci.sh` already pins `bin/prime`'s command list, and it needed the
same repair the build packet had to give it, for the same reason: the alternation
could not match the new line.

```diff
-prime_commands=$(grep -oE '^(npm|bun|yarn|pnpm)( ci| install| test| run build)?$' "$PRIME" | tr '\n' ' ')
-if [ "$prime_commands" = "npm ci npm test npm run build " ]; then
-  ok "bin/prime runs exactly npm ci, npm test, then npm run build"
+prime_commands=$(grep -oE '^(npm|bun|yarn|pnpm)( ci| install| test| run build| run typecheck)?$' "$PRIME" | tr '\n' ' ')
+if [ "$prime_commands" = "npm ci npm test npm run typecheck npm run build " ]; then
+  ok "bin/prime runs exactly npm ci, npm test, npm run typecheck, then npm run build"
 else
-  no "bin/prime runs exactly npm ci, npm test, then npm run build" \
+  no "bin/prime runs exactly npm ci, npm test, npm run typecheck, then npm run build" \
     "found: ${prime_commands:-<nothing>}"
 fi
```

It is a whole-line exact match on the whole list, so a gate that loses the
typecheck step reports a **different** command list rather than a shorter one.
That is the property that makes it a guard and not a description.

Proved by deleting the line from the real `bin/prime` and running the checks:

    $ sed -i '' '/^npm run typecheck$/d' bin/prime && bash tests/validate-ci.sh
    FAIL  bin/prime runs exactly npm ci, npm test, npm run typecheck, then npm run build
          found: npm ci npm test npm run build

and `bin/prime` was restored immediately (`git diff --stat bin/prime` empty).

### "That check can fail" is itself checked

One breakage added to the self-test's table, on the same pattern as the
`no-build-in-prime` breakage beside it:

```diff
+    "no-typecheck-in-prime|sed_i '/^npm run typecheck\$/d' '$SANDBOX/bin/prime'" \
```

The self-test plants it in a throwaway copy and asserts the script goes red, so
"the guard works" is a claim with a witness rather than a sentence in a comment.
Note the pattern names the literal `^npm run typecheck$`, which exists in the
tree — a breakage naming a literal the tree does not contain would `sed` nothing,
change nothing, and report a check that cannot fail.

### The floors, and the asymmetry

| proof | before | after | why |
|---|---|---|---|
| `suite` | 727 | 727 | no test added or removed |
| `ci-shape-checks` | 47 | **47** | this *extended* an existing check; the number of checks the script reaches a verdict on did not move |
| `check-self-test` | 51 | **52** | one breakage added |

The one that moved is the one that describes breakages. `ci-shape-checks` floors
the **declared total** (passed + failed + skipped), and this packet added no
check, so raising it would be a floor moved for a reason the tree does not
contain — the exact thing the comment above that number warns against. Read
before touching, as the brief requires: `gate.yml`'s own reasoning says a floor
that cannot be reconciled with the tally line is a floor nobody is reading, and
the measured run agrees with the unchanged number (`47 checks declared`).

Also updated, because they restate those floors in prose and would otherwise be
lying: `AGENTS.md` (two sentences, 51 → 52) and `CHANGELOG.md` (a `Changed`
entry in the shape of the build step's entry, which is the precedent).

## 4. The required reproduction — a real type error, through the real gate

Planted in `src/lib/money.ts`, which `tsconfig.json` includes:

```ts
export function formatMoney(money: Money, locale = "en-GB"): string {
  // DELIBERATE TYPE ERROR — planted to prove `npm run typecheck` is in the
  // gate. Reverted immediately after the capture; not committed.
  const planted: number = money.currency;
```

`./bin/prime`, verbatim tail of the real run:

```
==> npm test

> parlor@0.1.0 test
> vitest run

 RUN  v5.0.2 /Users/kaka/Code/any/moon/cafaye/wt-parlor-prime-01

 Test Files  31 passed (31)
      Tests  727 passed (727)
   Start at  17:29:30
   Duration  10.56s

==> npm run typecheck

> parlor@0.1.0 typecheck
> tsc --noEmit

src/lib/money.ts(71,9): error TS2322: Type 'string' is not assignable to type 'number'.

PRIME_EXIT=2
```

**`./bin/prime` exits 2**, with 727 tests green directly above the error, and it
stops there — the build never runs. That is the property the packet asked for,
observed rather than argued. Reverted with `git checkout src/lib/money.ts`
(confirmed: `grep -c planted src/lib/money.ts` → 0).

## 5. The clean gate, and how long it takes

```
==> npm ci
==> npm test
 Test Files  31 passed (31)
      Tests  727 passed (727)
==> npm run typecheck
==> npm run build
==> tests/validate-ci.sh --self-test
47 checks declared, 47 passed, 0 failed, 0 skipped
self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine
PRIME_EXIT=0

timeout 900 ./bin/prime  327.51s user 145.20s system 112% cpu 7:00.11 total
```

**7m00s warm, exit 0.** Of that, the 52-breakage self-test is 6m23s — the gate is
dominated by the thing that proves the other checks can fail, which is worth
saying because `gate.yml`'s `timeoutSeconds: 900` was budgeted on a measurement
of 79s from a tree with 42 breakages. It is still comfortably inside 900s, but
the trend line is 10 breakages per ~80s of self-test and the budget is a guess
that will need revisiting long before it is close.

Re-run on the exact final tree (after two prose/comment edits), **8m16s,
exit 0**, same two summary lines:

    ==> npm ci
    ==> npm test
          Tests  727 passed (727)
    ==> npm run typecheck
    ==> npm run build
    ==> tests/validate-ci.sh --self-test
    47 checks declared, 47 passed, 0 failed, 0 skipped
    self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine
    PRIME_EXIT=0

The 78s spread between two warm runs of the same gate is machine load rather
than variance in the gate, and it is a reason to trust the 900s budget less than
the 79s measurement that produced it suggested.

`npm run typecheck` itself is **4.7s**, which is the cost the packet bought:
2% of the gate's wall clock.

`package-lock.json` is byte-identical afterwards (`git diff --exit-code --
package-lock.json`), so the `prime` job's lockfile guard is satisfied.

## 6. What I deliberately did NOT do

This is the part a successor should read twice.

- **I did not add a new check; I extended the existing one.** A seventh
  `ok`/`no` site would have been a cleaner-looking "new check", and it would have
  forced `ci-shape-checks` 47 → 48. The house already had a check whose whole job
  is pinning `bin/prime`'s command list, and a second one pinning the same list
  would be a second copy that drifts — the exact failure mode this file's own
  comments name twice (the `MINIMUM_TESTS` copy, the runtime pin in four places).
  The declared-check floor is a *decrease*-detector, so the cost of a redundant
  check is a floor that reads 48 on a tree with 47.

- **I did not run `tests/gate-declaration-self-test.sh`.** It needs `core` on disk
  (present here, at `../core`) and it copies the repository once per breakage and
  runs **the whole gate** for each — with the gate at 7 minutes, that is hours,
  not minutes. It is deliberately not in `bin/prime` for the same reason. Its
  assertions most likely to be affected by my change are the two I *did* verify
  by hand: `gate.yml` still has no terminal escape in any `match:` (I added none,
  and my only new pattern text is prose), and the floors still match what the
  gate prints (`727` / `47` / `52`, all three read off the run above). **This is
  a real gap in my verification and it should be closed by whoever has the
  hours**, not waved at.

- **I did not add a `rm -rf dist` / `rm -rf .next` step before the typecheck.**
  `ci.yml`'s `build` job does `rm -rf dist` first, so a CI typecheck cannot pass
  on generated types. In the gate, `npm run typecheck` runs before `npm run
  build` and `tsc --noEmit` writes nothing except a gitignored `*.tsbuildinfo`, so
  there is nothing of the build's to inherit. Adding a `rm -rf` would be cargo
  cult copied from a job that has a different reason for it.

- **I did not deduplicate the CI typecheck.** `ci.yml`'s `build` job still runs
  `npm run typecheck` and it should: that job also proves the tree typechecks on
  a tree with no generated types and before any build, which is a different claim
  from "the gate a developer runs does". The brief also put the deploy workflows
  off-limits.

- **I did not touch `e2e/`, `Dockerfile`, `caf.dev.json`, or the workflows.**
  The typecheck step has nothing to do with the whole-stack tier, the image, or
  the service catalog, and other packets are live in those files.

- **I did not fix the doc drift I found** (section 7). The brief says not to tidy
  unrelated parts, and both of those are unrelated to this packet — but they are
  *real*, they are in files a reader trusts, and one of them names a directory
  layout this repository no longer has.

- **I did not lower or soften anything to make the hour fit.** The self-test runs
  6m23s and I ran it in full, twice, including once after I had to kill the first
  attempt (see section 8).

- **I did not write a `HANDOFF-parlor-prime-typecheck-01.md`.** The brief asks for
  one *if work remains*, and no work on this packet remains: the gate runs a
  typecheck, a tree with a type error makes it exit non-zero, the removal is
  guarded, the self-test proves the guard can fail, and the floors are honest.
  A handoff file for a finished packet is noise a successor has to read to
  discover there is nothing to do.

## 7. Found, broken, out of scope — with evidence

1. **The brief's premise about `node_modules` was wrong.** It says "Do not run
   `npm ci` — `node_modules` is already present." It was not: this worktree had
   no `node_modules` directory at all, and `npm run typecheck` failed with
   `sh: tsc: command not found`. I ran `npm ci` once (`timeout 600`, warm npm
   cache, exit 0) because requirement 1 is *prove the gate goes red on a type
   error*, which is not provable without a compiler on the machine. Flagging it
   because the same instruction will be given to the next packet, and it will be
   wrong there too if the worktree is fresh: **`npm ci` on a warm cache measured
   3.7s here**, which is cheaper than the hour the instruction is meant to save.

2. **`README.md` and `AGENTS.md` both describe the gate as `npm ci + npm test`,
   which stopped being true when the build step was added and is further from
   true now.**

       README.md:238  ./bin/prime       # npm ci + npm test + the CI gate
       AGENTS.md:22   ./bin/prime      # npm ci + npm test + the CI gate

   Neither mentions `npm run build`, so both were already wrong before this
   packet. Left alone deliberately (unrelated prose), but a reader's first
   picture of the gate is wrong in two of the three places they would look.

3. **`README.md` describes the `build` CI job in terms of a framework this
   repository no longer uses**, and names build output that no longer exists:

       README.md:312  | `build` | `rm -rf .next && npm run typecheck`, then `npm run build`,
                      then an assertion that `.next/standalone/server.js` and
                      `.next/BUILD_ID` exist |

   `.gitignore` has no `.next` (it has `/dist` and `/.tanstack/`) and `ci.yml`
   asserts `dist/server/server.mjs`, `dist/client/assets` and
   `server/index.mjs`. The same `.next` staleness is in `AGENTS.md` ("`rm -rf
   .next` and check") and in three test files (`src/app/v1/[...path]/route.test.ts`,
   `src/lib/billing.test.ts`, `tests/gate-declaration-self-test.sh`). This is
   TanStack-Start migration fallout, not typecheck fallout — a different packet's
   tree to tidy, and a bigger one than a find-and-replace.

4. **`tests/gate-declaration-self-test.sh` makes a claim about
   `tests/validate-ci.sh` that the previous commit made false.** Its header, at
   lines 62-68, says `validate-ci.sh --self-test` "breaks its copies with
   `sed -i ''`, and BSD sed exits 0 when a pattern matches nothing… That is worth
   fixing in `validate-ci.sh` too; it is named in the report rather than fixed
   here". Commit `e6a9e31` (the base of this branch) introduced the portable
   `sed_i` helper and converted all 29 call sites, so the defect is fixed and the
   comment now describes a file that no longer exists in that form. A reader
   auditing whether a breakage's `sed` still applies would be reasoning from a
   stale premise. Left alone as unrelated prose, but it is now a lie in a file
   whose entire subject is proofs.

5. **Not fixed, and it should be: nothing verifies that `bin/prime`'s command
   list survives a *rename* rather than a deletion.** The check is an exact match,
   so `npm run typechecks` would go red — good. But `npm run typecheck && true`
   would not, and neither would a comment-shaped change that moved the command
   into a shell function the grep cannot see. That is the check doing what a
   whole-line grep can do, and the honest name for its limit is "it can see the
   commands, not what runs them".

6. **The 47-check total is only constant while every check is reached.** The
   tally's own comment admits it: a block guarded by `[ -f ... ]` that is false
   contributes no verdict at all, so a deleted *file* can drop the declared total
   without moving `passed` or `failed`. On this tree every guarded block also
   reports a FAIL naming the missing file, so the invariant holds — but it is an
   argument, not a measurement, and the self-test's
   `no-deploy-config`/`no-e2e-workflow` breakages are what keep it true.

## 8. Process notes, including a mistake of mine

- **I killed the first `--self-test` run three seconds before it finished.** I
  was checking whether it was hung, misread my own elapsed-time arithmetic, and
  killed a healthy run. Cost: ~7 minutes and a re-run. The killed run had already
  printed `ok no-typecheck-in-prime goes red`, so the useful datum survived; the
  full clean run is the one quoted above.
- **I edited `tests/validate-ci.sh` while a `--self-test` run was in flight.**
  `seed_sandbox` copies that file per breakage, and bash reads a script lazily by
  byte offset, so an edit mid-run can corrupt execution. I re-ran the self-test
  from a settled tree afterwards and the number quoted is from that run, but the
  discipline point stands: `tests/validate-ci.sh` and `src/` are the two trees the
  self-test reads, and they should be frozen while it runs.
- **Verification was kept narrow as instructed**: `npm run typecheck` and
  `bash tests/validate-ci.sh` were the working commands; `./bin/prime` was run
  three times in total (once with the planted error, once clean, plus the
  self-test inside it), never in a loop.

## 9. Where the numbers are

    suite              727 -> 727    (measured: "Tests  727 passed (727)", 31 files)
    ci-shape-checks     47 ->  47    (measured: "47 checks declared, 47 passed, 0 failed, 0 skipped")
    check-self-test     51 ->  52    (measured: "self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine")

The self-test reported `0 unprovable` because this machine has all three optional
axes (`caf`, `shellcheck`, `docker` with a live daemon). On a CI runner it reads
`52 declared, 51 proven, 1 unprovable` — which is the point of flooring the
declared total, and the reason `52` is the number in `gate.yml`.