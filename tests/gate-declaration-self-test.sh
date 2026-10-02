#!/usr/bin/env bash
# tests/gate-declaration-self-test.sh — proof that this repository's gate.yml is
# load-bearing, and proof that the proof is.
#
#   bash tests/gate-declaration-self-test.sh
#
# WHAT THIS IS FOR
#
# `gate.yml` at this repository's root declares what gates parlor, what that
# gate needs from the machine, and what the gate's own output must contain
# before the word "passed" means anything. A declaration that is only ever read
# on a day it happens to be true is a comment. So this script copies the
# repository — a fresh clone, `git ls-files` and nothing else — once per
# breakage, breaks exactly one thing in each copy, and asserts core's
# `harness/gate-check` goes red AND NAMES the finding it expects.
#
# "Something went red" is not the claim. "The check written for this defect is
# still the one that catches it" is, and that is the claim that decays silently:
# a check replaced by a looser one stays red and stops meaning anything.
#
# THE ONE THAT BLOCKS THE PACKET
#
# The control below is not one case among many. A self-test whose own control
# is red has not proved anything, whatever the rest of it says, and handing one
# over anyway is the failure this script exists to make impossible. It is now
# standing fleet policy (D13) and it is why the first version of this script —
# which ended its run with a red control and said nothing about it — was
# rejected rather than merged.
#
# WHY THE CONTROL RUNS TWICE, AND WHY THAT MATTERS MORE THAN THE FIX
#
# The defect this packet replaces was invisible on a machine whose tools do not
# colourise. `vitest` emits ANSI only when something asks it to, and on a plain
# `capture_output=True` pipe it emits none, so the pattern the manager found red
# was green here — the control passed, on a day it was not true. The fix is not
# "the pattern now tolerates escapes"; the fix is that the control is run TWICE,
# once with `FORCE_COLOR=1` in the environment the gate is captured in, so the
# control is red for the reason it should be red rather than green for the
# reason it happens to be green. `tests/gate-declaration-self-test.sh` and the
# fixtures below exist so the next runner change cannot quietly take that back.
#
# AND WHAT `core-13` CHANGED, so the reader of this file is not misled by the
# paragraph above. `core` ruling MD17 landed: `gate_check.py` strips ANSI from
# the gate's captured output once, in `prove()`, before any pattern is applied.
# The escape tolerance that pattern carried while core could not see colour is
# deleted from `gate.yml` — see the proof's own comment — and the pattern is
# now exactly as strict as it looks. That does NOT make the second control
# redundant: with stripping in place, control 1 cannot be made red by colour,
# and control 2 is the only case here that goes red when the stripping goes
# away. See the comment on control 2 for what it is guarding now.
#
# THE HOUSE STYLE, AND WHERE IT COMES FROM
#
# The shape is `tests/validate-ci.sh --self-test`'s: a sandbox seeded from
# pristine files, a control on the unbroken copy FIRST, and a table of
# breakages each asserted to go red. Two things are borrowed from `core`'s
# `harness/tests/gate_self_test.sh` instead, because they are better and this
# repository's existing self-test does not have them:
#
#   * `expect_red` NAMES the finding it expects, not merely a nonzero exit.
#   * `edit` FAILS LOUDLY when the text it is replacing is not there.
#     `validate-ci.sh --self-test` breaks its copies with `sed -i ''`, and BSD
#     sed exits 0 when a pattern matches nothing — so a breakage that stopped
#     applying would keep reporting "goes red" for whatever unrelated reason the
#     sandbox happened to have, and the self-test would be a stamp that prints
#     "ok". That is worth fixing in `validate-ci.sh` too; it is named in the
#     report rather than fixed here, because that file is the gate and this
#     packet is not a gate-change packet.
#
# WHY IT IS NOT PART OF `bin/prime`
#
# Three reasons, and the first is the one that would settle it alone.
#
#   1. It needs `core`. The checker is `core`'s, and it is not vendored here.
#      A `bin/prime` that needed `../core` on disk to finish would stop being
#      runnable from a clone of this repository alone, which is the whole claim
#      this repository makes about its gate.
#   2. A self-test inside every gate invocation is a second gate that can
#      disagree with the first. `core` keeps `harness/tests/gate_self_test.sh`
#      out of `bin/prime` for the same reason and runs it as a CI step.
#   3. Cost. The proof breakages run the whole gate — `npm ci`, the suite, and
#      `tests/validate-ci.sh --self-test` — once each, in a fresh clone each
#      time. That is minutes per case, and a gate that takes minutes because it
#      is proving it can fail is a gate people stop running.
#
# EXIT CODES, WHICH ARE THE WHOLE CONTRACT
#
#   0  every breakage went red with the finding it was supposed to name, the
#      control is green, and the one documented blind spot stayed green.
#   1  a breakage stayed green, went red as something else, or a check in this
#      script itself failed.
#   2  the run COULD NOT HAPPEN — `core`'s harness is not where this script
#      looked, or no python >= 3.11 is on PATH. Never 0: a check that could not
#      find the checker has not checked anything, and a green badge over that
#      is the defect this packet exists to remove.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DECLARATION="$ROOT/gate.yml"

# Where `core`'s harness is. Overridable because a worktree, a checkout in
# ~/src, and a CI runner all put this repository somewhere different, and a
# hardcoded path is a script that only works on the machine that wrote it.
HARNESS="${CAFAYE_CORE_HARNESS:-$ROOT/../core/harness}"
GATE_CHECK="$HARNESS/bin/gate-check"

pass=0
fail=0
skip=0

ok() {
  pass=$((pass + 1))
  printf 'PASS  %s\n' "$1"
}

