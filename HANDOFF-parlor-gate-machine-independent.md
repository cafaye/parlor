# HANDOFF — the floors are machine-independent now; one tier was not re-run

From `parlor-gate-machine-independent-01`, on `3d87558`. The packet is done and
measured. One verification was left unfinished for want of wall clock, and it is
named here rather than left as a green tick nobody can vouch for.

## What changed, in the declaration and in the harness

**`tests/validate-ci.sh` (the harness).**

| | before | after |
|---|---|---|
| tally line | `46 passed, 0 failed, 0 skipped` | `47 checks declared, 47 passed, 0 failed, 0 skipped` |
| self-test line | `self_test: 50 breakages, every check proven able to fail` | `self_test: 51 breakages declared, 51 proven able to fail, 0 unprovable on this machine` |
| environment handling | a skip counted as neither | `breakage_axis` + `axis_available` over `cafe`, `shellcheck`, `docker`; an absent axis prints `UNPROVABLE` and is counted separately |
| regression check for the `skip` typo | none | `every tally helper this file calls is a defined function`, plus the breakage `a-tally-helper-that-is-not-a-function` |

**`gate.yml` (the declaration).** Only the two affected proofs; nothing
reformatted, no proof reordered, the `external` block untouched.

| proof | `match` before | `match` after | `minimum` |
|---|---|---|---|
| `ci-shape-checks` | `^([0-9]+) passed, [0-9]+ failed, [0-9]+ skipped$` | `^([0-9]+) checks declared, [0-9]+ passed, [0-9]+ failed, [0-9]+ skipped$` | 46 → **47** |
| `check-self-test` | `^self_test: ([0-9]+) breakages` | `^self_test: ([0-9]+) breakages declared` | 50 → **51** |

The `suite` proof is untouched at 727. One capture group each, no terminal
escape in either, both `$`-anchored or anchored hard enough that the earlier
`self_test:` failure lines cannot satisfy them.

## Measured, both environments, same tree

| environment | checks tally | self-test | `--self-test` exit |
|---|---|---|---|
| `cafe` + `shellcheck` + `docker` | `47 checks declared, 47 passed, 0 failed, 0 skipped` | `51 declared, 51 proven, 0 unprovable` | 0 |
| no `cafe` | `47 checks declared, 46 passed, 0 failed, 1 skipped` | `51 declared, 50 proven, 1 unprovable (named above)` | 0 |
| no `cafe`, no `docker` | `47 checks declared, 45 passed, 0 failed, 2 skipped` | `51 declared, 50 proven, 1 unprovable` | 0 |
| no `cafe`, no `docker`, no `shellcheck` | `47 checks declared, 44 passed, 0 failed, 3 skipped` | `51 declared, 50 proven, 1 unprovable` | 0 |

**47 on all four. That is the whole claim.**

`core`'s own checker on the real repository, static **and** `--prove`, both
phases, running the real `bin/prime` end to end:

```
gate-check --prove                    (cafe on PATH)   exit 0, 0 failures
gate-check --prove                    (cafe off PATH)  exit 0, 0 failures
```

The two `gate.requirement-unproven` warnings each run are the documented,
expected pair (`gate.yml`'s `external` block says so).

## The floors still catch a deletion — shown, not asserted

Both from a scratch copy, with the numbers read off the real run and only the
deleted thing differing.

1. **One check deleted** (the whole `bin/e2e is executable` block, out of
   `tests/validate-ci.sh`). The real gate tally on that tree reads
   `46 checks declared, 45 passed, 0 failed, 1 skipped` — and note that `45
   passed` is *also* what the intact tree reads on a cafe-less machine, which is
   precisely the collision the old floor could not see past.

   ```
   control, intact tree's own bytes   OK    0 failure(s)
   one check deleted                  FAIL  gate.floor: proof 'ci-shape-checks' reported 46 and the declaration's floor is 47
   ```

2. **One breakage deleted** (`no-lockfile-guard` out of the self-test list). The
   real self-test on that tree reads
   `self_test: 50 breakages declared, 49 proven able to fail, 1 unprovable …`
   while the checks tally is still 47 — so the two floors are independent.

   ```
   control, intact tree's own bytes   OK    0 failure(s)
   one breakage deleted               FAIL  gate.floor: proof 'check-self-test' reported 50 and the declaration's floor is 51
   ```

## What was deliberately NOT done

- **Neither floor was lowered.** `46 → 45` and `50 → 49` are the edits that buy
  a green CI and they are a floor that can no longer notice a check going
  missing. `gate.yml`'s own rule is "recorded here rather than quietly absorbed".
- **`manifest_parses` still asks `cafe` and still refuses to fall back.** The
  header at `tests/validate-ci.sh:169` is right about why: a hand-rolled YAML
  parse answers "is this valid YAML", not "can the consumer read this".
- **The unprovable breakage is not skipped and not passed.** It is printed on its
  own `UNPROVABLE` line, counted separately, never counted as proven, and still
  inside the declared total the floor reads.
- **No check was weakened, deleted or `.skip`ped.** `47` is `46` plus one new
  check; `51` is `50` plus its breakage.
- **The `external:` block was not touched**, as instructed. That leaves one
  sentence in it now false, quoted here so the next reader is not misled by it:

  > NO SHELLCHECK. It is optional: `tests/validate-ci.sh` lints itself with it
  > when it is installed and prints SKIP when it is not. The tally this
  > declaration floors counts checks PASSED, which is the same number either way
  > — see the `ci-shape-checks` proof above.

  "counts checks PASSED" is now "counts the declared total". One line, and it is
  inside the block the packet said not to touch, so it is reported rather than
  edited.

## NOT RE-RUN: `tests/gate-declaration-self-test.sh`

**It is not in `bin/prime`, and I did not run it.** It needs `core` beside the
repository and it runs the real gate — `npm ci`, 727 tests, the build and the
51-breakage self-test — about five times plus the two full controls, which is
roughly 35 minutes of wall clock and the packet's hour did not hold it.

What I did instead, and it is real verification rather than a guess:

- **control 3** (gate.yml's floors are the floors this script edits) — run
  standalone, **green**: 727, 47 and 51 each appear in both files.
- **the no-escape-in-a-`match:` guard** — run standalone against the new
  declaration: **3 `match:` lines scanned, 0 name an escape**.
- **`colour-green`** — the script's canary, replayed against the real checker
  with the new patterns and the re-captured fixture: **exit 0**.
- **every `bin/prime` fixture** in the script was re-captured to the new line
  shapes and to the tree's real numbers (47 / 51 / 727 / 31 files). Verified by
  grep that no `41 passed`, `42 breakages`, `26 passed` or `662` survives.

**What was already red before this packet**, so nobody reads my numbers as the
cause: the fixtures said 662 / 41 / 42 while `gate.yml`'s floors were 727 / 46 /
50. `colour-green` was red against `minimum: 46`, and control 3 was red because
none of 727, 46 or 50 appeared in the script. The re-capture should have fixed
both; that is an inference from the greps above, **not a run**.

### The next thing to do

```sh
CAFAYE_CORE_HARNESS=../core/harness timeout 3000 bash tests/gate-declaration-self-test.sh
```

Expect three controls green and the breakages red. The two cases worth reading
rather than skimming are `floor-with-two-capture-groups` and `no-separator`: both
have a stub `bin/prime` that has to print all three proof lines for the finding
under test to be the one being asserted, and both depend on the fixture re-capture
being right.
