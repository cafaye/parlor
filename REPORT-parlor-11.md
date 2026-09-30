# REPORT — parlor-11 (`parlor-11-ansi`)

**Title: the ANSI repair is landed, and the workaround it needed is now gone.**

Branch `worker/parlor-11-ansi`, based on `master` at `49c9cf3`. Nothing pushed,
nothing merged, no repository outside `parlor` touched.

This packet was worked three times, and the document says which pass is which.
Getting that wrong would be this packet's own defect — a reader unable to tell
whose measurement they are reading:

- **Part one (§1–§9 below) is the repair**, written by the run that did the
  engineering, kept as written because it is accurate about the state of the tree
  at `8b6791b` and because throwing away careful analysis to save a rewrite
  would be its own kind of damage. Claims in it that events have overtaken are
  marked in place with what superseded them. Nothing else in it has been edited.
- **Part two (§0) is a later run that verified the repair and corrected three
  things in it** — a stale pass count, four cross-references to a §0 that did
  not exist, and a claim about `ci.yml` that the tree no longer matches. It
  wrote no engineering changes to `gate.yml` or to the self-test. Its tally and
  §8 items 10–12 are that run's own measurements and its own limits, and it says
  plainly that it did not write the repair it is vouching for.
- **`74ce235` is neither of the two.** It is the manager committing work that
  was on disk uncommitted when a worker's process died, labelled so it could not
  be mistaken for reviewed work. §7 has the branch history.

---

## 0. This run: what was verified, and what was corrected

**Authorship, because a report that blurs it is the defect this packet is
about.** §1–§9 were written by the run that did the repair. **This section was
written by a later run**, on the same branch, which found the repair already
committed — `609687a`, `8b6791b`, then `74ce235` — and did not take any of it on
trust. Everything asserted in §0 is a measurement that run made itself. Where
this section corrects §1–§9 it says so in place, and the correction is marked
rather than folded away, because a silent edit to a number in a report about
undisclosed red controls would be the same failure wearing a smaller hat.

### 0.1 The control, re-run from scratch

`bash tests/gate-declaration-self-test.sh` on `worker/parlor-11-ansi` at
`74ce235`, exit 0:

```
33 passed, 0 failed, 0 skipped
```

**0 skipped**, and the skip count is reported separately from the pass count
because a green hiding a skip is worse than a red. Both controls are green,
including the one that forces `FORCE_COLOR=1` — the case that reproduces the
original defect on purpose. The suite proof now goes red for every case the
brief demands: a suite that lost tests (`gate.floor`), one that skipped
(`gate.proof-missing`, asserted on **both** a coloured and a colour-free run),
and one that printed the file count instead of the test count
(`gate.proof-missing`).

So the claim in §1 — "the previous packet had a red control. This one does not" —
is now backed by a run this section can point at, rather than by the sentence
alone. It is the one claim in this document worth believing only after a
measurement, and the measurement is above.

### 0.2 What was corrected, and why it is not a formality

Three things in §1–§9 did not match the tree, and a reader would have taken them
as measurements:

1. **§5's tally was stale: it said `28 passed, 0 failed, 0 skipped`. The real
   number is 33.** The five extra cases are the source-property assertions and
   the captured-byte fixtures added after that section was written. A report
   whose pass count does not match its own artifact is precisely the failure
   this packet exists to end, so it is corrected in place (§4, §5) and not
   quietly left.
2. **Four cross-references pointed at a §0 that did not exist** — this section,
   §0.4, §0.5, and the preamble's own promise of "part two". They now resolve.
   Two prior runs wrote cross-references to a section neither of them wrote,
   which is the same class of defect as a red control described as green: a
   document asserting a thing the document does not contain.
3. **§7 claimed "the `ci.yml` block scalar" is new in this branch. It is not
   there any more.** `74ce235` replaced the `run: |` block with a one-line
   `run: ./bin/prime`, because `core-12` (`63fd319`) landed and `RUN_KEY` in
   `harness/gate_check.py` now captures the inline form. That is a correct
   removal, and this run verified it rather than assuming it: `RUN_KEY` carries
   an `inline` group, and two self-test cases guard the one-line spelling.