no() {
  fail=$((fail + 1))
  printf 'FAIL  %s\n' "$1"
  if [ $# -gt 1 ]; then
    printf '      %s\n' "$2"
  fi
}

skipped() {
  skip=$((skip + 1))
  printf 'SKIP  %s\n' "$1"
}

# --------------------------------------------------------------------------
# the things that must be true before any breakage means anything
# --------------------------------------------------------------------------

# The python the CHECKER needs, resolved the same way `core`'s own self-test
# resolves it. `gate-check` is stdlib-only and needs 3.11 because it reads
# mise.toml with tomllib; this script drives that same interpreter to do its
# edits, so it is one dependency rather than two.
PY="${CAFAYE_GATE_PYTHON:-}"
if [ -z "$PY" ]; then
  for candidate in python3 python3.13 python3.12 python3.11 python; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
      >/dev/null 2>&1; then
      PY="$candidate"
      break
    fi
  done
fi
if [ -z "$PY" ]; then
  echo "gate-declaration-self-test: no python >= 3.11 on PATH." >&2
  echo "  Set CAFAYE_GATE_PYTHON. core's gate-check needs 3.11 because it reads" >&2
  echo "  mise.toml with tomllib, which is stdlib from 3.11." >&2
  exit 2
fi

if [ ! -r "$GATE_CHECK" ]; then
  echo "gate-declaration-self-test: core's gate checker is not at $GATE_CHECK" >&2
  echo "  This is not a cafaye/core checkout beside this repository, and the" >&2
  echo "  checker is not vendored here. Point CAFAYE_CORE_HARNESS at it:" >&2
  echo "    CAFAYE_CORE_HARNESS=/path/to/core/harness bash tests/gate-declaration-self-test.sh" >&2
  echo "  This exits 2 and not 0: nothing below ran." >&2
  exit 2
fi

if [ ! -f "$DECLARATION" ]; then
  echo "gate-declaration-self-test: $DECLARATION does not exist." >&2
  echo "  There is no declaration to prove, and a self-test that passes on a" >&2
  echo "  repository with no gate.yml is worse than no self-test." >&2
  exit 1
fi

# --------------------------------------------------------------------------
# the sandbox: a fresh clone, which is the only copy worth breaking
# --------------------------------------------------------------------------
#
# `git ls-files`, not `cp -R`. A clone has no node_modules and no .next, which
# is what makes the copy honest: `bin/prime` in here runs `npm ci` for real
# rather than reporting a green over a tree that was already installed, and the
# sandbox is exactly what the declaration is a claim about. `cp -p` keeps the
# executable bit, so `bin/prime` and `bin/e2e` are runnable in the copy and
# `gate.entrypoint-not-executable` is a breakage rather than an accident.
#
# `EXTRA` names the files this packet adds, because until they are committed
# they are not in `git ls-files`. A self-test that only worked after the commit
# it is testing would be a self-test nobody could run while writing the
# declaration — and every breakage would be red for the one wrong reason,
# `gate.declaration-missing`, which is exactly how the first run of this script
# failed all nine of its static cases.
EXTRA=(gate.yml tests/gate-declaration-self-test.sh)
WORK="$(mktemp -d "${TMPDIR:-/tmp}/parlor-gate-self-test.XXXXXX")"
trap 'rm -rf "${WORK:-/nonexistent}"' EXIT

SANDBOX=""
LOGDIR=""

seed_sandbox() {
  local name="$1" file
  # A new case starts with its own setup, so one case's un-applied breakage
  # cannot fail the next one for a reason that has nothing to do with it.
  EDIT_APPLIED=1
  SANDBOX="$WORK/$name"
  LOGDIR="$WORK/logs/$name"
  rm -rf "$SANDBOX" "$LOGDIR"
  mkdir -p "$SANDBOX" "$LOGDIR"
  while IFS= read -r -d '' file; do
    [ -f "$ROOT/$file" ] || continue
    mkdir -p "$SANDBOX/$(dirname "$file")"
    cp -p "$ROOT/$file" "$SANDBOX/$file"
  done < <(git -C "$ROOT" ls-files -z; printf '%s\0' "${EXTRA[@]}")
  if [ ! -x "$SANDBOX/bin/prime" ]; then
    echo "gate-declaration-self-test: the clone lost bin/prime's executable bit" >&2
    exit 1
  fi
  if [ ! -f "$SANDBOX/gate.yml" ]; then
    echo "gate-declaration-self-test: the clone has no gate.yml to break" >&2
    echo "  Without the declaration every breakage below would be red for the" >&2
    echo "  wrong reason, which is a self-test that proves the opposite of what" >&2
    echo "  it says." >&2
    exit 1
  fi
}

# edit <file> <old> <new> — a textual breakage that FAILS LOUDLY if the
# declaration has moved past it. See the header: this is the one thing this
# script does differently from `validate-ci.sh --self-test`, and it is the
# difference between a self-test and a stamp.
#
# It RECORDS the failure rather than exiting, so the run still prints its
# tally — a script that dies on the first broken case reports nothing about the
# twenty-nine after it. `EDIT_APPLIED` is what stops the case from then going
# green for the wrong reason: a sandbox whose breakage silently did not apply
# would go red for whatever unrelated thing the sandbox happened to be, and the
# case would report "caught by gate.proof-missing" while breaking nothing at
# all. Every expectation checks the flag, so an un-applied breakage is a FAIL
# and never a PASS.
EDIT_APPLIED=1
edit() {
  if "$PY" - "$1" "$2" "$3" <<'PY'
import sys

path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
body = open(path, encoding="utf-8").read()
if old not in body:
    sys.exit(f"no longer applies to {path}: {old!r} is not in the file")
open(path, "w", encoding="utf-8").write(body.replace(old, new, 1))
PY
  then
    EDIT_APPLIED=1
    return 0
  fi
  EDIT_APPLIED=0
  fail=$((fail + 1))
  printf 'FAIL  the breakage no longer applies: %s\n' "$2"
  return 1
}

# write <file> — a whole-file breakage, read from stdin.
write() {
  cat > "$1"
}

# run_check [--prove] <repo> — the checker's own output and exit code, in that
# order and not the other way round. `$?` after an assignment is the
# assignment's status, and a pipeline's `$?` is the last element's; this is the
# same false green this packet exists to remove, so this function is the one
# place the exit code is read and it reads it immediately.
#
# `--with-env NAME=VALUE` prepends to the environment the CHECKER runs the gate
# in, which is the only place an environment setting can reach the bytes the
# proof is matched against: `gate_check.py` runs the gate with
# `subprocess.run(...)` and no `env=` of its own, so it inherits this one.
CHECK_OUT=""
run_check() {
  local prove_it="" repo="$1" envs=()
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --prove) prove_it="--prove" ;;
      --with-env) shift; envs+=("$1") ;;
      *) echo "gate-declaration-self-test: run_check got an argument it does not know: $1" >&2; exit 1 ;;
    esac
    shift
  done
  # `${envs[@]+"${envs[@]}"}` and not `"${envs[@]}"`, and that is not a
  # style preference. macOS ships bash 3.2, where expanding an EMPTY array
  # under `set -u` is a fatal "unbound variable" rather than nothing — so the
  # obvious spelling of this line makes every case in the script fail with a
  # message about the script rather than about the repository, which is the
  # worst possible failure for a self-test: loud, and about the wrong thing.
  # The `+` form expands to nothing when the array is empty and to the elements
  # when it is not, on 3.2 and on 5.x alike.
  # shellcheck disable=SC2086 # `prove_it` is deliberately empty or one word
  CHECK_OUT="$(env ${envs[@]+"${envs[@]}"} "$GATE_CHECK" $prove_it --log-dir "$LOGDIR" "$repo" 2>&1)"
  CHECK_CODE=$?
}

