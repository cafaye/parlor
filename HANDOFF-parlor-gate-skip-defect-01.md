# HANDOFF — the gate still needs `caf`, in two more places than the typo

From `parlor-gate-skip-defect-01`, on `71355f4`. The typo is fixed and committed.
This is what is left, all of it measured, none of it mine to decide.

**Read this first:** `./bin/prime` on a machine without `caf` now exits **1**,
not 127. The name was real and it was the first of three caf dependencies, not
the only one. Two more are in `gate.yml`, and neither is a one-line change.

---

## 1. What was fixed

`tests/validate-ci.sh:203` called `skip`. The file defines `skipped()`; `skip`
is the counter variable (`skip=0`, line 83). Bash looked for a program named
`skip`, found none, and died. Measured before the fix, `caf` genuinely off
PATH: **exit 127**, `line 203: skip: command not found`.

The branch is reached only when `caf` is absent, which is every CI runner and
every developer without it. That is why the merge was green: on the machine that
produced it, `caf` was installed.

`skipped()` also now prints a second argument when given one, as `no()` already
did. The call site was already computing the reason and handing it over; the
helper dropped it on the floor. A computed reason that is never printed is the
same defect one layer down.

## 2. The gate is STILL red without `caf`, and it is not the typo

`./bin/prime` with `caf` off PATH: **exit 1**, at

```
self_test: an-unquoted-colon-in-the-manifest did NOT go red — that check cannot fail
```

Breakage 7 of 50 plants an unquoted colon in `cafaye.yml` and asserts the checks
go red. The only check that can see it is `manifest_parses` — which is the very
check that skips. So on a caf-less machine the self-test asserts a check can
fail, the check declines to run, and the assertion is reported as a broken
check. It is the self-test being correct about itself: the check genuinely
cannot fail here.

**This is exactly one breakage.** Verified, not inferred: a scratch copy of the
script with only that entry removed, run with `caf` off PATH, prints

```
45 passed, 0 failed, 1 skipped
self_test: 49 breakages, every check proven able to fail      exit 0
```

The other 49 are provable without `caf`. (Scratch copy deleted; no tracked
change.)

## 3. Why the fix cannot stay inside `validate-ci.sh`

Making that one breakage honest — report it as *unprovable on this machine*
rather than as *a check that cannot fail* — drops the self-test's count from 50
to 49 on a caf-less machine. `gate.yml`'s third proof is

```yaml
- id: check-self-test
  match: '^self_test: ([0-9]+) breakages'
  minimum: 50
```

and `harness/gate_check.py:1249` reads the LAST matching line and reports
`gate.floor` when it is under the floor. So the honest fix makes the *declaration*
red unless the tally learns to distinguish "proven" from "unprovable here" —
`self_test: 49 breakages, 1 unprovable without caf` or similar. That changes the
shape of a declared proof line, and `tests/gate-declaration-self-test.sh` and
`core` both have opinions about proof lines.

## 4. The second caf dependency, which nobody has hit yet because the first one
   fires first

`gate.yml`'s `ci-shape-checks` proof:

```yaml
- id: ci-shape-checks
  match: '^([0-9]+) passed, [0-9]+ failed, [0-9]+ skipped$'
  minimum: 46
```

Measured, same tree, same commit, one variable:

| `caf` on PATH? | tally                          |
|----------------|--------------------------------|
| yes            | `46 passed, 0 failed, 0 skipped` |
| no             | `45 passed, 0 failed, 1 skipped` |

`45 < 46`, so a caf-less machine gets **`gate.floor`** — "proof
'ci-shape-checks' reported 45 and the declaration's floor is 46".

This one is independent of the self-test and would still be red after §3 is
settled. The proof's own comment reasons carefully about the *skipped* count
being machine-dependent (shellcheck) and concludes "the skip is still visible in
the line, so a reader can see it". That reasoning covers the skip count and not
the **passed** count — and the passed count is exactly the number that moves.
`docker` is a third axis on the same tally: absent, it is
`44 passed, 0 failed, 2 skipped`.

So `46` is not a floor, it is a measurement of one machine with `caf`,
`shellcheck` and `docker` all installed. As a decrease-detector it cannot tell
"a check was removed" from "a check could not run", because on this fleet those
two are the same event.

## 5. What I did not do, and why

- **Did not lower either floor.** 46→45 and 50→49 are the tempting edits and
  both are wrong: a floor lowered to accommodate an environment-gated check is a
  floor that will not notice the check going missing. `gate.yml`'s own comment
  records the opposite decision ("recorded here rather than quietly absorbed").
- **Did not make the unprovable breakage pass silently.** Skipping it would make
  `bin/prime` green on a machine that proved one check less, which is precisely
  the "a skipped test proves nothing" failure PLAN.md §1 is about.
- **Did not make `manifest_parses` fall back to a YAML library.** The header at
  line 169 explains why not, and it is right: the authority is `caf`, and a
  hand-rolled parse answers a different question.
- **Did not add a `skip`-shaped guard** (a check that every `ok`/`no`/`skipped`
  call resolves to a defined function). It is the obvious regression test and it
  is worth having, but it adds a check, which moves two floors, in a packet
  about a typo. It belongs with the §3 decision.
- **Did not touch anything else the migration produced.**

## 6. Suggested next packet, in order

1. Settle what a self-test owes a machine that cannot run a check — one honest
   answer, applied to all three environment-gated checks (`caf`, `shellcheck`,
   `docker`), not just this one breakage.
2. Give the tally a passed-count that means the same thing on every machine, or
   floor the *total* checks rather than the ones that happened to run. Then set
   `ci-shape-checks` and `check-self-test` from that.
3. Add the "every tally helper is a defined function" check, which would have
   caught `skip` on the branch that introduced it.

## Measured, for the record

`caf` off PATH: `npm ci` ok, `npm test` **727 passed, 0 failed, 0 skipped**
(31 files), `npm run build` ok, `bash tests/validate-ci.sh` **exit 0**
(`45 passed, 0 failed, 1 skipped`), `--self-test` **exit 1** (§2),
`./bin/prime` **exit 1**.

`caf` on PATH: `bash tests/validate-ci.sh` **exit 0**
(`46 passed, 0 failed, 0 skipped`), `--self-test` **exit 0**
(`self_test: 50 breakages, every check proven able to fail`).

The vitest count did not move: 727, which is the floor. `caf` was put on PATH
from an existing mise shim — nothing was installed.
