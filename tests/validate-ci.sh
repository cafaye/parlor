#!/usr/bin/env bash
# The half of parlor's gate that checks the gate.
#
# `bin/prime` proves the checkout reproduces: `npm ci` from the committed
# lockfile, the suite, and then this. This proves the *shape* of that checkout
# is still what CI assumes — one runtime pin, one lockfile contract, one gate
# command. Both run from `bin/prime`, so neither can drift away from a
# developer.
#
# Why a script and not a review: every check here is a claim CI makes about this
# repository. A `versions:` string that disagrees with `package.json`, an
# `npm install` that hides a lockfile failure, a renamed npm script the workflow
# still calls — each of those turns a green badge into a claim nobody checked.
#
# Dependency-free on purpose: node and grep only, no PyYAML, no yq, no jq. It
# runs after `npm ci`, so node is present by construction, and a CI step that
# needs an interpreter nobody declared is a step that breaks on a fresh image.
# The workflow is read as text with anchored greps rather than parsed as YAML:
# the checks are about which commands appear, not about the shape of the tree,
# and a partial parse is a worse reader than a grep that says what it wants.
#
#   bash tests/validate-ci.sh              the checks
#   bash tests/validate-ci.sh --self-test  prove they can fail (39 breakages,
#                                         plus the opposite case)
#
# `--self-test` is part of the gate, not an extra. A check nobody has watched
# go red is a check that has verified nothing (PLAN.md §1). It has already paid
# for itself: it found the `grep -q`-under-pipefail defect documented at
# `found()` below, which made one check report PASS on a tree it had just
# broken.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WF="$ROOT/.github/workflows/ci.yml"
PRIME="$ROOT/bin/prime"
PKG="$ROOT/package.json"
MISE="$ROOT/mise.toml"
MANIFEST="$ROOT/cafaye.yml"
# The path kit documents for a caller. GitHub resolves a reusable workflow at
# {owner}/{repo}/.github/workflows/{file}@{ref} and documents that
# subdirectories of the workflows directory are unsupported, so the older
# `cafaye/kit/workflows/ci.reusable.yml@master` resolves to nothing and every
# caller using it has a red build. kit-04 moves the file; this is the only
# spelling that can ever work.
USES_LINE='uses: cafaye/kit/.github/workflows/ci.reusable.yml@master'
DEAD_USES='cafaye/kit/workflows/ci.reusable.yml@'
# The lockfile `npm ci` consumes. CI fails when the gate moves it; see the
# prime job in the workflow for why that is the desired failure.
LOCKFILE=package-lock.json
# The end-to-end tier's own files. They are read by the same checks as the rest
# of CI, because a claim CI makes about a tier is a claim about the shape of the
# tree, and this tier has several that can be true while the tier still does not
# run (see the end-to-end section below).
E2E_WF="$ROOT/.github/workflows/e2e.yml"
E2E_COMPOSE="$ROOT/e2e/docker-compose.yml"
PW_CONFIG="$ROOT/playwright.config.ts"
E2E_RUNNER="$ROOT/bin/e2e"
# The first host port the stack publishes and the last. A port block is a block
# because a reader can tell at a glance that nothing in it collides; a check
# that only looked at the first port would pass with 5432 in the middle of it.
E2E_PORT_FIRST=16000
E2E_PORT_LAST=16099
# The ports the rest of the workspace already owns, which the block must not
# enter: the observability stack (grafana 15000, postgres 15500, nats 15600 and
# 15700, redis 15800, tempo 15900, loki 15901, mimir 15902), the identity-07
# worker's postgres on 5437, darkroom's test postgres on 55432, and the standard
# service ports a developer's own stack is on. The colleagues are listed here
# rather than only implied, because a block is a promise about *this* stack and
# a collision with somebody else's stack on the same machine is the collision
# the packet for this file names first.
E2E_RESERVED_PORTS="3000 5432 5437 6379 8080 8888 15000 15500 15600 15700 15800 15900 15901 15902 55432"
# The deployment story's own files. They are read by the same checks as the rest
# of CI because a claim CI makes about a deploy is a claim about the shape of the
# tree, and these three files can be perfectly well formed and still deploy
# nothing: a `config/deploy.yml` that names an accessory, a Dockerfile that
# takes a build arg nobody sets, or a verification script nobody may execute.
DEPLOY_CONFIG="$ROOT/config/deploy.yml"
DOCKERFILE="$ROOT/Dockerfile"
DEPLOY_RUNNER="$ROOT/bin/deploy-config"

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

# Read one field out of package.json, by dotted path. An absent key reads as
# the empty string rather than throwing, so a missing pin fails a check with a
# sentence about the pin rather than a stack trace about the reader.
pkg_field() {
  node -e '
    let v = require(process.argv[1]);
    for (const key of process.argv[2].split(".")) {
      if (v === null || typeof v !== "object" || !(key in v)) { v = undefined; break }
      v = v[key];
    }
    process.stdout.write(v === undefined ? "" : String(v));
  ' "$PKG" "$1"
}

pkg_has_script() {
  node -e 'const s=(require(process.argv[1]).scripts)||{};process.stdout.write(process.argv[2] in s ? "yes" : "no")' "$PKG" "$1"
}

# The pin of record. It lives in package.json because that is the one file npm,
# Corepack and CI all read. mise.toml mirrors it for a developer's local
# toolchain, the workflow restates it for kit. That is the same number in three
# places, which is three pins unless something holds them together — these
# functions and the checks below are that something.
#
# It used to be four: cafaye.yml recorded the major line too. It does not
# anymore, and that is not this file losing interest. Core's manifest schema
# sets additionalProperties:false and has no `runtime` key, so the draft
# manifest's `spec.runtime.node` was a violation rather than a mirror — the file
# is now core's shape and every key in it is one core allows. The manifest's
# silence is checked below, so the fourth pin cannot grow back.
pin_of_record() {
  pkg_field engines.node
}

pin_in_mise() {
  sed -n 's/^[[:space:]]*node[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$MISE" | head -1
}

pin_in_workflow() {
  sed -n "s/.*\"node\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$WF" | head -1
}

# Whether cafaye.yml declares `key` as a real key, printing "yes" or nothing.
#
# Comments are stripped first, and that is not tidiness. This manifest now
# records the facts it dropped *inside prose*, at length — a comment naming
# `node: "22"` and one saying why it is gone — so a reader that does not strip
# comments finds every one of them "declared". A check that reads its subject out
# of a sentence about its subject has not read the subject. This is the same trap
# `code_lines` documents for the workflow below, met from the other side.
#
# It prints the empty string for absent rather than exiting non-zero, so the
# caller writes `[ -n "$(...)" ]` and reads the answer directly.
manifest_declares() {
  sed 's/[[:space:]]*#.*$//' "$MANIFEST" \
    | sed -n "s/^[[:space:]]*$1[[:space:]]*:.*/yes/p" \
    | head -1
}

# The message every one of these four checks shares: the key is absent from
# core's schema, so writing it here is drift the moment someone adds it back.
manifest_is_core_owned() {
  printf 'cafaye.yml has a `%s:` key; core'"'"'s manifest schema has no place for it, and the fact belongs in the file named above' "$1"
}

# The workflow with its comments stripped, so every command check below reads
# what the workflow *does* rather than what it says about itself. Without this,
# a comment explaining "never npm install here" fails the very check that
# forbids npm install — and a check that punishes the warning it should be
# encouraging is a check that gets deleted within a month.
code_lines() {
  sed 's/[[:space:]]*#.*$//' "$1" | grep -v '^[[:space:]]*$'
}

# NOT `some-pipeline | grep -q pattern`. Under `set -o pipefail` that is a trap:
# `grep -q` exits on its first match, the writer on the left takes SIGPIPE and
# exits 141, and the pipeline reports 141 — so a check that found exactly what
# it was looking for reads as "not found" and passes. It was not a theory: the
# `npm install` check below reported PASS on a tree the self-test had just
# broken, for this reason and no other. Every match here is captured into a
# variable and tested for emptiness, which has no early exit to lose.
# `|| true` is for grep's exit 1 on no match, not for hiding a failure.
found() {
  grep -E "$1" || true
}