# expect_red <label> <repo> <finding-id> [--prove] [message-must-contain] —
# the copy must exit 1 AND name the finding. Both halves, and the second is
# the one that is easy to lose: a checker that reported the right exit code for
# the wrong reason would satisfy an exit-code-only assertion forever.
#
# The match is on `FAIL <id>: ` and not on the bare id, and that is a bug this
# script shipped and then caught. The first version grepped the whole report for
# the id, and `gate.declaration-missing`'s own REMEDIATION line reads
# "schemas/gate.schema.json is the format", so a sandbox with no gate.yml at all
# satisfied an expectation of `gate.schema`. Two of thirteen cases passed for
# that reason on the first run. A finding is one line the checker renders as
# `<SEVERITY> <id>: <message>`; the id alone is not a finding.
#
# The optional fifth argument is the half that `gate.proof-missing` needs. It is
# emitted once per proof that did not appear, and the message names the proof,
# so "the suite proof is gone" and "the ci-shape-checks proof is gone" are the
# same finding id and different defects. A case that only names the id is
# satisfied by either, which is the same class of bug as matching a bare id.
expect_red() {
  local label="$1" repo="$2" expect="$3" mode="${4:-}" detail="${5:-}"
  if [ "$EDIT_APPLIED" -eq 0 ]; then
    no "$label" "the breakage that sets this case up did not apply, so a red here
would mean nothing and a green here would mean less"
    return 1
  fi
  run_check "$repo" $mode
  if [ "$CHECK_CODE" -ne 1 ]; then
    no "$label" "expected exit 1 from gate-check, got $CHECK_CODE
$CHECK_OUT"
    return 1
  fi
  if ! printf '%s' "$CHECK_OUT" | grep -qF "FAIL $expect: "; then
    no "$label" "went red as something else and never said $expect
$CHECK_OUT"
    return 1
  fi
  if [ -n "$detail" ] && ! printf '%s' "$CHECK_OUT" | grep -qF "$detail"; then
    no "$label" "went red as \`$expect\` but never said: $detail
$CHECK_OUT"
    return 1
  fi
  ok "$label — caught by \`$expect\`${mode:+ (with --prove)}"
  return 0
}

# expect_green <label> <repo> [--prove] [--with-env K=V] — the copy must exit 0.
expect_green() {
  local label="$1" repo="$2"
  shift 2
  if [ "$EDIT_APPLIED" -eq 0 ]; then
    no "$label" "the breakage that sets this case up did not apply, so a green here
would mean nothing"
    return 1
  fi
  run_check "$repo" "$@"
  if [ "$CHECK_CODE" -ne 0 ]; then
    no "$label" "expected exit 0 from gate-check, got $CHECK_CODE
$CHECK_OUT"
    return 1
  fi
  ok "$label"
  return 0
}

# --------------------------------------------------------------------------
# the `suite` proof's pattern, spelled ONCE
# --------------------------------------------------------------------------
#
# Four cases edit this pattern and two replace it. Spelling it out six times in
# this file means spelling it wrong in five of them the first time gate.yml
# changes, and the failure is a self-test that stops breaking what it says it
# breaks — the exact defect `edit` below exists to catch, caught by `edit`
# instead. So the parts are named and every variant is built from them.
#
# `suite_head` is the anchored prefix every spelling below shares: the indent
# vitest puts in front of `Tests`, the word, and at least one space after it.
# The last of those is not decoration. The pattern used to carry
# `(?:[ ]|\x1b\[[0-9;]*m)*` in its place, an escape run that could match NOTHING
# and so stood in for the space; `core-13` (MD17) made core strip the escapes
# before it matches, the run was dead weight that also weakened the clause, and
# it is deleted. `no-separator` below is the case that says the weakening went
# with it.
suite_head='^[ ]*Tests[ ]+'
suite_ok="${suite_head}([0-9]+)[ ]+passed(?![ ]*\|)"
# breaks the middle clause, leaving a `(` the pattern cannot compile
suite_uncompilable="${suite_head}([0-9]+ passed"
# the same line with the capture group removed, so the floor has nothing to read
suite_no_group="${suite_head}[0-9]+[ ]+passed(?![ ]*\|)"
# a SECOND group beside the first. The floor is read from exactly one, so this
# is not a smaller pattern, it is an invalid declaration.
suite_two_groups="${suite_head}([0-9]+)[ ]+passed(?![ ]*\|)(.*)$"
# a well-formed pattern the gate's output never contains
suite_wrong_word="${suite_head}([0-9]+)[ ]+green"
# what this packet replaced, and what the escape tolerance then replaced. Both
# are used only to prove that the replacements mattered.
suite_prefix='^[ ]*Tests[ ]+([0-9]+) passed'
suite_tolerant="^(?:[ ]|\\x1b\\[[0-9;]*m)*Tests(?:[ ]|\\x1b\\[[0-9;]*m)*([0-9]+)[ ]+passed(?!(?:[ ]|\\x1b\\[[0-9;]*m)*\\|)"

SUITE_MATCH="match: '${suite_ok}'"
if ! grep -qF "$SUITE_MATCH" "$DECLARATION"; then
  echo "gate-declaration-self-test: gate.yml does not contain the pattern this script builds." >&2
  echo "  looked for: $SUITE_MATCH" >&2
  echo "  Every colour case below depends on this being the declaration's own" >&2
  echo "  spelling. Refusing rather than running a suite that breaks nothing." >&2
  exit 1
fi

printf '==> seeding a fresh clone per breakage under %s\n\n' "$WORK"

# --------------------------------------------------------------------------
# the control
# --------------------------------------------------------------------------
# Without it, every red below proves nothing at all: a checker that refused
# everything would satisfy every expectation. It runs WITH --prove, so it is
# also the control on the proving phase — the three proofs really do appear in
# this repository's real gate output, at or above the floors gate.yml claims.
printf '==> control 1: this repository, unmodified, must be green in BOTH phases\n'
seed_sandbox control
run_check "$SANDBOX" --prove
if [ "$CHECK_CODE" -ne 0 ]; then
  no "the control: gate.yml as committed is true of this repository" \
    "gate-check --prove exited $CHECK_CODE on an unmodified clone
$CHECK_OUT"
else
  ok "the control: gate.yml as committed is true of this repository (static + --prove, exit 0)"
fi

