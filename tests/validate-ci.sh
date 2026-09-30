#!/usr/bin/env bash
# The half of parlor's gate that checks the gate.
#
# `bin/prime` proves the checkout reproduces: `npm ci` from the committed
# lockfile, then the suite. This proves the *shape* of that checkout is still
# what CI assumes — one runtime pin, one lockfile contract, one gate command.
# Both run from `bin/prime`, so neither can drift away from a developer.
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
#   bash tests/validate-ci.sh             the checks
#   bash tests/validate-ci.sh --self-test  prove they can fail (13 breakages)
#
# `--self-test` is part of the gate, not an extra. A check nobody has watched
# go red is a check that has verified nothing (PLAN.md §1).
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

# Read one scalar out of package.json. Absent key reads as the empty string
# rather than throwing, so a missing pin fails a check instead of the script.
pkg_field() {
  node -e 'const p=require(process.argv[1]);const v=p[process.argv[2]];process.stdout.write(v===undefined?"":String(v))' "$PKG" "$1"
}

pkg_script() {
  node -e 'const p=require(process.argv[1]);const s=p.scripts||{};process.stdout.write(process.argv[3] in s?"yes":"no")' "$PKG" "$1"
}

# The pin of record. It lives in package.json because that is the one file
# npm, Corepack and CI all read; mise.toml mirrors it for the local toolchain
# and the workflow passes it to kit. One number, three declarations, and the
# checks below are what make them one number.
pin_of_record() {
  pkg_field engines.node
}

pin_in_mise() {
  sed -n 's/^[[:space:]]*node[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$MISE" | head -1
}

pin_in_workflow() {
  sed -n "s/.*\"node\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$WF" | head -1
}

node_major_in_manifest() {
  sed -n 's/^[[:space:]]*node:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -1
}

manifest_scalar() {
  sed -n "s/^[[:space:]]*$1:[[:space:]]*\(.*\)$/\1/p" "$MANIFEST" | head -1
}

# --- the workflow exists, and calls kit at the path that resolves -----------
if [ -f "$WF" ]; then
  ok "ci.yml exists"
else
  no "ci.yml exists" "$WF is missing; nothing runs the gate on a pull request"
  printf '\n0 passed, 1 failed, 0 skipped — every other check needs the workflow.\n'
  exit 1
fi

if grep -qF "$USES_LINE" "$WF"; then
  ok "calls kit's reusable workflow at the documented path"
else
  no "calls kit's reusable workflow at the documented path" \
    "expected the line: $USES_LINE"
fi

if grep -qF "$DEAD_USES" "$WF"; then
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
elif printf '%s' "$PIN" | grep -qE '[\^~><*xX[:space:]]'; then
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

# The draft manifest records the major line ("22"), which is a deliberate
# coarsening, not a competing pin. The exact number is not ours to write there
# (the manifest is core's shape and pantry excludes parlor for it), so this
# checks the one thing that can be checked: the major has to agree.
MANIFEST_NODE=$(node_major_in_manifest)
case "$PIN" in
  "$MANIFEST_NODE".*)
    ok "cafaye.yml's node major ($MANIFEST_NODE) agrees with the pin"
    ;;
  *)
    no "cafaye.yml's node major agrees with the pin" \
      "the manifest declares node \"$MANIFEST_NODE\", the pin is $PIN"
    ;;
esac

if [ "$(manifest_scalar packageManager)" = "npm" ]; then
  ok "cafaye.yml declares npm as the package manager"
else
  no "cafaye.yml declares npm as the package manager" \
    "found '$(manifest_scalar packageManager)'"
fi

# --- `npm ci`, never `npm install` ------------------------------------------
# `npm ci` failing because a lockfile is out of sync is the desired behaviour:
# it is the one install that refuses to drift. `npm install` in a CI path
# resolves that disagreement silently and writes the resolution into the
# tree, so the disagreement reaches master dressed as a passing build.
if grep -rnE '(^|[^-[:alnum:]])npm[[:space:]]+install' "$ROOT/.github" "$PRIME" 2>/dev/null; then
  no "no npm install in any CI path" \
    "found above; npm ci is the frozen install and npm install is not"
else
  ok "no npm install in any CI path"
fi

# --- the lockfile guard ----------------------------------------------------
if grep -qE 'git[[:space:]]+diff[[:space:]]+--exit-code([^[:space:]]|[[:space:]]+--)?[[:space:]].*'"$LOCKFILE" "$WF"; then
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
called_scripts=$(grep -oE 'npm run [a-zA-Z0-9:_-]+' "$WF" | awk '{print $3}' | sort -u)
for script in $called_scripts; do
  if [ "$(pkg_script "$script")" = "no" ]; then
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
if grep -qF './bin/prime' "$WF"; then
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

# The manifest already names the gate, so the two can be held to each other.
if [ "$(manifest_scalar prime)" = "./bin/prime" ]; then
  ok "cafaye.yml's quality.prime is ./bin/prime"
else
  no "cafaye.yml's quality.prime is ./bin/prime" \
    "found '$(manifest_scalar prime)'"