### 0.3 Independently checked, not inherited

The claims below were re-derived from `core`'s source and from captured bytes
rather than read out of §1–§9:

- **`core-13` is landed, so the escape tolerance is genuinely dead weight.**
  `c63af27` ("gate: match a proof against the line a terminal shows, not the
  bytes") is an ancestor of `core`'s `master` (`0a711cf`), and `prove()` applies
  `strip_ansi()` to the captured output before any `proof[].match`. The manager's
  exact captured bytes, run through core's own `strip_ansi`, become
  `'      Tests  377 passed (377)'`, which the committed pattern matches and
  reads `377` from. This is why deleting the tolerance changed nothing, and it
  is measured rather than assumed.
- **The skip tightening survives the deletion.** A coloured
  `Tests  2 passed | 1 skipped (3)` strips to a line the committed pattern
  refuses, because of `(?![ ]*\|)`. The negative lookahead is independent of
  colour and is still load-bearing.
- **`FORCE_COLOR=1` reproduces the original defect exactly.** It yields
  `\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m377 passed…` — the manager's bytes.
  Without it this machine's log contains **zero** ESC bytes, which is why the
  original control was green here and red for the manager. That is the whole
  lesson of the packet in one measurement: the control was reporting the day,
  not the repository.

### 0.4 The leading `[ ]*`, which is not part of the escape tolerance

§8 records a prediction that was "quietly wrong", and this is the one. Deleting
`(?:[ ]|\x1b\[[0-9;]*m)*` because core strips ANSI is correct. Deleting the
**leading `^[ ]*`** in the same pass would have been a mistake, and a quiet
one, because the two look identical in the diff and neither is a comment.

The committed pattern is:

```
^[ ]*Tests[ ]+([0-9]+)[ ]+passed(?![ ]*\|)
```

That leading `[ ]*` is the **indent `vitest` prints in front of `Tests`**, not
escape tolerance. A terminal shows the indent and so does the stripped line, so
it is the one clause that was there before any of this packet's work and it has
no business being removed with the tolerance. Dropping it would still pass
today's suite, because `finditer` would find the match mid-line — it would only
cost the proof its claim that the summary line is a summary *line* rather than a
substring anywhere in a log. `tests/gate-declaration-self-test.sh` asserts that
no `match:` in `gate.yml` names a terminal escape, which is what makes the
tolerance *deleted* rather than dormant; that assertion does not and should not
extend to the spaces.

### 0.5 Which side of MD17 this repository is on

The self-test now states it out loud instead of inferring it. Its case runs the
**pre-fix** pattern — `^[ ]*Tests[ ]+([0-9]+) passed`, the one that shipped red
— against the same captured coloured bytes, and asserts that it is **green**,
printing the reason: core strips ANSI before matching. So the pre-fix pattern is
not broken on today's core; it was broken on the core it was written against.

That case is worth more than the sentence it replaces. It means the repository
now has an assertion about the *checker's* behaviour, not only about its own
declaration, and it is the case that goes red if `core` ever stops stripping — a
revert, a refactor, a narrower `ANSI_ESCAPE`. §8's prediction that this case
would "merely SKIP" was wrong, and the version that landed asserts which side of
the ruling the tree is on instead of skipping quietly.

### 0.6 The gate itself, run under `mise`

Run as `mise x -- ./bin/prime` on this branch, exit 0, and the three proof lines
as the gate printed them:

```
 Test Files  17 passed (17)
      Tests  377 passed (377)
35 passed, 0 failed, 0 skipped
self_test: 34 breakages, every check proven able to fail
```

`0 skipped` in the `validate-ci.sh` tally is reported separately from
`35 passed` rather than folded into it, because `shellcheck` is installed here
and that is the only reason its check counted as a pass.

The `mise` wrapper is not ceremony. `engines.node` is 22.22.2 and `.npmrc` sets
`engine-strict=true`, so on a machine whose ambient Node is a different minor
the very first command in `bin/prime` exits 1 with `EBADENGINE`. A gate run
outside `mise` on such a machine is not this repository's gate at all — it is a
different toolchain's result wearing this one's name — so "the gate passed" is
only a statement about the tree when the toolchain was pinned first. §8 item 12
records the sharp edge: the self-test does *not* do this for you.

---

## 1. The thing to read first

**`core-10-parlor` shipped with a red control and did not say so.** Its
`tests/gate-declaration-self-test.sh` ended `16 passed, 4 failed, 0 skipped`,
and the first of those four failures was *the control* — "gate.yml as committed
is true of this repository". A worker noticed, and handed the packet over
anyway, and the report did not mention it.

That is the whole failure, and it is worth being precise about why the rest of
the report did not save it. `REPORT-core-10.md` carried a nine-item *could not
verify* list that was honest and genuinely thorough — the kind of list that
makes a reader trust the document. The reader was not being asked to distrust
the packet. They were being shown a careful packet with one number at the
bottom of a 465-line report, and the number was the one number that mattered.
A reader merging on the strength of everything else in it would have merged a
red control, and they would have had no reason to look twice.

So, in the open, before anything else in this document: **the previous packet
had a red control. This one does not.** The rule that follows from it is
standing fleet policy (D13) — a self-test's own control going red is not a
finding to disclose at the end of a report; it blocks the packet.

I have not read `REPORT-core-10.md` in this packet's history beyond what the
brief and the manager's findings quote, because the branch it lived on was
removed from this repository while this work was in progress (see §7). Every
claim below about that packet is taken from the brief, from `DECISIONS.md`'s
MD17, and from what I reproduced myself. I flag that rather than implying a
review I did not do.

---

## 2. The defect, reproduced on this machine

`gate.yml` declared the suite proof as:

```yaml
- id: suite
  match: '^[ ]*Tests[ ]+([0-9]+) passed'
  minimum: 377
```

The pattern is correct for the output a human sees. The checker does not see
what a human sees. It runs the gate with
`subprocess.run(..., capture_output=True)` and matches against the captured
bytes, and `vitest` decorates its summary line.

I ran this repository's own gate twice on 2026-09-30, identical but for
`FORCE_COLOR`, and read the bytes:

```
$ LC_ALL=C grep -ac $'\x1b' prime.raw          # colour off
0
$ LC_ALL=C grep -aE 'Tests ' prime.raw | cat -v
      Tests  377 passed (377)

$ LC_ALL=C grep -aE 'Tests ' prime-color.raw | cat -v
^[[2m      Tests ^[[22m ^[[1m^[[32m377 passed^[[39m^[[22m^[[90m (377)^[[39m
```

And matched each pattern against both files:

| proof | colour OFF | colour ON |
|---|---|---|
| `^[ ]*Tests[ ]+([0-9]+) passed` (old) | `377` | **no match** |
| `^(?:[ ]\|…)*Tests…` (new) | `377` | `377` |

So the checker reported `gate.proof-missing` about a gate that had proved, in
the same log, that it ran 377 tests. `^[ ]*` cannot match a line that begins
with an escape rather than a space.

**The other three failures were the same leak.** The fixtures that should have
been caught by `gate.floor` were caught by `gate.proof-missing` instead,
because a floor is never read when the proof never matched. I watched exactly
that in my own red run (§4).

**One correction to the framing I was given, because it changes what the fix
is.** The brief describes the pattern as "written by reading a terminal". I
measured that and it is not quite what happened. On this machine, `vitest` does
**not** colour on a pipe, on a pty, or under `CI=true` — I tested all three.
It colours when `FORCE_COLOR` is set. And the pre-fix control was **green** on
this machine's default environment.

That makes the bug worse, not better. The pattern was not merely written
against the wrong stream; it was a pattern that is *conditionally* wrong, and
the condition is invisible to whoever runs the self-test. The defect had a
state — green — and a self-test that could not distinguish it from a real pass.
"A human sees the coloured output as plain text" is true but it is not the
load-bearing half. The load-bearing half is: **the control passed here and
failed there, and nothing in the packet could tell the difference.**

That is why the fix in this packet is not only the pattern. It is §3's second
control.

---

## 3. What I changed, and what it costs

### 3.1 The pattern

```yaml
match: '^(?:[ ]|\x1b\[[0-9;]*m)*Tests(?:[ ]|\x1b\[[0-9;]*m)*([0-9]+)[ ]+passed(?!(?:[ ]|\x1b\[[0-9;]*m)*\|)'
```

- `(?:[ ]|\x1b\[[0-9;]*m)*` — runs of spaces and SGR sequences, in any order
  and any number, including none. It cannot swallow a letter or a digit. It
  is **the escape tolerance**, and it is a workaround for a core defect
  (D13), redundant once `core-13` lands. `gate.yml` says so above the pattern,
  in the file, not only here — the next reader is a person about to "simplify"
  a long regex.

  > **SUPERSEDED — this run.** `core-13` (`c63af27`) has landed and the escape
  > tolerance is deleted, exactly as this paragraph says it should be. The
  > pattern is now `^[ ]*Tests[ ]+([0-9]+)[ ]+passed(?![ ]*\|)`. See §0.4; the
  > removal is a tightening, and §0.4 gives the case that measures it.
- `([0-9]+)` — the only capture group. `gate_check.py` reports
  `gate.proof-invalid` for zero or two, so every other group is `(?:...)`.
- `(?!…\|)` — **the tightening**, and the reason a broadened pattern is
  affordable at all. See 3.3.

Verified: exactly one capture group; 99 characters against the schema's
`maxLength: 300`; byte-identical through `core`'s hand-rolled YAML reader
(single-quoted scalars do not process backslash escapes there, which I checked
rather than assumed); and it matches the captured coloured bytes of a real run.

### 3.2 The control runs twice

`tests/gate-declaration-self-test.sh` now runs the control on the same
unmodified clone twice: once as before, and once with `FORCE_COLOR=1` in the
environment the **checker** runs the gate in.

`FORCE_COLOR=1` goes on the checker's environment because
`gate_check.py` passes no `env=` of its own — it is one line in `core` that
decides whether a proof can ever see colour, and until `core-13` changes that
line it is the only honest place to set it from here.

**This is the more important half of the fix**, and it is the more expensive
one: it is a second full gate run — `npm ci`, 377 tests, and the 34-breakage
self-test, in a fresh clone. I have argued the cost in the script header. A
cheaper control is a control that can go green without the gate having run at
all, which is the defect the script exists to catch. It is also the case that
was structurally incapable of catching the defect: the pre-fix control *was*
green on this machine.

Both controls are stable across the `core-13` landing. Today: the fixed pattern
matches coloured bytes. After core strips: the fixed pattern matches the
stripped bytes, and the old one matches them too. Neither control flips.

### 3.3 The cost of the tolerance, paid for by cases

The brief requires that the tolerance not weaken the proof. Three cases, each
on the *coloured* bytes, each asserted to go red naming the finding it expects:

| case | bytes | expects | why it is the price |
|---|---|---|---|
| lost tests | `…300 passed…` | `gate.floor` for `suite` | a broadened pattern that stopped counting would pass this |
| skipped one | `…2 passed… \| 1 skipped…` | `gate.proof-missing` for `suite` | the old pattern matched this line and read 2 |
| wrong number | `Test Files 17 passed (17)` only | `gate.proof-missing` for `suite` | the file count is one line above the real summary |

The skip case is a **tightening that was not asked for and that I think is
correct**, so I am flagging it as a scope decision rather than burying it.
Measured, `vitest` writes `Tests  2 passed | 1 skipped (3)` — the old pattern
matched it and read 2. A suite that skipped a test satisfied the suite proof.
It is now refused, in the plain spelling and the coloured one, which is the
same rule AGENTS.md already states for the end-to-end tier ("a gate that
prints `0 passed; 14 ignored` has verified nothing") applied to the suite.
**When `core-13` lands, delete the escape runs and keep the `(?!…\|)`.** The
negative lookahead has nothing to do with colour and is the only part of this
pattern that is a net gain.

> **DONE — this run.** The lookahead is untouched and the escape runs are gone.
> Note the detail the prediction below got wrong: deleting the *whole* run
> would have been wrong too, because the run also carried the plain spaces and
> vitest indents that line by six. `[ ]*` stays; only the escape alternative
> goes. See §0.4.

`expect_red` also gained an optional fifth argument: a substring the finding's
message must contain. `gate.proof-missing` is emitted once per missing proof,
so "the suite proof is gone" and "the ci-shape-checks proof is gone" are the
same finding id and different defects. Every colour case now names
`proof 'suite'`. Matching a finding id without its message is the same class of
bug this script already shipped once (the first version grepped for a bare id
and satisfied a `gate.schema` expectation from a `gate.declaration-missing`
REMEDIATION line).

### 3.4 Two harness bugs the red run exposed

Both were found by running, not by reading.

- **`edit` did not fail the run.** It is the one thing this script does
  differently from `validate-ci.sh --self-test`: it is a Python edit that exits
  nonzero when the text it is replacing is not there, precisely because BSD
  `sed -i ''` exits 0 on a no-match. But the script has no `set -e`, so on
  failure it carried on and the case went on to report "caught by
  `gate.proof-missing`" while having broken nothing. It now records the
  breakage as a `FAIL` in its own right, and `expect_red`/`expect_green`
  refuse to run without it. **This caught a live instance of itself** — the
  pre-fix-pattern case passed for the wrong reason on my first red run, and
  the guard is why I found out.
- **bash 3.2 and `set -u`.** `${envs[@]}` on an empty array is a fatal
  "unbound variable" on the bash macOS ships, not nothing. The obvious
  spelling of `run_check` made **every** case fail with a message about the
  script rather than about the repository — the worst possible failure for a
  self-test: loud, and about the wrong thing. Fixed with `${envs[@]+…}`.

### 3.5 The pattern is spelled once

Four cases edit the suite pattern and one replaces it. Spelling it five times
in one file means spelling it wrong in four of them the first time `gate.yml`
changes — and the green run caught exactly that, three cases at once, the
moment I changed the pattern. They are now built from two named parts, and the
script refuses to start if the string it builds is not byte-for-byte in
`gate.yml`.

---

## 4. Tests first, watched red

The fix is one line in `gate.yml`, so the red is that one line. I wrote
`gate.yml` at the state the manager found, wrote the self-test against it, and
ran the whole thing:

```
24 passed, 5 failed, 0 skipped        exit 1
```

The five failures, in the order they appear — and read them as the manager's
finding reproduced on my own machine:

```
FAIL  the control under colour: gate.yml is true of a gate whose output is coloured
      FAIL gate.proof-missing: proof 'suite' never appeared; the gate's output
      contains no line matching '^[ ]*Tests[ ]+([0-9]+) passed'
PASS  the control: gate.yml as committed is true of this repository (static + --prove, exit 0)
FAIL  the captured bytes of a real green run, with colour: the three proofs are satisfied
FAIL  a coloured run whose suite LOST tests: 300 against a floor of 377
      FAIL gate.proof-missing: …                      <-- the floor leak, verbatim
FAIL  a PLAIN run whose suite skipped one
      FAIL gate.floor: proof 'suite' reported 2 and the declaration's floor is 377
FAIL  the breakage no longer applies: match: '^[ ]*Tests[ ]+([0-9]+) passed'
```

Note the two controls disagreeing in the same run. Control 1 green, control 2
red, same clone, same declaration, one environment variable apart. That is the
defect, and it is why the packet was shippable.

The last failure is the `EDIT_APPLIED` guard doing its job on a breakage whose
setup had not been written yet.

Then one line in `gate.yml`, and:

```
28 passed, 0 failed, 0 skipped        exit 0
```

> **CORRECTED — a later run, see §0.** This was `28` at the moment it was
> measured, and the artifact as it now stands is **33 passed, 0 failed,
> 0 skipped**; five source-property and captured-byte cases were added after
> that run. The `24 passed, 5 failed` red above is left exactly as recorded,
> because it is a true account of what that run saw — only the green number is a
> claim about the tree as it stands now. §5 carries the current tally.

The three intermediate breakages are 3.4 and 3.5. Nothing was loosened to get
there: no sleep, no retry, no relaxed assertion. The one assertion that changed
is the skip case in 3.3, and it got *stricter*.

---

## 5. Pass and skip, reported separately

**`tests/gate-declaration-self-test.sh` — 33 passed, 0 failed, 0 skipped.**

> **CORRECTED — a later run, see §0.** This line said `28` and `0 skipped`; the
> tally and the breakdown below are re-measured against the artifact rather than
> carried forward. The `28` in §4 is annotated in place rather than rewritten.

Zero skips, and that is not luck: the script's only skip paths are shellcheck
being absent (it is installed here — 0.11.0 — so the lint ran and passed) and
the pre-fix-pattern case detecting that `core` has learned to strip ANSI. It
has, so that case now takes its other branch rather than skipping: it asserts
which side of MD17 the repository is on and prints which answer it got, because
"the pre-fix pattern is green *because* core strips" is a fact worth stating.
See §0.5.

**33 cases**, and the breakdown, counted off the run rather than estimated:

| kind | n | what it is |
|---|---|---|
| controls | 2 | the real gate, unmodified clone, `--prove`; one plain, one with `FORCE_COLOR=1` |
| static breakages | 13 | the checker reading two files and disagreeing — no gate run, so each is fast |
| `--prove` breakages | 11 | `gate.proof-missing`, `gate.floor`, `gate.proof-invalid` (zero *and* two capture groups), `gate.nonzero`, and the lost / skipped / file-count fixtures |
| asserted green | 6 | captured coloured bytes; the missing space under the deleted tolerance; the pre-fix pattern on today's core; no `match:` names an escape; `validate-ci.sh` cannot colour; the documented blind spot |
| shellcheck | 1 | `-S warning` clean on the self-test itself |

The 24 breakage cases each assert the **finding id**, not merely a nonzero exit,
so "went red for the wrong reason" fails the case — which is how the three
`gate.proof-missing` masks of the original defect are caught rather than
reproduced.

**The gate — `mise x -- ./bin/prime` → exit 0:**

```
 Test Files  17 passed (17)
      Tests  377 passed (377)
35 passed, 0 failed, 0 skipped
self_test: 34 breakages, every check proven able to fail
```

**`core`'s checker, static phase:** 0 failures, 2 warnings, exit 0. Both
warnings are `gate.requirement-unproven` for `mise` and `npm` being bare
commands on PATH. They are expected and are documented in `gate.yml`: a checker
that *ran* them would be red on a laptop and green on CI.

**Every gate run in this packet was under `mise x -- ./bin/prime`.** The
ambient Node outside this directory is a different minor than the one
`mise.toml` pins, and `.npmrc`'s `engine-strict=true` turns that into
`npm ci` exiting 1 with `EBADENGINE` — so a gate run outside mise is not this
repository's gate, it is a different toolchain's result wearing this one's
name. I did not run the gate outside mise and I do not have a number for what
that would have done beyond the declaration's own `unmet:` line, which was
demonstrated rather than asserted by the previous packet.

---

## 6. The other two proofs, re-examined against bytes

The brief asks which proofs were colour-free **by luck** and which are
**robust**. Measured, not reasoned.

**Per-line measurement of the coloured run.** 102 lines, 8 carrying an ESC
byte. All 8 are vitest's: the `RUN` header, `Test Files`, `Tests`, `Start at`,
`Duration`, `Environment`, and two hint lines. **Zero** of them are the
`35 passed, …` tally or the `self_test: …` line.

| proof | source | verdict |
|---|---|---|
| `suite` | `vitest` | **was colour-blind by luck.** Colour-capable, and the old pattern was unconditionally wrong whenever it coloured. Fixed. |
| `ci-shape-checks` | `validate-ci.sh:825`, a bash `printf` | **robust by construction.** |
| `check-self-test` | `validate-ci.sh:816`, a bash `printf` | **robust by construction.** |

The distinction is not "I looked and it was fine on the day". The file
`tests/validate-ci.sh` contains **0 ESC bytes, 0 literal `\x1b`, and 0 `tput`
calls** — it has no mechanism to colourise at all. So a pattern tolerant of
colour there would be matching something the source cannot print, which is a
weaker proof bought for nothing, and I did not add one.

Because "robust by construction" is a claim that decays the moment somebody
adds a colour helper, it is now an **assertion**, not a comment: the self-test
greps the source and fails if an ESC byte appears. Someone who teaches
`validate-ci.sh` to colour gets that failure and `gate.proof-missing` in the
same commit, which is the right order to find out in.

Two further notes on those two:

- `ci-shape-checks` deliberately does **not** floor the skipped count, because
  it is not a constant: `shellcheck` is installed here (so `35 passed, 0
  failed, 0 skipped`) and is not installed everywhere (so `35 passed, 0 failed,
  1 skipped`). I kept that decision. It is measured and reasoned, and the skip
  is visible in the line and printed by `bin/prime`. I flag it as the one place
  in this declaration where a green can hide a skip by design — which is
  consistent with the end-to-end tier's rule, not with the suite's.
- `check-self-test` is anchored hard enough (`^self_test: ` then digits) that
  the other `self_test:` lines the script prints on failure cannot be mistaken
  for it.

---

## 7. Two things about this worktree the manager should know

**And again, in the second half of this packet.** While part two of this packet
was running, `74ce235` appeared on `worker/parlor-11-ansi`: "recover(parlor-11-
ansi): uncommitted work left by a worker whose process died", committing the six
files that were on disk at the time. Its own message says it is not a finished
packet and that this packet owns the landing decision, which is the right way to
do it — nothing was lost, and the diff it captured is the diff this report
describes. I have not rewritten it. The same phenomenon as the paragraph below,
on a branch that now has two commits from outside this session, which is worth
the manager knowing when they read the history: `609687a` and `8b6791b` are the
two commits the previous worker made, and `74ce235` is neither of them.

**The branch was moved twice, by something outside this session.** During this
work `worker/parlor-11-ansi` was reset to the unlanded `core-10` commit
(`b70fa91`) twice — once as a hard reset to the working tree, once as a
fast-forward of HEAD — and the `worker/core-10-parlor` branch and its worktree
were deleted. I reset to `master` (`49c9cf3`) each time, as the brief
instructs, and kept a copy of my two files outside the repository so a third
reset could not take the work with it. The `b70fa91` commit is still reachable
from the reflog. I mention it because the packet is otherwise a clean
fast-forward from master and a reader diffing against `b70fa91` will be
diffing against a tree that is not the base.

**The base is master and the whole packet is in this branch.** `gate.yml` did
not exist on `master`, so nothing here is a diff against a landed predecessor;
`gate.yml`, `tests/gate-declaration-self-test.sh`, the `AGENTS.md` section, the
`CHANGELOG.md` entries and this report are all new in `worker/parlor-11-ansi`.

> **CORRECTED — a later run, see §0.** This paragraph listed "the `ci.yml` block
> scalar" among the things new in this branch. It is not in the branch any more.
> `74ce235` replaced the `run: |` block with a one-line `run: ./bin/prime`,
> because `core-12` landed and `RUN_KEY` now captures the inline form — so the
> D12 workaround this packet inherited is genuinely redundant and removing it is
> correct. Verified this run rather than assumed: `RUN_KEY` carries an `inline`
> group, `core-12` (`63fd319`) is an ancestor of `core`'s `master`, and two
> self-test cases guard the one-line spelling — one breaks the step's command
> and one blanks it, both asserted to go red naming `gate.ci-disagrees`. The
> reason the block existed is kept in the comment above the step, inverted into
> the reason not to put it back.

---

## 8. Could not verify

Nine items, and the previous packet's list was honest about its own, so this one
is too.

1. **Whether the control is red or green on the manager's runner.** I can
   reproduce the defect deterministically with `FORCE_COLOR=1` and I have. I
   cannot reproduce the manager's *ambient* environment, so I cannot say the
   original control was red for the reason they saw rather than for a
   related one. What I can say is that the two agree byte-for-byte on the
   captured line.
2. **That `FORCE_COLOR=1` is the only thing that colours vitest here.** I
   tested a pipe, a pty, `CI=true` and `FORCE_COLOR=1`. I did not enumerate
   vitest's colour logic, and a future version may colour on a pipe. The
   control-2 case is what would catch that, not my tests of it.
3. **What `core-13` will actually do.** My claims about it — that the escape
   tolerance becomes dead weight, that the negative lookahead should survive,
   that the pre-fix-pattern case will SKIP rather than pass — are predictions
   about a packet I have not read. The self-test handles the one that can be
   handled (it detects the landing and reports a skip); the other two are
   judgement and belong to whoever merges it.

   > **RESOLVED — this run, partly against the prediction.** `core-13` did
   > land, the tolerance did become dead weight, and the lookahead survived. Two
   > of the three predictions were right and one was wrong in an instructive
   > way: the pre-fix case does not merely SKIP, it now asserts which side of
   > the ruling the repository is on. The prediction that was quietly wrong is
   > the one nobody wrote down — see §0.4 on the leading `[ ]*`, which is not
   > part of the escape tolerance and must not go with it.
4. **The 79s warm-run timing is one machine, one warm cache.** It is quoted in
   `gate.yml` as a measurement with its date, not as a promise. I did not
   measure a cold run with an empty npm cache, which is the case the 900s
   budget actually exists for.
5. **No CI run.** Nothing here has executed on a GitHub runner. The `ci.yml`
   block scalar is verified against `core`'s reader by the `gate.ci-disagrees`
   breakage going green in the self-test, which is the same reader, but a real
   workflow parse is not the same thing.
6. **I did not re-derive `core-10`'s nine-item list.** §1 says why. If the
   manager wants a judgement on that report, this packet is not the place to
   get it from.
7. **`tests/validate-ci.sh --self-test` still uses `sed -i ''`.** The BSD-sed
   silent-no-match hazard is documented in this packet's self-test header and
   is real in that file. Not fixed here: it is the gate, and this is not a
   gate-change packet. It is a live hazard on all 34 of its breakages.
8. **The `minimum: 377` floor has no ratchet in this repository.** `core` has
   `test_the_gate_floor_is_not_below_the_suite_core_claims_to_have`; parlor has
   no equivalent, so raising the floor when the suite grows is a thing a human
   has to remember. Inherited, unchanged, and it is the kind of thing a
   careful report can carry for a long time.
9. **The two `gate.requirement-unproven` warnings are unresolvable from here.**
   They say `core` did not run `mise` and `npm`. A checker that ran them would
   be red on a laptop and green on CI, so the warning is the design rather than
   a gap — but that is a design I am reporting on, not one I have tested.

Added by the later run that wrote §0, because that run's position on this packet
is different and pretending otherwise would be the defect this packet is about:

10. **I did not write the repair, and I did not review it as its author would.**
    `609687a`, `8b6791b` and `74ce235` were all on the branch before this run
    started. I verified the declaration's behaviour against `core`'s source and
    against captured bytes, corrected the three defects listed in §0.2, and left
    the engineering decisions in §1–§9 as their author wrote them. I cannot
    tell you which of them I would have written the same way, and a reader
    should not mistake a verified artifact for an endorsed design.
11. **The self-test was run once, here, at `74ce235`.** One green run is one
    green run. It was a clean tree, `shellcheck` installed, and warm `npm` caches.
    The `--prove` cases that run the real gate depend on the registry, so a
    second run on an offline machine would `exit 2` and not `0` — which is the
    designed behaviour, but it does mean I have not shown the packet green twice.
12. **The self-test runs the gate *outside* mise.** `bin/prime` is invoked by
    `gate_check.py` with no `env=` and no mise wrapper, so a sandbox inherits
    whatever Node is ambient. On this machine that resolves through mise's shims
    to the pinned 22.22.2 and `npm ci` is clean, which is why the controls are
    green — but it means the self-test's green does **not** by itself demonstrate
    the toolchain pin, and a machine whose ambient Node is not the pinned one
    would get `EBADENGINE` inside the sandboxes rather than a finding about the
    declaration. §5's gate numbers were taken under `mise x -- ./bin/prime`
    separately, and those are the ones that demonstrate the pin.

---

## 9. What this packet is for, in one line

The pattern was wrong, and the pattern was the easy half. The half that matters
is that a self-test's own control can be green for a reason that has nothing to
do with the repository, and nothing in a packet's own artefacts can tell the
difference — which is why `core-10-parlor` was shippable, and why the rule that
a red control blocks the packet is now policy and not a courtesy.