# --------------------------------------------------------------------------
# control 2: THE SAME CLONE, WITH COLOUR FORCED ON
# --------------------------------------------------------------------------
# This is the case the whole packet exists for, and it is not a fixture.
#
# A control that runs the real `bin/prime` in a real fresh clone and lets the
# gate colourise by itself is a control that depends on the day: on a machine
# where nothing sets `FORCE_COLOR`, `vitest` writes plain bytes and a pattern
# written against coloured bytes is red, and a pattern written against plain
# bytes is green for a reason that has nothing to do with the repository. The
# manager's gate found the first; this repository's own toolchain had been
# quietly green in the second state the whole time.
#
# `FORCE_COLOR=1` is put in the environment the CHECKER runs the gate in, not
# in this script's, because `gate_check.py` passes no `env=` of its own — it is
# one line in `core` that decides whether a proof can ever see colour.
#
# WHAT THIS CASE IS FOR NOW, which is not what it was for. It was written when
# `core` did NOT strip ANSI (MD17, landed as `core-13`): control 1 was
# therefore a control on this repository's pattern, and control 2 was the one
# that could actually see colour. Core strips now, so control 1 is INSENSITIVE
# to colour by construction — no declaration can make it red by being wrong
# about escapes — and control 2 no longer tests this declaration either.
#
# What it tests now is the STRIPPER, and that is not a downgrade. It runs the
# real `bin/prime` in a real fresh clone with colour forced on, so the day
# `core` stops stripping — a revert, a refactor, a narrower `ANSI_ESCAPE` — the
# gate's output reaches the pattern with escapes in it and this control goes
# red, and it is the only case in this script that would. Deleting it to save a
# minute of wall clock would delete the only thing standing between "core
# quietly stopped stripping" and "every proof in the fleet is a guess".
#
# COST, STATED: this is a second full gate run, so it is the slowest case in the
# script. It is the slowest because it is the only case that runs the real
# `npm ci`, the real 662-test suite and the real 42-breakage self-test with the
# bytes the defect was about, and a cheaper control would be a control that
# could go green without the gate having run at all — which is the defect this
# script was written to catch.
printf '==> control 2: the same clone, with FORCE_COLOR=1, must ALSO be green\n'
run_check "$SANDBOX" --prove --with-env FORCE_COLOR=1
if [ "$CHECK_CODE" -ne 0 ]; then
  no "the control under colour: gate.yml is true of a gate whose output is coloured" \
    "gate-check --prove with FORCE_COLOR=1 exited $CHECK_CODE on an unmodified clone
$CHECK_OUT
the captured bytes the proofs were matched against are in $LOGDIR/gate.log"
else
  ok "the control under colour: the same declaration holds when the gate emits ANSI (static + --prove, exit 0)"
fi

# --------------------------------------------------------------------------
# control 3: THE FLOORS IN gate.yml ARE THE FLOORS THIS SCRIPT BREAKS THINGS
#            AGAINST
# --------------------------------------------------------------------------
# Free, and it is here because this repository has no ratchet.
#
# `gate.yml` says so itself, at the `suite` proof: "there is no ratchet test here
# forcing it to stay in step... so raising this number when the suite grows is a
# thing a human has to remember until MD12's machinery lands." This is that
# remembering, automated — and it is the third repository in this batch where a
# floor and a second copy of that floor drifted apart. In `billing` the copy was
# inside a case that reported a green while proving nothing; in `caf` the merge
# itself made the floor wrong and the copy in the self-test went red when it was
# corrected. Same defect, three repos, and in this one it is still only held
# together by this comment.
#
# The check is deliberately STATIC — it reads two files and compares numbers, so
# it costs nothing and cannot be made green or red by the state of the suite. A
# test that ran the suite to learn the floor would be circular: the suite is
# what the floor is a claim about.
#
# Every number below is the floor that appears in BOTH gate.yml and this script.
# If a floor is raised in gate.yml and not here, this goes red and names the
# proof. If it is raised here and not there, the real gate catches it — that is
# what the `suite` proof is for — and this goes red too, so neither direction is
# silent.
printf '==> control 3: the floors in gate.yml are the floors this script edits\n'
floor_mismatch=""
for proof in suite ci-shape-checks check-self-test; do
  declared_floor="$(sed -n "/^    - id: $proof\$/,/^    - id: /{s/^      minimum: \([0-9][0-9]*\)\$/\1/p;}" \
    "$ROOT/gate.yml" | head -1)"
  if [ -z "$declared_floor" ]; then
    floor_mismatch="$floor_mismatch
  proof '$proof': gate.yml has no readable minimum; if its shape changed, fix this case rather than hardcoding a number"
    continue
  fi
  if ! grep -q "minimum: $declared_floor" "$ROOT/gate.yml"; then
    floor_mismatch="$floor_mismatch
  proof '$proof': read '$declared_floor' but gate.yml does not contain it"
    continue
  fi
  # The literal has to appear in this script too, or the breakages below are
  # editing a number that no longer exists and passing for the wrong reason.
  if ! grep -q "$declared_floor" "$0"; then
    floor_mismatch="$floor_mismatch
  proof '$proof': gate.yml's floor is $declared_floor but this script never mentions that number, so its breakages edit a floor that is not there"
  fi
done
if [ -n "$floor_mismatch" ]; then
  no "the floors: gate.yml and this script name the same numbers" \
    "they disagree:$floor_mismatch
Raise the floor in gate.yml and in the stand-in gates in this script in the same commit."
else
  ok "the floors: gate.yml and this script name the same numbers (static, exit 0)"
fi

# --------------------------------------------------------------------------
# the breakages
# --------------------------------------------------------------------------
# Twelve of these are the checker reading two files and disagreeing, and every
# one of them is fast because the static phase runs nothing. The ones after are
# the ones that need the gate to actually RUN, which is the only way to show
# that `gate.proof` is doing anything — and then a set of fast fixtures that
# reproduce the CAPTURED BYTES, which is the only way to show what happens when
# the bytes change while the gate is not.

# --- a repository that declares no gate -------------------------------------
seed_sandbox no-declaration
rm -f "$SANDBOX/gate.yml"
expect_red 'a repository that declares no gate at all' \
  "$SANDBOX" 'gate.declaration-missing'

# --- the command and the entrypoint are two files, and both are checked -----
seed_sandbox command-missing
edit "$SANDBOX/gate.yml" 'command: [./bin/prime]' 'command: [./bin/absent]'
expect_red 'a gate command naming a file this repository does not have' \
  "$SANDBOX" 'gate.command-missing'

seed_sandbox entrypoint-missing
edit "$SANDBOX/gate.yml" 'entrypoint: bin/prime' 'entrypoint: bin/absent'
expect_red 'a gate entrypoint this repository does not have, while the command still does' \
  "$SANDBOX" 'gate.entrypoint-missing'