fi
if [ "$(manifest_scalar test)" = "npm test" ]; then
  ok "cafaye.yml's quality.test is npm test, which is what bin/prime runs"
else
  no "cafaye.yml's quality.test is npm test" \
    "found '$(manifest_scalar test)'"
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
# Thirteen breakages of a throwaway copy of the four files these checks read,
# each asserted to send this gate red. A check that has only ever been seen
# green is a check nobody has watched fail, and this is the difference between
# a gate and a rubber stamp (PLAN.md §1: a skipped test proves nothing; a check
# that cannot fail proves less).
#
# The copy is built from the pristine files, so the self-test never depends on
# the working tree being green — which is the only way it can be run at the
# moment the tree is deliberately broken.
self_test() {
  local sandbox proofs=0
  sandbox=$(mktemp -d)
  trap 'rm -rf "${sandbox:?}"' EXIT

  mkdir -p "$sandbox/tests" "$sandbox/.github/workflows" "$sandbox/bin"
  cp "$ROOT/tests/validate-ci.sh" "$sandbox/tests/validate-ci.sh"
  cp "$PRIME" "$sandbox/bin/prime"
  cp "$PKG" "$sandbox/package.json"
  cp "$MISE" "$sandbox/mise.toml"
  cp "$MANIFEST" "$sandbox/cafaye.yml"
  cp "$WF" "$sandbox/.github/workflows/ci.yml"

  # Baseline first: a self-test that cannot see the copy go green in the first
  # place proves nothing about the twelve breakages that follow.
  if ! bash "$sandbox/tests/validate-ci.sh" >/dev/null 2>&1; then
    echo "self_test: the pristine copy does not pass; the breakages below prove nothing" >&2
    return 1
  fi
  echo "  ok   the pristine copy passes"

  # Each breakage is a file under $sandbox and the sed that breaks it.
  local proof
  for proof in \
    "rm-workflow|rm -f '$sandbox/.github/workflows/ci.yml'" \
    "dead-uses-path|sed -i '' 's|\.github/workflows/ci\.reusable|workflows/ci.reusable|' '$sandbox/.github/workflows/ci.yml'" \
    "language-bun|sed -i '' 's|language: node|language: bun|' '$sandbox/.github/workflows/ci.yml'" \
    "pin-drifts-into-ci|sed -i '' 's|\"node\":\"[^\"]*\"|\"node\":\"24.0.0\"|' '$sandbox/.github/workflows/ci.yml'" \
    "pin-drifts-in-mise|sed -i '' 's|^node = .*|node = \"20.11.0\"|' '$sandbox/mise.toml'" \
    "manifest-major-disagrees|sed -i '' 's|node: \"22\"|node: \"20\"|' '$sandbox/cafaye.yml'" \
    "npm-install-in-ci|sed -i '' 's|npm ci|npm install \\&\\& npm ci|' '$sandbox/.github/workflows/ci.yml'" \
    "no-lockfile-guard|sed -i '' '/git diff --exit-code/d' '$sandbox/.github/workflows/ci.yml'" \
    "stale-script-name|sed -i '' 's|npm run typecheck|npm run typecheckp|' '$sandbox/.github/workflows/ci.yml'" \
    "ci-does-not-run-prime|sed -i '' 's|\\./bin/prime|echo skipping the gate|' '$sandbox/.github/workflows/ci.yml'" \
    "npm-install-in-prime|sed -i '' 's|^npm ci$|npm install|' '$sandbox/bin/prime'" \
    "prime-not-the-manifests-gate|sed -i '' 's|prime: ./bin/prime|prime: ./bin/other|' '$sandbox/cafaye.yml'" \
    "no-engines-field|node -e 'const f=process.argv[1];const p=require(f);delete p.engines;require(\"fs\").writeFileSync(f,JSON.stringify(p,null,2))' '$sandbox/package.json'"
  do
    local name=${proof%%|*}
    local breakage=${proof#*|}

    # One throwaway copy per breakage, seeded from the pristine one.
    rm -rf "${sandbox:?}"/.github "${sandbox:?}"/bin "${sandbox:?}"/tests/validate-ci.sh \
      "${sandbox:?}"/package.json "${sandbox:?}"/mise.toml "${sandbox:?}"/cafaye.yml
    mkdir -p "$sandbox/.github/workflows" "$sandbox/bin"
    cp "$ROOT/tests/validate-ci.sh" "$sandbox/tests/validate-ci.sh"
    cp "$PRIME" "$sandbox/bin/prime"
    cp "$PKG" "$sandbox/package.json"
    cp "$MISE" "$sandbox/mise.toml"
    cp "$MANIFEST" "$sandbox/cafaye.yml"
    cp "$WF" "$sandbox/.github/workflows/ci.yml"

    eval "$breakage"
    if bash "$sandbox/tests/validate-ci.sh" >/dev/null 2>&1; then
      printf 'self_test: %s did NOT go red — that check cannot fail\n' "$name" >&2
      return 1
    fi
    proofs=$((proofs + 1))
    printf '  ok   %s goes red\n' "$name"
  done

  printf 'self_test: %d breakages, every check proven able to fail\n' "$proofs"
}

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

printf '\n%d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