found_fixed() {
  grep -F "$1" || true
}

# Prints a file with its comments removed, so a check can ask about CODE.
#
# Three comment syntaxes, because this walks both TypeScript and the Dockerfile:
# `/* … */` blocks (the ` * ` continuation lines of a JSDoc header are the reason
# this exists — a `sed 's://.*::'` leaves them and reports a file that only
# explains a change as having made it), `//` line comments, and the Dockerfile's
# own `#` lines.
#
# A regex rather than a parser, and honestly so: a `/*` inside a string literal
# would open a comment that never closes. Nothing in this repository writes one,
# and the assertion that does not depend on this at all is the one over the BUILT
# client chunks in `src/app/v1/[...path]/route.test.ts`.
strip_comments() {
  node -e '
    let source = require("fs").readFileSync(0, "utf8");
    source = source.replace(/\/\*[\s\S]*?\*\//g, "");
    source = source.replace(/\/\/[^\n]*/g, "");
    source = source.replace(/^[ \t]*#[^\n]*/gm, "");
    process.stdout.write(source);
  '
}

# --- the workflow exists, and calls kit at the path that resolves -----------
if [ -f "$WF" ]; then
  ok "ci.yml exists"
else
  no "ci.yml exists" "$WF is missing; nothing runs the gate on a pull request"
  printf '\n0 passed, 1 failed, 0 skipped — every other check needs the workflow.\n'
  exit 1
fi

if [ -n "$(code_lines "$WF" | found_fixed "$USES_LINE")" ]; then
  ok "calls kit's reusable workflow at the documented path"
else
  no "calls kit's reusable workflow at the documented path" \
    "expected the line: $USES_LINE"
fi

if [ -n "$(code_lines "$WF" | found_fixed "$DEAD_USES")" ]; then
  no "no call to the unreachable kit path" \
    "$DEAD_USES resolves to nothing; a caller using it has a red build"
else
  ok "no call to the unreachable kit path"
fi

# --- `language` is read out of the repository, not assumed ------------------
# The value has to follow the lockfile that is actually committed: `bun` consumes
# bun.lock and installs frozen from it, `node` consumes package-lock.json. If
# someone adds bun.lock and keeps `language: node`, the node job would run
# `npm ci` against a tree that has no npm lockfile to read.
if [ -f "$ROOT/bun.lock" ] || [ -f "$ROOT/bun.lockb" ]; then
  if grep -qE '^[[:space:]]*language:[[:space:]]*bun[[:space:]]*$' "$WF"; then
    ok "language: bun matches a bun lockfile"
  else
    no "language: bun matches a bun lockfile" \
      "bun.lock is committed but the workflow does not pass language: bun"
  fi
elif [ -f "$ROOT/$LOCKFILE" ]; then
  if grep -qE '^[[:space:]]*language:[[:space:]]*node[[:space:]]*$' "$WF"; then
    ok "language: node matches package-lock.json"
  else
    no "language: node matches package-lock.json" \
      "$LOCKFILE is the committed lockfile, so the shared job must be language: node"
  fi
else
  no "a committed lockfile exists" \
    "neither $LOCKFILE nor bun.lock is in the tree; the shared job has nothing to install from"
fi

# --- the runtime pin, declared where every tool can read it -----------------
PIN=$(pin_of_record)
if [ -z "$PIN" ]; then
  no "package.json pins the runtime" \
    "engines.node is absent, so a pin that lives only in the workflow is a pin the next contributor silently loses"
elif [ -n "$(printf '%s' "$PIN" | found '[\^~><*xX[:space:]]')" ]; then
  no "the runtime pin is exact" \
    "engines.node is \"$PIN\"; a range lets a suite pass on whichever patch the image was cached with"
else
  ok "package.json pins the runtime ($PIN)"
fi

MISE_PIN=$(pin_in_mise)
if [ "$MISE_PIN" = "$PIN" ]; then
  ok "mise.toml agrees with package.json ($PIN)"
else
  no "mise.toml agrees with package.json" \
    "mise.toml says ${MISE_PIN:-<none>}, package.json says ${PIN:-<none>}"
fi

WF_PIN=$(pin_in_workflow)
if [ "$WF_PIN" = "$PIN" ]; then
  ok "the workflow hands kit the same pin ($PIN)"
else
  no "the workflow hands kit the same pin" \
    "the workflow passes ${WF_PIN:-<none>} to kit; package.json pins ${PIN:-<none>}"
fi

# The manifest is silent about the node pin, and that is the check.
#
# The pin of record is engines.node in package.json, mirrored by mise.toml and
# the workflow; the three checks above hold those together. The manifest cannot
# be a fourth mirror, because core's schema sets additionalProperties:false and
# has no `runtime` key — `spec.runtime.node` is a violation the harness reports,
# not a mirror anything reads.
#
# So what remains is the check that stops a fourth copy being written back by
# somebody who finds `node: "22"` useful. Nothing else here can catch it: core's
# contract checker is the one thing that reads the manifest against the schema,
# and it is offline-only precisely because `bin/prime` must not need a sibling
# core checkout. Without this, the key would land and sit here disagreeing with
# the pin until the next time somebody bumped Node.
#
# The empty case needs no special handling, which is the whole reason it is
# worth stating: the predicate answers "does this key exist", so "absent" is the
# passing answer and there is no pattern that matches every input when a line
# goes missing. The earlier form of this check read the major out of the manifest
# and compared it, and needed four lines of comment to explain why a missing line
# had to be handled separately. This one cannot pass by accident.
if [ -z "$(manifest_declares node)" ]; then
  ok "cafaye.yml declares no node pin, so the pin stays in its three homes"
else
  no "cafaye.yml declares no node pin, so the pin stays in its three homes" \
    "$(manifest_is_core_owned node)"
fi

# The package manager is the one fact whose check had to MOVE rather than
# invert. package.json records `packageManager: npm@10.9.7` and nothing checked
# it; the manifest recorded the bare word `npm` and that was the only place the
# package manager was checked at all. Checking the manifest's silence alone
# would have quietly deleted the check, which is the failure this file exists to
# catch, so the assertion lands on package.json instead — one file shallower and
# one word more precise, since the field carries a version and `npm` did not.
#
# Both halves are in this one check on purpose: "npm is the package manager" and
# "package.json is the only place that says so" are one fact with two failure
# modes, and splitting them would spend a check slot on the arithmetic.
PM=$(pkg_field packageManager)
if [ "${PM%%@*}" = "npm" ] && [ -z "$(manifest_declares packageManager)" ]; then
  ok "package.json declares npm as the package manager, and only package.json does"
else
  no "package.json declares npm as the package manager, and only package.json does" \
    "package.json's packageManager is '${PM:-<absent>}'${PM:+} (want npm@<version>)$( [ -n "$(manifest_declares packageManager)" ] && printf '; ' && manifest_is_core_owned packageManager )"
fi

# --- `npm ci`, never `npm install` ------------------------------------------
# `npm ci` failing because a lockfile is out of sync is the desired behaviour:
# it is the one install that refuses to drift. `npm install` in a CI path
# resolves that disagreement silently and writes the resolution into the
# tree, so the disagreement reaches master dressed as a passing build.
npm_installs=$({ code_lines "$WF"; cat "$PRIME"; } | found '(^|[^-[:alnum:]])npm[[:space:]]+install')
if [ -n "$npm_installs" ]; then
  no "no npm install in any CI path" \
    "found: $npm_installs — npm ci is the frozen install and npm install is not"
else
  ok "no npm install in any CI path (prose ignored)"
fi

# --- the lockfile guard ----------------------------------------------------
guard=$(code_lines "$WF" | found 'git[[:space:]]+diff[[:space:]]+--exit-code([^[:space:]]|[[:space:]]+--)?[[:space:]].*'"$LOCKFILE")
if [ -n "$guard" ]; then
  ok "CI fails when the gate moves $LOCKFILE"
else
  no "CI fails when the gate moves $LOCKFILE" \
    "no 'git diff --exit-code ... $LOCKFILE' step in the workflow"
fi

# --- every npm script the workflow calls still exists ----------------------
# A renamed script with a stale caller is an npm error, not a test failure, so
# it would read as infrastructure noise on the one run that should have been
# about the code.
missing_scripts=""
called_scripts=$(code_lines "$WF" | grep -oE 'npm run [a-zA-Z0-9:_-]+' | awk '{print $3}' | sort -u)
for script in $called_scripts; do
  if [ "$(pkg_has_script "$script")" = "no" ]; then
    missing_scripts="$missing_scripts $script"
  fi
done
if [ -z "$missing_scripts" ]; then
  if [ -z "$called_scripts" ]; then
    no "every npm script the workflow calls exists" \
      "the workflow calls no npm run script at all, which cannot be right"
  else
    ok "every npm script the workflow calls exists ($(echo "$called_scripts" | tr '\n' ' '))"
  fi
else
  no "every npm script the workflow calls exists" \
    "not in package.json scripts:$missing_scripts"
fi

# --- `bin/prime` is the gate, and it is the command CI runs -----------------
# Done means #5: the gate in CI is the command a developer runs, not a
# hand-assembled list of npm scripts. If the two can disagree, one of them is
# lying, and only the shared one can be trusted.
if [ -n "$(code_lines "$WF" | found_fixed './bin/prime')" ]; then
  ok "CI runs ./bin/prime"
else
  no "CI runs ./bin/prime" \
    "the workflow does not invoke ./bin/prime, so CI and a developer run different commands"
fi

if [ -x "$PRIME" ]; then
  ok "bin/prime is executable"
else
  no "bin/prime is executable" "$PRIME is not chmod +x"
fi

# The gate is two commands and its own header says a green run means the
# checkout reproduces. An extra install in here would change what that means.
prime_commands=$(grep -oE '^(npm|bun|yarn|pnpm)( ci| install| test)?$' "$PRIME" | tr '\n' ' ')
if [ "$prime_commands" = "npm ci npm test " ]; then
  ok "bin/prime runs exactly npm ci then npm test"
else
  no "bin/prime runs exactly npm ci then npm test" \
    "found: ${prime_commands:-<nothing>}"
fi

# The manifest no longer names the gate, and these two checks replace the ones
# that held the two answers to each other.
#
# Previously `spec.quality.prime` said ./bin/prime and this file compared it to
# the script, on the reasoning that "if the two can disagree, one of them is
# lying." The disagreement is now impossible rather than prevented: the gate is
# declared once, by bin/prime itself, and CI is checked above to run that script
# (`CI runs ./bin/prime`). The manifest's `spec.quality` had no place in core's
# schema, so keeping the comparison would have meant keeping the draft.
#
# What replaces it is the check that stops the manifest naming a gate again.
# That is not hypothetical politeness: a manifest that says `./bin/other` reads
# as authoritative to anyone who reads the manifest first, and bin/prime would
# keep passing, because the workflow check is looking at the workflow.
if [ -z "$(manifest_declares prime)" ]; then
  ok "cafaye.yml declares no gate command, so bin/prime is the only answer"
else
  no "cafaye.yml declares no gate command, so bin/prime is the only answer" \
    "$(manifest_is_core_owned prime)"
fi
if [ -z "$(manifest_declares test)" ]; then
  ok "cafaye.yml declares no test command, so bin/prime is the only answer"
else
  no "cafaye.yml declares no test command, so bin/prime is the only answer" \
    "$(manifest_is_core_owned test)"
fi

# ---------------------------------------------------------------------------
# The end-to-end tier
# ---------------------------------------------------------------------------
# Every check in this section is a claim about whether the tier can be green
# without having run, or can run and leave a credential on disk. Both have
# happened in this fleet: PLAN.md's risk register names "a CI job which silently
# skips its hard half is worse than no CI, because a green badge is a claim", and
# this tier's own artifact scan was green on a leak until it was taught to read
# inside a zip. A check here that has never gone red is a rubber stamp, so the
# self-test at the bottom breaks the tree this many ways.

# The workflow exists, and it is its own workflow. The end-to-end tier is not in
# ci.yml: a whole stack of containers, three image builds and a browser download
# are not part of a per-commit gate, and putting them there is how a gate starts
# being skipped.
if [ -f "$E2E_WF" ]; then
  ok "e2e.yml exists"
else
  no "e2e.yml exists" "$E2E_WF is missing; the end-to-end tier has no CI job"
fi

if [ -f "$E2E_WF" ] && [ -f "$WF" ]; then
  if [ -n "$(code_lines "$WF" | found_fixed './bin/e2e')" ]; then
    no "the end-to-end tier is not in the per-commit gate" \
      "ci.yml invokes ./bin/e2e; bin/prime is a per-commit gate and a whole stack does not belong in it"
  else
    ok "the end-to-end tier is not in the per-commit gate"
  fi

  if [ -n "$(code_lines "$PRIME" | found_fixed 'e2e')" ]; then
    no "bin/prime does not run the end-to-end tier" \
      "bin/prime mentions e2e; a whole stack in the per-commit gate is the failure this is checking for"
  else
    ok "bin/prime does not run the end-to-end tier"
  fi
fi

# The job runs the tier through the one script, so a developer and CI cannot
# disagree about what "the end-to-end tier" is.
if [ -f "$E2E_WF" ] && [ -n "$(code_lines "$E2E_WF" | found_fixed './bin/e2e')" ]; then
  ok "the e2e job runs ./bin/e2e"
else
  no "the e2e job runs ./bin/e2e" \
    "the job must call the same command a developer runs, not a hand-assembled list of steps"
fi

# The job cannot be a soft failure. `continue-on-error` on the job or on any step
# is a green badge over a tier that did not run.
if [ -f "$E2E_WF" ]; then
  if [ -n "$(code_lines "$E2E_WF" | found 'continue-on-error')" ]; then
    no "the e2e job cannot be a soft failure" \
      "continue-on-error is set; a green badge over a tier that did not run is worse than no job"
  else
    ok "the e2e job cannot be a soft failure"
  fi

  if [ -n "$(code_lines "$E2E_WF" | found_fixed 'tests/assert-e2e-ran.mjs')" ]; then
    ok "the e2e job fails when the tier ran nothing"
  else
    no "the e2e job fails when the tier ran nothing" \
      "no call to tests/assert-e2e-ran.mjs; the job would go green over a filtered-out suite"
  fi
fi

if [ -x "$E2E_RUNNER" ]; then
  ok "bin/e2e is executable"
else
  no "bin/e2e is executable" "$E2E_RUNNER is not chmod +x"
fi

# `MINIMUM_TESTS` is duplicated in two files on purpose — one is a shell-time
# reader and the other runs after Playwright has exited — and the duplication is
# a value that can drift. It is checked here rather than left to a comment.
minimum_tests() {
  sed -n 's/^const MINIMUM_TESTS = \([0-9][0-9]*\);.*/\1/p' "$1"
}
if [ -f "$ROOT/tests/assert-e2e-ran.mjs" ] && [ -f "$ROOT/e2e/no-token-artifacts.ts" ]; then
  reader_floor=$(minimum_tests "$ROOT/tests/assert-e2e-ran.mjs")
  teardown_floor=$(minimum_tests "$ROOT/e2e/no-token-artifacts.ts")
  if [ -n "$reader_floor" ] && [ "$reader_floor" = "$teardown_floor" ]; then
    ok "both readers of the report agree on the test floor ($reader_floor)"
  else
    no "both readers of the report agree on the test floor" \
      "tests/assert-e2e-ran.mjs says '${reader_floor:-<none>}', e2e/no-token-artifacts.ts says '${teardown_floor:-<none>}'"
  fi
else
  no "both readers of the report agree on the test floor" \
    "tests/assert-e2e-ran.mjs and e2e/no-token-artifacts.ts are both required"
fi

# The credential guard is a config setting, and this is the check that catches it
# BEFORE a browser runs. `trace: "on"`, `retain-on-failure` and every other
# non-off value record network traffic, and this suite's traffic carries
# `Authorization: Bearer <session token>`. The artifact scan in
# e2e/no-token-artifacts.ts is the second line; this is the first, and a first
# line that costs nothing is worth having.
if [ -f "$PW_CONFIG" ]; then
  for setting in trace video; do
    value=$(sed -n "s/^[[:space:]]*$setting:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$PW_CONFIG" | head -1)
    if [ "$value" = "off" ]; then
      ok "playwright $setting is off, so the run records no network traffic"
    else
      no "playwright $setting is off, so the run records no network traffic" \
        "$setting is ${value:-<unset>}; a trace or a video is recorded network traffic and this suite's is authenticated"
    fi
  done
else
  no "playwright trace and video are off" "$PW_CONFIG is missing"
fi

# `retries: 0` is a position, not a default. A raised retry count is a way of
# not finding out that the stack is flaky, and this check exists so the change
# cannot be made quietly and then read as a green tier.
if [ -f "$PW_CONFIG" ]; then
  retries=$(sed -n 's/^[[:space:]]*retries:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$PW_CONFIG" | head -1)
  if [ "$retries" = "0" ]; then
    ok "playwright retries is 0, and the tier refuses to raise it"
  else
    no "playwright retries is 0, and the tier refuses to raise it" \
      "retries is ${retries:-<unset>}; a retry count hides a real flake rather than reporting it"
  fi
fi

# No skip mechanism anywhere in the tier. `test.skip`, `test.fixme` and a
# conditional skip are the same failure wearing different clothes, and PLAN.md
# §1 is explicit that a skip nobody is forced to notice is not a pass.
if [ -d "$ROOT/e2e" ]; then
  # Comment lines are excluded, and that is the same trap the `npm install`
  # check hit and documents at `code_lines`: this file's own comment says the
  # tier has no `test.skip`, and a grep that reads comments fails the tier for
  # documenting itself. A check that punishes the warning it wants written is a
  # check that gets deleted within a month.
  skips=$(grep -rnE 'test\.(skip|fixme)' "$ROOT/e2e" 2>/dev/null \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' || true)
  if [ -z "$skips" ]; then
    ok "the end-to-end tier has no skip mechanism"
  else
    no "the end-to-end tier has no skip mechanism" "$(echo "$skips" | head -3)"
  fi
fi

# --- the port block --------------------------------------------------------
# The brief for this file asks for a documented high port block that collides
# with nothing. A block described in a comment and drifted into a standard port
# is a collision the second developer on the machine hits, so the numbers are
# read out of the compose file and checked rather than trusted.
if [ -f "$E2E_COMPOSE" ]; then
  # Every `${E2E_*_PORT:-<n>}` default. The substitution's default is the port a
  # bare `docker compose up` publishes, which is the number that has to be right.
  # The default is extracted with `sed` rather than a second `grep -oE '[0-9]+$'`,
  # because a substituted port is followed by `}` and not by a digit: the anchored
  # form matches nothing and the check reports "no ports found" on a compose file
  # full of them. A check that is silently blind is the failure this whole file
  # exists to prevent, and this one was that, once.
  block=$(grep -oE '\$\{E2E_[A-Z_]*PORT:-[0-9]+\}' "$E2E_COMPOSE" \
    | sed -nE 's/.*:-([0-9]+)\}$/\1/p' || true)
  if [ -z "$block" ]; then
    no "every published port is a substitution with a default" \
      "no \${E2E_*PORT:-n} in $E2E_COMPOSE"
  else
    bad=""
    for port in $block; do
      if [ "$port" -lt "$E2E_PORT_FIRST" ] || [ "$port" -gt "$E2E_PORT_LAST" ]; then
        bad="$bad $port(out of block)"
        continue
      fi
      for reserved in $E2E_RESERVED_PORTS; do
        if [ "$port" = "$reserved" ]; then
          bad="$bad $port(reserved)"
        fi
      done
    done
    if [ -z "$bad" ]; then
      ok "the whole port block is in ${E2E_PORT_FIRST}-${E2E_PORT_LAST} and collides with nothing reserved"
    else
      no "the whole port block is in ${E2E_PORT_FIRST}-${E2E_PORT_LAST} and collides with nothing reserved" \
        "offending ports:$bad"
    fi
  fi

  # Every published port is a `${E2E_*_PORT:-n}` substitution, and every image is
  # pinned to an exact tag. A literal host port in a compose file is a collision
  # the second developer on the machine hits, and `latest` is a stack that
  # changes under you between two runs of the same command. Both of kit's rules,
  # restated here because the file being checked is this repository's and kit's
  # script reads kit's template.
  published_lines=$(sed 's/[[:space:]]*#.*$//' "$E2E_COMPOSE" \
    | awk '/^[[:space:]]*ports:[[:space:]]*$/ { inports = 1; next }
           inports && /^[[:space:]]*-[[:space:]]/ { print; next }
           inports && /^[[:space:]]*[^[:space:]-]/ { inports = 0 }')
  if [ -z "$published_lines" ]; then
    no "every published port in the stack is a substitution" \
      "no ports: lists found in $E2E_COMPOSE"
  else
    # `[[:space:]]` and not `\s`: BSD grep does not know `\s`, so a pattern
    # using it matches nothing and every line reads as a literal. `[A-Za-z0-9_]`
    # and not `[A-Z_]`: a variable name with a digit in it — E2E_EDGE_PORT is
    # the one that caught this — is not matched by a letters-and-underscore
    # class, and a check whose pattern is quietly wrong is worse than no check.
    literals=$(printf '%s\n' "$published_lines" | grep -vE '^[[:space:]]*-[[:space:]]+"\$\{[A-Za-z0-9_]+:-[0-9]+\}' || true)
    if [ -z "$literals" ]; then
      ok "every published port in the stack is a substitution ($(printf '%s\n' "$published_lines" | wc -l | tr -d ' ') entries)"
    else
      no "every published port in the stack is a substitution" \
        "these are literal:$(printf '%s' "$literals" | tr '\n' ' ')"
    fi
  fi

  unpinned=$(sed 's/[[:space:]]*#.*$//' "$E2E_COMPOSE" \
    | grep -oE '^[[:space:]]*image:[[:space:]]*[^[:space:]]+' \
    | sed 's/.*image:[[:space:]]*//' \
    | awk '{ tag = ($0 ~ /:/) ? $0 : $0 ":latest"; n = split(tag, parts, ":"); last = parts[n]; if (last == "" || last == "latest") print $0 }' || true)
  if [ -z "$unpinned" ]; then
    ok "every image in the stack is pinned to an exact tag"
  else
    no "every image in the stack is pinned to an exact tag" \
      "unpinned:$(printf '%s' "$unpinned" | tr '\n' ' ')"
  fi

  # The defaults the Playwright config falls back to must be the same numbers.
  # bin/e2e resolves the ports out of the compose file, so the fallback only
  # matters for a bare `npx playwright test` — which is exactly the invocation
  # that skips the harness, and therefore the one where a wrong fallback points
  # at somebody else's stack.
  config_ports=$(grep -oE '"E2E_[A-Z_]*PORT", "[0-9]+"' "$PW_CONFIG" \
    | sed -nE 's/.*"([0-9]+)"$/\1/p' || true)
  mismatch=""
  for port in $config_ports; do
    if ! printf '%s\n' $block | grep -qx "$port"; then
      mismatch="$mismatch $port"
    fi
  done
  if [ -z "$config_ports" ]; then
    no "playwright's port fallbacks are the compose file's" \
      "no \"E2E_*_PORT\", \"<n>\" fallback in $PW_CONFIG"
  elif [ -z "$mismatch" ]; then
    ok "playwright's port fallbacks are the compose file's"
  else
    no "playwright's port fallbacks are the compose file's" \
      "in playwright.config.ts but not in the compose document:$mismatch"
  fi
fi

# Every service in the stack either has a healthcheck or a comment saying why it
# cannot. A `docker compose up --wait` cannot mean anything without a health
# signal, and the one service here that has none — identity, whose distroless
# image has no HTTP client — has to have said so where a reader will find it.
if [ -f "$E2E_COMPOSE" ]; then
  # Only the keys under `services:`. The document also declares `networks:` and
  # `volumes:` at the same indentation, and a scan that took all of them would
  # report `platform` and the two volume names as services with no healthcheck.
  # Only the keys under `services:`, and each one WITH the comment block
  # immediately above it. Both halves are load-bearing:
  #   * the document also declares `networks:` and `volumes:` at the same
  #     indentation, and a scan that took all of them would report `platform`
  #     and the two volume names as services with no healthcheck;
  #   * a service's finding is written as the comment above its key, which is
  #     where a reader looks for it. A check that read only the indented body
  #     would fail a file that says the thing in the right place, and the fix a
  #     tired author would reach for is to move the note somewhere useless.
  services=$(awk '
    /^services:[[:space:]]*$/ { inside = 1; next }
    inside && /^[a-z]/ { inside = 0 }
    !inside { next }
    /^  [a-z][a-z0-9-]*:[[:space:]]*$/ {
      name = $1
      sub(/:$/, "", name)
      print name
    }
  ' "$E2E_COMPOSE" || true)

  # One service: its key line, the comment block directly above it, and
  # everything indented under it.
  #
  # The comment block is BUFFERED rather than read afterwards, because awk sees
  # the comments before it sees the key they belong to. A version that turned
  # `inside` on at the key line never saw them at all, and the check then failed
  # a file whose finding was written exactly where a reader would look for it —
  # which is the shape of a check that pushes an author to write the note
  # somewhere useless.
  service_block() {
    awk -v want="$1" '
      function flush_buffer() { printf "%s", buffer; buffer = "" }
      /^  [a-z][a-z0-9-]*:[[:space:]]*$/ {
        name = $1
        sub(/:$/, "", name)
        if (name == want) { flush_buffer(); inside = 1; found = 1; next }
        buffer = ""
        if (inside) { inside = 0 }
        next
      }
      !inside && /^[ ]*#/ { buffer = buffer $0 "\n"; next }
      !inside { next }
      { print }
      END { if (!found) exit 1 }
    ' "$E2E_COMPOSE"
  }

  if [ -z "$services" ]; then
    no "every service in the stack has a healthcheck or a stated finding" \
      "no services parsed out of $E2E_COMPOSE"
  else
    unhealthy=""
    for service in $services; do
      block_text=$(service_block "$service")
      if ! printf '%s' "$block_text" | grep -q 'healthcheck:'; then
        # No healthcheck is acceptable only with the finding stated, and the
        # finding has to be in the SERVICE's own block. One sentence in the file
        # header would otherwise license a missing check on every service below
        # it, which is a check that verifies nothing.
        if printf '%s' "$block_text" | grep -qi 'FINDING'; then
          :
        else
          unhealthy="$unhealthy $service"
        fi
      fi
    done
    if [ -z "$unhealthy" ]; then
      ok "every service in the stack has a healthcheck or a stated finding"
    else
      no "every service in the stack has a healthcheck or a stated finding" \
        "no healthcheck and no FINDING in:$unhealthy"
    fi
  fi
fi

# --- the deployment story, in the four shapes CI assumes --------------------
# These four checks are about the SHAPE, and every one of them needs no kamal,
# no docker and no network — which is why they are here rather than only in
# `bin/deploy-config`. That script is the one that runs the real binaries, and it
# is a separate tier because neither kamal nor ruby is on a CI runner; a
# deployment property that only the tier with the real binaries can see would be
# a property nobody checked on a pull request.
#
# What is deliberately NOT here: the healthcheck path. `src/app/readyz/
# route.test.ts` owns that one, because the property is not "the file says
# /readyz" — it is "the path the rollout gate uses is a path this application
# serves", and only the test can see both halves. A check here would be a weaker
# version of the same assertion with a second place to update.

# C1. The deploy config exists and keeps no database. The absence of a postgres
#     accessory is a DECISION (parlor's state is identity's, and nothing in this
#     repository writes to a datastore), and a decision nobody can check becomes
#     an omission the next template re-copy silently fills. Same for
#     `config/kamal-backup.yml`: there is no backup accessory to mount it, so a
#     committed one would be a document no process opens. The check is on the
#     COMMENT-STRIPPED file, because this configuration explains the decision at
#     length and names DATABASE_URL while doing it — a reader that matched the
#     prose would report a database in a file that has none.
if [ ! -f "$DEPLOY_CONFIG" ]; then
  no "config/deploy.yml exists and declares no database" \
    "$DEPLOY_CONFIG is missing; the other three deploy checks read it"
  no "every builder arg in config/deploy.yml is a Dockerfile ARG" \
    "skipped: $DEPLOY_CONFIG is missing"
else
  DEPLOY_CODE=$(code_lines "$DEPLOY_CONFIG")
  if [ -n "$(printf '%s\n' "$DEPLOY_CODE" | found '^accessories:')" ] \
    || [ -n "$(printf '%s\n' "$DEPLOY_CODE" | found '(DATABASE_URL|DATABASE_PASSWORD|POSTGRES_PASSWORD|RESTIC_|AWS_SECRET_ACCESS_KEY)')" ] \
    || [ -f "$ROOT/config/kamal-backup.yml" ]; then
    no "config/deploy.yml exists and declares no database" \
      "an accessories block, a database credential, or a config/kamal-backup.yml with nothing to mount it into; parlor keeps no state of its own and the decision is written in config/deploy.yml"
  else
    ok "config/deploy.yml exists and declares no database"
  fi

  # C2. The cross-file contract, and the one whose failure is invisible.
  #
  # `next build` substitutes every `NEXT_PUBLIC_*` at BUILD time, so a service
  # address cannot be set at run time at all — which is why the deploy config
  # passes it as a build arg. The trap is the join: `docker build --build-arg`
  # for a name the Dockerfile does not declare is a WARNING, so renaming a key on
  # one side leaves the other side's `ARG` untouched, the build exits 0, and the
  # image ships an app pointed at the compiled-in localhost default. Each file is
  # internally consistent and the PAIR is wrong, which is the case a per-file
  # check cannot see — kit's own `kamal_test.sh` §2 exists for the same shape.
  #
  # Read GENERICALLY, off the interpolated keys rather than off hardcoded names:
  # the day a third build arg arrives, this has already been asked the right
  # question.
  #
  # SCOPED TO THE `args:` BLOCK SINCE THE BFF, and the scoping is the point. The
  # regex used to be `'^[[:space:]]+[A-Z][A-Z0-9_]*:[[:space:]]*<%='` over the whole
  # file, which matched any interpolated environment variable anywhere — correct
  # while the service addresses were the only interpolated values there were, and
  # wrong the moment `env.clear` grew any, because a run-time variable is not a
  # build arg and `docker build --build-arg` for it would be a warning. It failed
  # on the BFF's own configuration, which is the measure of how much the broad
  # pattern was carrying an assumption instead of a rule.
  #
  # Emptiness is still a FAILURE. A check that greps a file for a key it did not
  # find is exactly the check that passes on a config that stopped configuring
  # anything — and the way this stays honest while the BFF means there are no
  # build args left is C2b below, which asks the positive question instead.
  deploy_args=$(printf '%s\n' "$DEPLOY_CODE" \
    | awk '/^[[:space:]]*args:[[:space:]]*$/ { in_args = 1; next }
           /^[^[:space:]]/ { in_args = 0 }
           in_args' \
    | found '^[[:space:]]+[A-Z][A-Z0-9_]*:[[:space:]]*<%=' \
    | sed 's/^[[:space:]]*//; s/:.*//')
  if [ -n "$deploy_args" ]; then
    unmatched=""
    for arg in $deploy_args; do
      if [ -z "$(found "^ARG ${arg}=" <"$DOCKERFILE")" ]; then
        unmatched="$unmatched $arg"
      fi
    done
    if [ -z "$unmatched" ]; then
      ok "every builder arg in config/deploy.yml is a Dockerfile ARG (${deploy_args//$'\n'/, })"
    else
      no "every builder arg in config/deploy.yml is a Dockerfile ARG" \
        "the Dockerfile declares no ARG for:$unmatched. --build-arg for an undeclared name is a warning, not an error, so the image would build and ship an app on its default address."
    fi
  else
    ok "config/deploy.yml declares no build arg, so there is no Dockerfile ARG to disagree with"
  fi

  # -------------------------------------------------------------------------
  # C2b. THE SERVICE ADDRESSES ARE RUN-TIME VARIABLES, NOT BUILD ARGS.
  #
  # The positive question C2 stopped asking when `builder.args` emptied, and the
  # one that keeps the BFF from being quietly undone. Its failure mode is the
  # worst shape a deploy bug has: a `NEXT_PUBLIC_IDENTITY_URL` build arg is
  # inlined into the client bundle, identity serves no CORS headers, and the
  # result is a deploy that is green, healthy, and cannot complete a sign-in.
  # Nothing in `kamal deploy` looks at it.
  #
  # So the invariant is asserted in both directions, because either half alone
  # is satisfied by a config that has simply stopped deploying:
  #
  #   * the two addresses are in `env.clear`, interpolated, so they are read at
  #     run time; and
  #   * no `NEXT_PUBLIC_*` appears anywhere in the deploy config, the Dockerfile,
  #     or `src/`, because every one of those would be a browser-readable copy of
  #     a value the forwarder must own.
  #
  # The second is the load-bearing half. `tests/validate-ci.sh` and the vitest
  # suite both assert it, from different directions: this reads the committed
  # files, and `src/app/v1/[...path]/route.test.ts` reads the BUILT client chunks.
  # A source check cannot see what `next build` emits, and a build check does not
  # run on every commit.
  # -------------------------------------------------------------------------
  missing_clear=""
  for name in IDENTITY_URL BILLING_URL; do
    if [ -z "$(printf '%s\n' "$DEPLOY_CODE" | found "^[[:space:]]+${name}:[[:space:]]*<%=")" ]; then
      missing_clear="$missing_clear $name"
    fi
  done
  if [ -n "$missing_clear" ]; then
    no "the service addresses are run-time env vars in config/deploy.yml" \
      "env.clear declares no interpolated value for:$missing_clear. The BFF reads them at request time, so a build arg would put a service address back in the client bundle and a deployed sign-in would fail on CORS."
  else
    ok "the service addresses are run-time env vars in config/deploy.yml (IDENTITY_URL, BILLING_URL)"
  fi

  # `NEXT_PUBLIC_` in the files that decide what the browser downloads.
  #
  # COMMENTS ARE EXCLUDED, and the reason is the same one the vitest check gives
  # at `src/app/v1/[...path]/route.test.ts`: this repository explains its own
  # history in the headers of the files it changes, and a file that says why
  # `NEXT_PUBLIC_IDENTITY_URL` is gone necessarily spells the name. A check that
  # banned the word would ban the documentation of the fix along with the fix.
  #
  # `sed` removes `//` line comments and the Dockerfile's own `#` comments, which
  # is enough for every file this walks and is honest about being a strip rather
  # than a parse: a `NEXT_PUBLIC_` inside a string on a line with a `//` after it
  # would be missed, and the build-level assertion in the vitest suite is what
  # actually closes that gap rather than this approximation.
  public_leaks=""
  # `src` is resolved against `$ROOT` and NOT against the current directory, and
  # the self-test is what caught the difference: the script never `cd`s into the
  # sandbox, so a bare `find src` walked the REAL tree while `$DOCKERFILE` named
  # the sandbox's — checking two different repositories and reporting the union.
  # The breakage `a-service-address-back-in-the-bundle` went green through that,
  # which is the outcome this script exists to make impossible.
  for file in "$DOCKERFILE" $(find "$ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' \)); do
    # The checker names the pattern it is checking for, by construction.
    case "$file" in
      *route.test.ts) continue ;;
    esac
    # Tested for EMPTINESS, not for exit status. `found` echoes the matches, so a
    # bare `if found …` is true whenever the helper printed anything — which made
    # every file in the tree a finding. This is the same trap AGENTS.md records for
    # `grep -q` inside a pipeline, reached from the other direction.
    #
    # BLOCK COMMENTS MATTER HERE, and getting that wrong is what this loop found
    # the first time round. `sed 's://.*::'` removes a line comment and nothing
    # else, so the ` * ` continuation lines of a JSDoc header survive it — and
    # three files whose entire content is an explanation of why the variable is
    # gone were reported as using it.
    #
    # THE STRIP IS IN NODE, and not in `sed`, `perl` or `awk`, because this
    # script's own header promises it needs "no tool but node and grep". Adding a
    # fourth interpreter to remove a block comment would break that promise for
    # every machine that runs the gate, and `perl` in particular is not on a slim
    # CI image by default. Node is already required three times in this file.
    #
    # The strip is a regex, not a parse, and the limitation is the same one the
    # vitest check records at `src/app/v1/[...path]/route.test.ts`: a `/*` inside
    # a string would start a comment that does not end. No file this walks has
    # one, and the check that actually closes the gap is the build-level
    # assertion over `.next/static`, which reads emitted bytes rather than source.
    matches=$(strip_comments <"$file" | found 'NEXT_PUBLIC_' || true)
    if [ -n "$matches" ]; then
      public_leaks="$public_leaks $file"
    fi
  done
  if [ -z "$public_leaks" ]; then
    ok "no NEXT_PUBLIC_ variable reaches the browser (Dockerfile, src/)"
  else
    no "no NEXT_PUBLIC_ variable reaches the browser (Dockerfile, src/)" \
      "these files use a NEXT_PUBLIC_ variable in code, which next build inlines into the client bundle:$public_leaks. The BFF moved the browser same-origin; a service address in the bundle is a deployment that cannot sign in, and a forwarder whose destination the browser can read."
  fi
fi

# C3. Every node base image in the Dockerfile carries the pin.
#
# The Dockerfile's own header claims "One pin, four mirrors, and the image is the
# fourth — see tests/validate-ci.sh", and until now this script checked three of
# the four: package.json, mise.toml and ci.yml. The fourth drifted silently. The
# builder stage said `node:22.22.2-slim` and the runner stage said
# `node:22-slim`, so an image BUILT on the pin RAN on whatever the floating tag
# resolved to that week — measured with `docker manifest inspect node:22-slim`,
# which resolves a moving multi-arch index. For a service with no database the
# runtime it executes on is most of what it is, and no deploy config can fix an
# image that boots a different Node than `bin/prime` verified. So the claim in
# the header is now a check, which is the only thing that makes it one.
#
# `while read` rather than a `for` over `$(...)`: a `FROM` line carries a stage
# name (`AS builder`) and word splitting would test half a line.
floating=""
# `found` reads STDIN and takes no file argument — the second version of this
# check passed the Dockerfile as one, grep read the script's own stdin, found
# nothing, and reported the pin holding over a file it had never opened. Every
# read of a FILE below redirects it, and the line count is in the message so an
# empty read cannot report the same line as a correct one.
node_bases=$(found '^FROM node:' <"$DOCKERFILE")
while IFS= read -r from_line; do
  [ -n "$from_line" ] || continue
  case "$from_line" in
    *":$PIN"*) ;;
    *) floating="$floating|$from_line" ;;
  esac
done <<EOF
$node_bases
EOF
if [ -z "$node_bases" ]; then
  no "every node base image in the Dockerfile carries the pin ($PIN)" \
    "no 'FROM node:' line at all; the image would not build, which is a different failure and not a pass"
elif [ -z "$floating" ]; then
  ok "every node base image in the Dockerfile carries the pin ($PIN, $(printf '%s\n' "$node_bases" | grep -c .) lines)"
else
  no "every node base image in the Dockerfile carries the pin ($PIN)" \
    "these FROM lines do not name $PIN:${floating//|/, }"
fi

# C4. The tier that runs the real binaries may be executed. One line, and the
#     reason it is here and not in `bin/prime` is in the script's own header:
#     kamal and ruby are not on a CI runner, so this is a separate tier with a
#     three-valued exit rather than a skip hidden inside the gate.
if [ -x "$DEPLOY_RUNNER" ]; then
  ok "bin/deploy-config is executable"
else
  no "bin/deploy-config is executable" \
    "$DEPLOY_RUNNER is the only thing that runs kamal against config/deploy.yml, and it cannot be run"
fi

# --- optional: shellcheck --------------------------------------------------
# Reported either way. A skip is never hidden, and it is never the difference
# between this gate and a green build — every check above is dependency-free.
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -S warning "$ROOT/tests/validate-ci.sh" >/dev/null 2>&1; then
    ok "shellcheck -S warning clean on tests/validate-ci.sh"
  else
    no "shellcheck -S warning clean on tests/validate-ci.sh" \
      "$(shellcheck -S warning -f gcc "$ROOT/tests/validate-ci.sh" 2>&1 | head -5)"
  fi
else
  skipped "shellcheck is not installed, so this script was not linted here"
fi

# --- prove the checks can fail --------------------------------------------
# Thirty-nine breakages of a throwaway copy of every file these checks read,
# each asserted to send this gate red. A check that has only ever been seen
# green is a check nobody has watched fail, and this is the difference between
# a gate and a rubber stamp (PLAN.md §1: a skipped test proves nothing; a check
# that cannot fail proves less).
#
# The copy is built from the pristine files, so the self-test never depends on
# the working tree being green — which is the only way it can be run at the
# moment the tree is deliberately broken.
self_test() {
  local proofs=0 proof name breakage
  # Deliberately not `local`: the EXIT trap below is global, and a local would
  # be out of scope by the time the trap runs — leaving the sandbox behind, or
  # erroring on a set -u reference to a variable that no longer exists.
  SANDBOX=$(mktemp -d)
  trap 'rm -rf "${SANDBOX:-/nonexistent}"' EXIT

  # Every file the checks read, copied verbatim. The lockfile comes along
  # because a sandbox without it fails the "a committed lockfile exists" check
  # and the baseline would be red for a reason that has nothing to do with the
  # breakages under test.
  seed_sandbox() {
    rm -rf "${SANDBOX:?:?}"/*
    mkdir -p "$SANDBOX/tests" "$SANDBOX/.github/workflows" "$SANDBOX/bin" "$SANDBOX/e2e" "$SANDBOX/config"
    cp "$ROOT/tests/validate-ci.sh" "$SANDBOX/tests/validate-ci.sh"
    cp "$PRIME" "$SANDBOX/bin/prime"
    cp "$PKG" "$SANDBOX/package.json"
    cp "$MISE" "$SANDBOX/mise.toml"
    cp "$MANIFEST" "$SANDBOX/cafaye.yml"
    cp "$ROOT/$LOCKFILE" "$SANDBOX/$LOCKFILE"
    cp "$WF" "$SANDBOX/.github/workflows/ci.yml"
    # The deployment story's three files, for the same reason the rest are here:
    # a sandbox without them is red for a reason that has nothing to do with the
    # breakage under test, and a self-test whose baseline is red proves nothing
    # about what follows.
    cp "$DEPLOY_CONFIG" "$SANDBOX/config/deploy.yml"
    cp "$DOCKERFILE" "$SANDBOX/Dockerfile"
    # `src/`, because C2b walks it. Without it the sandbox has no client code for
    # that check to look at, so `find src` finds nothing, the check passes on an
    # empty tree, and every breakage that puts a service address back in a client
    # module goes green — a self-test proving the opposite of what it claims.
    # Copied whole and shallow: the check strips comments and greps, and a
    # partial copy would make a finding depend on which files were seeded.
    mkdir -p "$SANDBOX/src"
    cp -R "$ROOT/src/." "$SANDBOX/src/"
    cp "$DEPLOY_RUNNER" "$SANDBOX/bin/deploy-config"
    chmod +x "$SANDBOX/bin/deploy-config"
    # The end-to-end tier's files, for the same reason the other four are here:
    # a sandbox without them is red for a reason that has nothing to do with the
    # breakage under test, and a self-test whose baseline is red proves nothing
    # about what follows. The spec sources are copied INTO the sandbox's own e2e/
    # directory, because that is the directory the skip check reads, and it has
    # to be the same directory the checks read in the real tree.
    cp "$E2E_WF" "$SANDBOX/.github/workflows/e2e.yml"
    cp "$E2E_COMPOSE" "$SANDBOX/e2e/docker-compose.yml"
    cp "$PW_CONFIG" "$SANDBOX/playwright.config.ts"
    cp "$E2E_RUNNER" "$SANDBOX/bin/e2e"
    cp "$ROOT/tests/assert-e2e-ran.mjs" "$SANDBOX/tests/assert-e2e-ran.mjs"
    cp "$ROOT/e2e/no-token-artifacts.ts" "$SANDBOX/e2e/no-token-artifacts.ts"
    for spec in "$ROOT"/e2e/*.e2e.spec.ts; do
      cp "$spec" "$SANDBOX/e2e/$(basename "$spec")"
    done
    chmod +x "$SANDBOX/bin/e2e"
  }

  # Baseline first: a self-test that cannot see the copy go green in the first
  # place proves nothing about the breakages that follow.
  seed_sandbox
  if ! bash "$SANDBOX/tests/validate-ci.sh" >/dev/null 2>&1; then
    echo "self_test: the pristine copy does not pass; the breakages below prove nothing" >&2
    return 1
  fi
  echo "  ok   the pristine copy passes"

  # Each breakage is a name and the sed that breaks it.
  #
  # The five deploy breakages carry a comment here rather than inline, because a
  # comment cannot live inside a backslash-continued list — it ends the line and
  # the list stops being a list. The first version of the accessory breakage had
  # no leading `\n`, and `printf 'accessories:…'` appended straight onto the last
  # line of a file with no trailing newline, producing
  # `options: mode=max,image-manifest=true,oci-mediatypes=trueaccessories:`. The
  # planted key never began a line, the check correctly did not see it, and the
  # control reported a check that could not fail. A control that plants into the
  # end of a line plants nothing.
  for proof in \
    "rm-workflow|rm -f '$SANDBOX/.github/workflows/ci.yml'" \
    "dead-uses-path|sed -i '' 's|\.github/workflows/ci\.reusable|workflows/ci.reusable|' '$SANDBOX/.github/workflows/ci.yml'" \
    "language-bun|sed -i '' 's|language: node|language: bun|' '$SANDBOX/.github/workflows/ci.yml'" \
    "pin-drifts-into-ci|sed -i '' 's|\"node\":\"[^\"]*\"|\"node\":\"24.0.0\"|' '$SANDBOX/.github/workflows/ci.yml'" \
    "pin-drifts-in-mise|sed -i '' 's|^node = .*|node = \"20.11.0\"|' '$SANDBOX/mise.toml'" \
    "manifest-reintroduces-a-node-pin|printf 'node: \"20\"\n' >>'$SANDBOX/cafaye.yml'" \
    "npm-install-in-ci|sed -i '' 's|npm ci|npm install \\&\\& npm ci|' '$SANDBOX/.github/workflows/ci.yml'" \
    "no-lockfile-guard|sed -i '' '/git diff --exit-code/d' '$SANDBOX/.github/workflows/ci.yml'" \
    "stale-script-name|sed -i '' 's|npm run typecheck|npm run typecheckp|' '$SANDBOX/.github/workflows/ci.yml'" \
    "ci-does-not-run-prime|sed -i '' 's|\\./bin/prime|echo skipping the gate|' '$SANDBOX/.github/workflows/ci.yml'" \
    "npm-install-in-prime|sed -i '' 's|^npm ci\$|npm install|' '$SANDBOX/bin/prime'" \
    "manifest-reintroduces-a-gate-command|printf 'prime: ./bin/other\n' >>'$SANDBOX/cafaye.yml'" \
    "no-engines-field|node -e 'const f=process.argv[1];const p=require(f);delete p.engines;require(\"fs\").writeFileSync(f,JSON.stringify(p,null,2))' '$SANDBOX/package.json'" \
    "range-instead-of-a-pin|sed -i '' 's|\"node\": \"22.22.2\"|\"node\": \"^22\"|' '$SANDBOX/package.json'" \
    "package-manager-is-not-npm|node -e 'const f=process.argv[1];const p=require(f);p.packageManager=\"pnpm@10.9.7\";require(\"fs\").writeFileSync(f,JSON.stringify(p,null,2))' '$SANDBOX/package.json'" \
    "manifest-reintroduces-a-test-command|printf 'test: npm run other\n' >>'$SANDBOX/cafaye.yml'" \
    "no-e2e-workflow|rm -f '$SANDBOX/.github/workflows/e2e.yml'" \
    "e2e-in-the-per-commit-gate|printf '      - run: ./bin/e2e\n' >>'$SANDBOX/.github/workflows/ci.yml'" \
    "e2e-in-bin-prime|printf 'npm run e2e\n' >>'$SANDBOX/bin/prime'" \
    "e2e-job-does-not-run-the-tier|sed -i '' 's|run: ./bin/e2e|run: echo the tier is optional|' '$SANDBOX/.github/workflows/e2e.yml'" \
    "e2e-job-is-soft-fail|printf '    continue-on-error: true\n' >>'$SANDBOX/.github/workflows/e2e.yml'" \
    "e2e-job-cannot-tell-nothing-ran|sed -i '' '/assert-e2e-ran.mjs/d' '$SANDBOX/.github/workflows/e2e.yml'" \
    "e2e-runner-not-executable|chmod -x '$SANDBOX/bin/e2e'" \
    "the-two-test-floors-disagree|sed -i '' 's|^const MINIMUM_TESTS = 2;|const MINIMUM_TESTS = 1;|' '$SANDBOX/e2e/no-token-artifacts.ts'" \
    "trace-on|sed -i '' 's|trace: \"off\"|trace: \"retain-on-failure\"|' '$SANDBOX/playwright.config.ts'" \
    "video-on|sed -i '' 's|video: \"off\"|video: \"on\"|' '$SANDBOX/playwright.config.ts'" \
    "retries-raised|sed -i '' 's|retries: 0|retries: 2|' '$SANDBOX/playwright.config.ts'" \
    "a-skip-in-the-tier|printf 'test.skip(true, \"no stack\");\n' >>'$SANDBOX/e2e/session.e2e.spec.ts'" \
    "a-port-on-a-colleague|sed -i '' 's|E2E_GUARD_REDIS_PORT:-16002|E2E_GUARD_REDIS_PORT:-6379|' '$SANDBOX/e2e/docker-compose.yml'" \
    "a-port-outside-the-block|sed -i '' 's|E2E_IDENTITY_POSTGRES_PORT:-16001|E2E_IDENTITY_POSTGRES_PORT:-15400|' '$SANDBOX/e2e/docker-compose.yml'" \
    "a-literal-port-in-the-stack|sed -i '' 's|E2E_EDGE_PORT:-16000|16000|' '$SANDBOX/e2e/docker-compose.yml'" \
    "playwright-points-at-another-stack|sed -i '' 's|\"E2E_PARLOR_PORT\", \"16003\"|\"E2E_PARLOR_PORT\", \"3000\"|' '$SANDBOX/playwright.config.ts'" \
    "a-service-with-no-health-and-no-finding|printf '  bogus-service:\n    image: busybox:1.36.1\n' >>'$SANDBOX/e2e/docker-compose.yml'" \
    "an-unpinned-image|sed -i '' 's|image: nginx:1.27.4-alpine|image: nginx:latest|' '$SANDBOX/e2e/docker-compose.yml'" \
    "no-deploy-config|rm -f '$SANDBOX/config/deploy.yml'" \
    "an-accessory-in-the-deploy-config|printf '\naccessories:\n  postgres:\n    image: postgres:17-alpine\n' >>'$SANDBOX/config/deploy.yml'" \
    "a-builder-arg-without-a-dockerfile-arg|echo '  args:' >>'$SANDBOX/config/deploy.yml' && echo '    NEXT_PUBLIC_CDN_URL: <%= cdn_url %>' >>'$SANDBOX/config/deploy.yml'" \
    "a-service-address-out-of-env-clear|sed -i '' 's|^    IDENTITY_URL: <%= identity_url %>||' '$SANDBOX/config/deploy.yml'" \
    "a-service-address-back-in-the-bundle|echo 'const url = process.env.NEXT_PUBLIC_IDENTITY_URL;' >>'$SANDBOX/src/lib/identity.ts'" \
    "a-service-address-back-in-the-dockerfile|echo 'ENV NEXT_PUBLIC_IDENTITY_URL=https://identity.example.com' >>'$SANDBOX/Dockerfile'" \
    "an-unpinned-node-base|sed -i '' 's|^FROM node:22.22.2-slim AS runner|FROM node:22-slim AS runner|' '$SANDBOX/Dockerfile'" \
    "the-deploy-tier-is-not-executable|chmod -x '$SANDBOX/bin/deploy-config'"
  do
    name=${proof%%|*}
    breakage=${proof#*|}

    # One throwaway copy per breakage, seeded from the pristine one.
    seed_sandbox
    # shellcheck disable=SC2086  # the breakage list is deliberately a string
    eval "$breakage"
    if bash "$SANDBOX/tests/validate-ci.sh" >/dev/null 2>&1; then
      printf 'self_test: %s did NOT go red — that check cannot fail\n' "$name" >&2
      return 1
    fi
    proofs=$((proofs + 1))
    printf '  ok   %s goes red\n' "$name"
  done

  # The other direction, and the one that keeps the gate usable: a workflow
  # whose *comments* say "npm ci, never npm install" must still pass. A check
  # that punishes the warning it wants written is a check that gets deleted.
  seed_sandbox
  printf '# a comment that says npm install must not fail the check\n' \
    >>"$SANDBOX/.github/workflows/ci.yml"
  if bash "$SANDBOX/tests/validate-ci.sh" >/dev/null 2>&1; then
    printf '  ok   a comment mentioning npm install does not go red\n'
  else
    echo "self_test: prose mentioning npm install went red; the checks read comments" >&2
    return 1
  fi

  printf 'self_test: %d breakages, every check proven able to fail\n' "$proofs"
}

# The tally prints in both modes, and the exit code reflects both halves.
# `--self-test` used to be dispatched before the tally and exited without
# reading `$fail`, so `bin/prime` — which runs the self-test — would have
# printed no count and returned 0 on a tree whose real checks had failed. The
# self-test's own baseline would have caught it and said so, but a gate that
# needs a second mechanism to notice a failure is a gate with a hole in it.
printf '\n%d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
if [ "$fail" -ne 0 ]; then
  echo "the checks above failed; not running --self-test on a broken tree" >&2
  exit 1
fi

if [ $# -gt 0 ]; then
  if [ "$1" = "--self-test" ]; then
    if [ ! -f "$WF" ]; then
      echo "self_test: $WF does not exist; there is nothing to break yet" >&2
      exit 1
    fi
    self_test
    exit
  fi
  echo "usage: bash tests/validate-ci.sh [--self-test]" >&2
  exit 2
fi

exit 0