seed_sandbox entrypoint-not-executable
chmod -x "$SANDBOX/bin/prime"
expect_red 'a gate nobody is allowed to execute' \
  "$SANDBOX" 'gate.entrypoint-not-executable'

# --- the fleet spelling, and the drift between it and the entrypoint --------
seed_sandbox task-missing
edit "$SANDBOX/gate.yml" '  miseTask: prime' '  miseTask: verify'
expect_red 'a mise task that is not in this repository'"'"'s mise config' \
  "$SANDBOX" 'gate.task-missing'

seed_sandbox task-unresolvable
# The drift this one is for: `mise run prime` and gate.yml are two ways of
# saying what the gate is, and this is the check that notices when they stop
# being the same sentence.
edit "$SANDBOX/mise.toml" 'run = "./bin/prime"' 'run = "./bin/other"'
expect_red 'a mise task that resolves to a DIFFERENT file than gate.entrypoint names' \
  "$SANDBOX" 'gate.task-unresolvable'

# --- CI, in both directions -------------------------------------------------
seed_sandbox ci-missing
edit "$SANDBOX/gate.yml" \
  'workflow: .github/workflows/ci.yml' 'workflow: .github/workflows/nope.yml'
expect_red 'a declaration naming a CI workflow that is not in this repository' \
  "$SANDBOX" 'gate.ci-missing'

# The `run:` line alone, on its own line, with its own indentation. Anchoring on
# the bare argv would hit the first MENTION of it in the file, which is a
# comment in the header, and leave the step untouched — a self-test that breaks
# nothing. Anchoring on the `name:`/`run:` PAIR does not work either: the step
# carries a comment block between them, so the two lines are not adjacent.
# `run: ./bin/prime` occurs exactly once in this workflow and `edit` fails loudly
# if that ever stops being true.
seed_sandbox ci-disagrees
edit "$SANDBOX/.github/workflows/ci.yml" \
  "
        run: ./bin/prime
" "
        run: echo the gate is optional
"
expect_red 'a CI workflow whose one-line `run:` no longer invokes the gate' \
  "$SANDBOX" 'gate.ci-disagrees'

seed_sandbox ci-command-removed
# The negative twin, and the reason control 1 is worth reading. That control is
# green on a workflow whose ONLY `run:` invocation of the declared argv is the
# one-line form, which means a reader collecting block bodies only would make
# control 1 red — the fix in `core-12` is what makes it green. A green case with
# no red twin cannot say which of the two is doing the work, so here the
# command goes and the argv is absent from every `run:` body in the file. The
# finding has to be the same one.
edit "$SANDBOX/.github/workflows/ci.yml" \
  "
        run: ./bin/prime
" ""
expect_red 'a CI workflow whose gate step carries no command at all' \
  "$SANDBOX" 'gate.ci-disagrees'

# --- the external half, which is the defect the whole format is for ---------
seed_sandbox self-contained-but-has-requirements
edit "$SANDBOX/gate.yml" '  selfContained: false' '  selfContained: true'
expect_red 'a declaration calling the gate self-contained while still enumerating what it needs' \
  "$SANDBOX" 'gate.schema'

seed_sandbox not-self-contained-and-says-nothing
# The identity defect. `selfContained: false` with the list renamed out from
# under it is "it needs things" written without saying what — which is exactly
# what identity's gate did, and the shape this packet exists to make
# impossible to write.
edit "$SANDBOX/gate.yml" '  requirements:' '  unused-requirements:'
expect_red 'a declaration that says the gate is not self-contained and names no way to satisfy what it needs' \
  "$SANDBOX" 'gate.schema'

seed_sandbox requirement-path-missing
edit "$SANDBOX/gate.yml" 'command: [npm, ci]' 'command: [./bin/absent-setup]'
expect_red 'an external requirement satisfied by a file that is not in this repository' \
  "$SANDBOX" 'gate.requirement-path-missing'

# --- a proof that cannot be evaluated --------------------------------------
seed_sandbox proof-uncompilable
# Caught at the SHAPE layer, before the gate is run at all, which is the
# better answer: a pattern that does not compile should not cost a whole gate
# runtime to discover. The brief names this case explicitly — a proof pattern
# that does not compile is a DEFECT, not "no proof required".
edit "$SANDBOX/gate.yml" \
  "$SUITE_MATCH" "match: '$suite_uncompilable'"
expect_red 'a proof whose pattern does not compile, which would otherwise read as "no proof required"' \
  "$SANDBOX" 'gate.schema'

# --- and now the ones that need the gate to RUN ----------------------------
# A well-formed gate that runs nothing and exits zero. Nothing in gate.yml is
# wrong about this repository: the command exists, it is executable, the mise
# task resolves to it, CI calls it — and the repository is ungated. Only
# asking the gate what it did catches it, which is what the proofs are for.
# This case is FAST on purpose: the broken gate is `exit 0`.
seed_sandbox false-green
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# A well-formed gate that runs nothing, says nothing, and exits 0. This is the
# false green reproduced deliberately: every string gate.yml holds about this
# repository is true, and the repository is not gated at all.
exit 0
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a declaration that is entirely TRUE about a gate that exited 0 without running anything' \
  "$SANDBOX" 'gate.proof-missing' --prove "proof 'suite'"

seed_sandbox proof-matches-nothing
# The brief's third minimum, and the one that is not string matching at all: a
# well-formed pattern that the gate's real output never contains. Nothing is
# broken about the gate here — this runs the real `bin/prime`, all 662 tests
# and all 39 checks, and fails only because the declaration promised a line
# that line is not on.
edit "$SANDBOX/gate.yml" \
  "$SUITE_MATCH" "match: '$suite_wrong_word'"
expect_red 'a proof regex that matches nothing the gate actually prints' \
  "$SANDBOX" 'gate.proof-missing' --prove "proof 'suite'"

seed_sandbox floor-above-the-suite
edit "$SANDBOX/gate.yml" 'minimum: 662' 'minimum: 6620'
expect_red 'a gate that proves 662 tests where the declaration promised 6620' \
  "$SANDBOX" 'gate.floor' --prove "proof 'suite'"

seed_sandbox floor-with-no-capture-group
# One half of a finding: the pattern compiles and the declaration is well
# formed, and the floor is promised against a capture group that is not there.
# A checker that read that as "no floor" would accept a suite of any size.
edit "$SANDBOX/gate.yml" \
  "$SUITE_MATCH" "match: '$suite_no_group'"
expect_red 'a proof with a floor and no capture group to read the floor from' \
  "$SANDBOX" 'gate.proof-invalid' --prove "proof 'suite'"

seed_sandbox floor-with-two-capture-groups
# The other half, and the rule every other group in this pattern obeys: it is
# `(?:...)`. A floor is read from EXACTLY ONE group, and a second one is not a
# smaller pattern — it is an ambiguous declaration, because "the number" is no
# longer a single thing in the pattern. `core` says so in words and in the
# checker (`compiled.groups != 1` in `prove()`), and this is the case that says
# it in this repository.
#
# It has to MATCH for the finding to be the one being tested: `core` reports
# the missing proof first and returns, so a second group on a pattern that
# matched nothing would be reported as `gate.proof-missing` and this case would
# pass for the wrong reason. The gate below therefore prints every proof, in
# colour, and exits 0 — which also makes this the cheapest case in the
# `--prove` group.
edit "$SANDBOX/gate.yml" \
  "$SUITE_MATCH" "match: '$suite_two_groups'"
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# Every proof the declaration names, coloured, and nothing else. The point is
# that the pattern matches: only then is the finding about the SECOND group
# rather than about an absent line.
set -euo pipefail
printf '\033[2m      Tests \033[22m \033[1m\033[32m662 passed\033[39m\033[22m\033[90m (662)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a proof with a floor and a SECOND capture group beside it' \
  "$SANDBOX" 'gate.proof-invalid' --prove "2 capture group(s)"

seed_sandbox gate-ran-and-failed
# The other half of the contract: the proofs were all there and the gate is
# still red. `gate.proof-missing` on its own would accept a gate that printed
# everything and failed.
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# Prints every proof gate.yml declares and then fails. The proof being present
# is not the gate passing; only the exit code is.
set -euo pipefail
echo "      Tests  662 passed (662)"
echo "41 passed, 0 failed, 0 skipped"
echo "self_test: 42 breakages, every check proven able to fail" >&2
echo "FAIL  one assertion in a suite this gate did not really run" >&2
exit 1
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a gate that printed all three proofs and then failed' \
  "$SANDBOX" 'gate.nonzero' --prove

# ==========================================================================
# THE CAPTURED BYTES
# ==========================================================================
#
# Everything above breaks the DECLARATION and runs the real gate. Everything
# below breaks the BYTES and does not run anything, which is why it is fast and
# why it is the only part of this script that can cover a change nobody made
# yet: the defect this packet fixes was never in this repository's files. It
# was in the bytes a tool on someone else's machine chose to write.
#
# THE FIXTURES ARE COPIES, NOT IMPRESSIONS. Each `printf` below is a byte-for-byte
# transcription of a line captured from a real run of this repository's own
# `bin/prime`, with `FORCE_COLOR=1` and without it. A fixture that re-rendered
# the output by hand would be testing the fixture, which is the mistake this
# section is here to prevent. The coloured `Tests` line is:
#
#   \x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m662 passed\x1b[39m\x1b[22m\x1b[90m (662)\x1b[39m
#
# and `\033` in the fixtures below is that same byte, because bash's `printf`
# emits ESC for `\033` and a checked-in literal escape would be invisible in a
# diff and unreviewable.
#
# RE-CAPTURED whenever the floor moves, which is the rule at the top of this
# file and the reason these numbers are the suite's real ones rather than a
# round number: a fixture left behind by a smaller suite reports a count below
# the new floor, and every case that expects green then goes red for a reason
# that has nothing to do with the pattern under test. The `colour-green` case
# is the canary — it is the one that goes red first, and it went red on this
# packet for exactly that reason.

seed_sandbox colour-green
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# The real gate's captured output, colour on. Exits 0. This is the case that
# the pre-fix `suite` pattern could not survive, and it is here so the next
# change to vitest's reporter, to `core`'s capture, or to this declaration is
# measured against the same bytes.
#
# It is also, now, the case that `core-13` is measured against. Nothing in this
# repository's pattern mentions colour any more: the escapes arrive, `core`
# strips them in `prove()`, and what the pattern is given is the line a
# terminal shows. If a change to the stripper ever let an escape through, this
# case is where it shows up — which is why it is a green expectation and not
# decoration.
set -euo pipefail
printf '\033[2m Test Files \033[22m \033[1m\033[32m26 passed\033[39m\033[22m\033[90m (26)\033[39m\n'
printf '\033[2m      Tests \033[22m \033[1m\033[32m662 passed\033[39m\033[22m\033[90m (662)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_green 'the captured bytes of a real green run, with colour: the three proofs are satisfied' \
  "$SANDBOX" --prove

# --- and the line the escape tolerance used to accept -----------------------
# The PRICE of the escape tolerance was never the escaped bytes, which are
# gone by the time any pattern sees them. It was that the run could match
# NOTHING, which means `Tests` and the number could be adjacent with no space
# between them at all. This pair is the whole argument for deleting it.
#
# The fixture is the real coloured bytes with BOTH spaces after `Tests` removed,
# so what is left is the shape a reporter that colourised the label and the
# count with no gap between them would write. It is synthetic on purpose: it is
# the boundary. Core strips it to `      Tests662 passed (662)` — a line vitest
# has never printed and never will.
seed_sandbox no-separator
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# The real coloured bytes, minus the spaces between the label and the count.
# Stripped, this line is `      Tests662 passed (662)`.
set -euo pipefail
printf '\033[2m      Tests\033[22m\033[1m\033[32m662 passed\033[39m\033[22m\033[90m (662)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a summary line whose label and count are not separated by a space' \
  "$SANDBOX" 'gate.proof-missing' --prove "proof 'suite'"

seed_sandbox no-separator-under-the-old-pattern
# The other half, and the reason the case above is not a curiosity. Put the
# escape tolerance back — only this one pattern, in this one sandbox — and the
# SAME fixture is green, because the run stands in for the missing space and
# the floor is satisfied off a line vitest would never print.
#
# This is the assertion that deletion is a TIGHTENING. Without it, "the new
# pattern refuses this line" could just mean the new pattern refuses
# everything, which the control already rules out; with it, the two verdicts
# differ because of the one clause that was deleted.
#
# THE FIXTURE IS WRITTEN AGAIN HERE, IDENTICALLY, and that is load-bearing
# rather than duplication: the only difference between the two sandboxes may be
# the pattern. Left to seed itself, this sandbox would run the repository's REAL
# gate, whose summary line has the spaces in it, and it would go green for a
# reason that has nothing to do with the clause under test — a green that
# agrees with the green the control already reports. It would still be a true
# statement, and it would be evidence of nothing.
edit "$SANDBOX/gate.yml" \
  "$SUITE_MATCH" "match: '$suite_tolerant'"
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# Byte-for-byte the same gate as the case above, which is the whole point.
set -euo pipefail
printf '\033[2m      Tests\033[22m\033[1m\033[32m662 passed\033[39m\033[22m\033[90m (662)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_green 'the same line, under the escape tolerance that was deleted: the missing space was absorbed' \
  "$SANDBOX" --prove

# The three defects this proof has to REJECT, each on the same coloured fixture
# with one thing wrong. They were the price of the escape tolerance while it was
# here — a pattern broad enough to see colour is a pattern broad enough to match
# the wrong line — and they outlived it, so they are asserted on their own terms
# now: each is a defect vitest really does produce, and each has to be red.

seed_sandbox colour-lost-tests
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# A suite that LOST tests: 300 where the floor is 662. Colour on, because
# that is the bytes the pattern now has to both match and count.
set -euo pipefail
printf '\033[2m Test Files \033[22m \033[1m\033[32m26 passed\033[39m\033[22m\033[90m (26)\033[39m\n'
printf '\033[2m      Tests \033[22m \033[1m\033[32m300 passed\033[39m\033[22m\033[90m (300)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a coloured run whose suite LOST tests: 300 against a floor of 662' \
  "$SANDBOX" 'gate.floor' --prove "proof 'suite'"

seed_sandbox colour-skipped-one
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# A suite that genuinely SKIPPED one. Both spellings are the real vitest bytes:
# the plain one and the coloured one, where the separator is itself dimmed.
# The pre-fix pattern read 2 off this line and called it a pass, which is the
# half of this packet that is a tightening rather than a workaround.
set -euo pipefail
printf '\033[2m      Tests \033[22m \033[1m\033[32m2 passed\033[39m\033[22m\033[2m | \033[22m\033[33m1 skipped\033[39m\033[90m (3)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a coloured run whose suite SKIPPED one: the proof is not satisfied by a line with a skip separator' \
  "$SANDBOX" 'gate.proof-missing' --prove "proof 'suite'"

seed_sandbox colour-skipped-one-plain
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# The same skip, on a machine whose tools do not colourise. Both spellings have
# to go red, or the tightening is a property of the runner rather than of the
# declaration — which is the exact shape of the defect being fixed.
set -euo pipefail
printf '      Tests  2 passed | 1 skipped (3)\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a PLAIN run whose suite skipped one: the same proof is refused with no escapes anywhere' \
  "$SANDBOX" 'gate.proof-missing' --prove "proof 'suite'"

seed_sandbox colour-wrong-number
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# A gate that printed the WRONG NUMBER: the file count where the test count
# should be, and no `Tests` line at all. `Test Files` is one line above the
# real summary in every vitest run, so this is not a hypothetical — it is the
# line a looser pattern would read, and 26 is below the floor and 662 would be
# the number a gate that never ran the suite could print.
set -euo pipefail
printf '\033[2m Test Files \033[22m \033[1m\033[32m26 passed\033[39m\033[22m\033[90m (26)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
expect_red 'a coloured run that printed the FILE count where the test count should be' \
  "$SANDBOX" 'gate.proof-missing' --prove "proof 'suite'"

# --- which side of MD17 `core` is on, asserted rather than skipped ---------
# The negative twin of the first colour case. It answers one question with one
# exit code: does `core` strip ANSI before it applies a pattern?
#
#   pre-fix pattern + captured coloured bytes -> gate.proof-missing
#                                              => core does NOT strip, and the
#                                                 workaround this packet deleted
#                                                 would still have been needed
#   pre-fix pattern + captured coloured bytes -> exit 0
#                                              => core DOES strip (MD17, landed),
#                                                 the pre-fix pattern is not a
#                                                 defect any more, and deleting
#                                                 the escape tolerance changed
#                                                 nothing about what this
#                                                 declaration accepts
#
# It used to SKIP on the second answer, on the reasoning that a case with
# nothing left to assert should not claim to have asserted something. That was
# the wrong call and it hid a real fact: the branch tells you which side of a
# core ruling the repository is on, and that is worth asserting. The third
# branch below is the one that stays a failure — an exit code that is neither of
# these means the checker changed in a way nobody wrote a case for.
#
# Both outcomes are printed in full, so a reader is told which one happened
# rather than being handed a tick.
seed_sandbox prefix-pattern-colour
edit "$SANDBOX/gate.yml" \
  "$SUITE_MATCH" "match: '$suite_prefix'"
write "$SANDBOX/bin/prime" <<'SH'
#!/usr/bin/env bash
# The same captured coloured bytes, against the pattern this packet replaced.
set -euo pipefail
printf '\033[2m      Tests \033[22m \033[1m\033[32m662 passed\033[39m\033[22m\033[90m (662)\033[39m\n'
printf '41 passed, 0 failed, 0 skipped\n'
printf 'self_test: 42 breakages, every check proven able to fail\n'
SH
chmod +x "$SANDBOX/bin/prime"
run_check "$SANDBOX" --prove
if [ "$EDIT_APPLIED" -eq 0 ]; then
  # Not `ok` and not a silent pass: the edit above puts the PRE-FIX pattern
  # into the sandbox, so if it did not apply the sandbox is running the
  # CURRENT pattern and this case's answer is about the wrong regex. The
  # `EDIT_APPLIED` guard is the difference between "the pre-fix pattern is red"
  # and "something I did not set up went red", and the first run of this script
  # made that mistake in front of me.
  no "the pattern this packet replaced, on the same captured coloured bytes" \
    "the edit that restores the pre-fix pattern did not apply, so the sandbox ran the
CURRENT pattern and this case's answer is about the wrong regex"
elif [ "$CHECK_CODE" -eq 1 ] && printf '%s' "$CHECK_OUT" | grep -qF "FAIL gate.proof-missing: "; then
  ok "the pattern this packet replaced is \`gate.proof-missing\` on those bytes: core does NOT strip, so the escape tolerance this packet deleted would still have been needed"
elif [ "$CHECK_CODE" -eq 0 ]; then
  ok "the pattern this packet replaced is GREEN on those same bytes: core strips ANSI before matching (MD17), which is why the escape tolerance was dead weight and why deleting it changed nothing here"
else
  no "the pattern this packet replaced, on the same captured coloured bytes" \
    "expected gate.proof-missing (core does not strip) or exit 0 (it does), got $CHECK_CODE
$CHECK_OUT"
fi

# --- and no proof in this file names a terminal escape at all ---------------
# The regression guard on the deletion itself. Every case above proves the
# pattern behaves correctly; none of them notices if somebody PUTS THE TOLERANCE
# BACK, because a pattern that tolerates escapes still satisfies every green
# case and every red case whose defect is a skip, a lost test or a missing
# separator — it just accepts the boundary line as well. This one notices.
#
# It reads the `match:` scalars and refuses any of them that contains a byte or
# an escape that can name a terminal sequence. Scoped to `match:` deliberately:
# the comments in gate.yml quote the captured bytes on purpose, and a check that
# failed on those would have to be deleted the moment somebody explained them.
# The token list is the whole set of ways the deleted run could be spelled —
# `ESC` raw, or any of the five standard backslash escapes, or the SGR shape
# itself — so re-adding it in any of those forms is caught.
if declare_escapes=$(LC_ALL=C "$PY" - "$DECLARATION" <<'PY'
import re, sys
from pathlib import Path

# Every way the deleted run could be spelled again, and nothing else:
#   * the ESC byte itself, 7-bit or 8-bit, raw or as a backslash escape;
#   * an SGR-shaped character class, `[0-9;]*m` and its private-parameter
#     variants, which is what the run was written around.
# A character class with letters in it is deliberately NOT flagged: `[a-z]` is
# an ordinary thing for a proof to match and flagging it would make this case
# wrong for every declaration except this one.
# The `-` goes LAST in that class so it is a literal hyphen rather than a
# range operator: without it the class held digits and not the `-` an SGR
# character class is written with, and the token could never match anything.
TOKENS = re.compile(r'\x1b|\x9b|\\x1[bB]|\\x9[bB]|\\033|\\e|\\u001[bB]|\[[0-9;:?-]*\][*+?]*m')

path = Path(sys.argv[1])
offenders, patterns = [], 0
for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
    line = raw.strip()
    if not line.startswith("match:"):
        continue
    patterns += 1
    body = line[len("match:"):].strip().strip("'\"")
    for token in TOKENS.finditer(body):
        offenders.append(f"line {number}: {token.group(0)!r} in {body}")
if not patterns:
    print("gate.yml declares no match: pattern at all, which is a broken file")
    raise SystemExit(1)
if offenders:
    print("\n  ".join(offenders))
    raise SystemExit(1)
PY
); then
  ok "no proof pattern in gate.yml names a terminal escape, which is what makes the escape tolerance deleted rather than dormant"
else
  no "no proof pattern in gate.yml names a terminal escape, which is what makes the escape tolerance deleted rather than dormant" \
    "a \`match:\` pattern in gate.yml can match a terminal escape:
$declare_escapes
core strips ANSI before matching (MD17), so a tolerance here is not a workaround
— it is a pattern that also accepts the lines it should refuse"
fi

# --- why the OTHER two proofs carry no escape tolerance ---------------------
# The claim in gate.yml — that `ci-shape-checks` and `check-self-test` are
# colour-free by CONSTRUCTION rather than by luck — is asserted here instead of
# being left as a comment. Both lines are bash `printf`s in
# `tests/validate-ci.sh`; if somebody teaches that file to emit colour, this
# goes red in the same commit that the proofs go red, which is the only order
# in which the two facts are still the same fact.
#
# The check is on the SOURCE, so it is instant, and it is on the source rather
# than on a run because a run proves only what one run on one machine did.
if LC_ALL=C grep -aq $'\033' "$ROOT/tests/validate-ci.sh"; then
  no "tests/validate-ci.sh still cannot emit colour, which is why two of the three proofs need no escape tolerance" \
    "found an ESC byte in tests/validate-ci.sh: it can now colourise its tally, and the
ci-shape-checks and check-self-test patterns have to say so or be fixed there"
else
  ok "tests/validate-ci.sh cannot emit colour, which is why two of the three proofs need no escape tolerance"
fi

# --------------------------------------------------------------------------
# the one case that is EXPECTED TO STAY GREEN
# --------------------------------------------------------------------------
# Not a breakage. It is the one thing in gate.yml that nothing in this
# repository can check, and it is recorded here as a limitation with a
# reproduction rather than left to be discovered by somebody who believed the
# word "checked".
#
# `selfContained: true` with an empty requirements list is a perfectly valid
# declaration of a perfectly false thing: this gate needs the npm registry and
# a Node 22.22.2, and the checker reads the DECLARATION, not the machine and
# not the network. Nothing in the tree can prove the absence of a fetch, so no
# breakage of gate.yml will ever turn this red. It is `external` being
# load-bearing in one direction only: the schema can insist that "not
# self-contained" comes with a list, and it cannot insist the list is honest.
#
# The only enforcement is a human reading `gate.yml` against a run of the gate
# on a clean machine, which is why the judgement call is argued in the file's
# comments rather than left implicit.
#
# Written whole rather than edited, because a blind spot that only reproduces
# through a two-step sed is a blind spot nobody will ever re-run.
seed_sandbox blind-spot-self-contained-true
# Hand-written rather than built from $SUITE_MATCH, and deliberately minimal:
# this case is about `external`, and a whole-file `write` with a quoted heredoc
# is the only way to keep a declaration this small readable. The pattern here
# is the plain pre-fix spelling and is not what the colour cases exercise.
write "$SANDBOX/gate.yml" <<'YML'
# Schema-valid, and false. This gate runs `npm ci`, which needs the registry.
version: 1
name: parlor

gate:
  command: [./bin/prime]
  miseTask: prime
  entrypoint: bin/prime
  timeoutSeconds: 900
  proof:
    - id: suite
      match: '^[ ]*Tests[ ]+([0-9]+) passed'
      minimum: 662

external:
  selfContained: true
  requirements: []

ci:
  workflow: .github/workflows/ci.yml
  invokes: [./bin/prime]
YML
printf '%s\n' \
  '      THE DOCUMENTED BLIND SPOT: a valid declaration of a false claim.' \
  '      The gate below really does need the npm registry, and nothing can say so.' >&2
expect_green 'the documented blind spot: a FALSE selfContained: true, which the checker cannot catch' \
  "$SANDBOX" --prove

# --------------------------------------------------------------------------
# The optional lint, under the same rule tests/validate-ci.sh follows and for
# the same reason: a skip is reported, never hidden.
# --------------------------------------------------------------------------
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -S warning "$0" >/dev/null 2>&1; then
    ok "shellcheck -S warning clean on tests/gate-declaration-self-test.sh"
  else
    no "shellcheck -S warning clean on tests/gate-declaration-self-test.sh" \
      "$(shellcheck -S warning -f gcc "$0" 2>&1 | head -5)"
  fi
else
  skipped "shellcheck is not installed, so this script was not linted here"
fi

printf '\n%d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
if [ "$fail" -ne 0 ]; then
  echo "at least one breakage did not go red, or did not go red as the finding it was for." >&2
  exit 1
fi
exit 0
