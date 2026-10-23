#!/usr/bin/env bash
# ci/pipeline.sh — parlor's pipeline, backend-agnostic.
#
# One pipeline, two runners. The backend's only job is to provide an
# environment and call this script; the gate, the build and the ship are this
# repository's. Which backend ran is recorded in `ci/backend`, and switching is
# one line — `github-actions` keeps `.github/workflows/` calling kit's reusable
# workflows, `instabox` provisions a sandbox that polls the repo and runs this
# file. `kit/backends/README.md` is the contract.
#
# WHERE THE FACTS COME FROM: `ci/*.yml` IN THIS REPOSITORY.
#
#   * THE GATE is `./bin/prime`. `ci/ci.yml`'s `prime` job runs
#     it as a one-line `run: ./bin/prime` — literally the command a developer
#     types, and the gate.yml declaration's `invokes:` too. `bin/prime` already
#     runs `npm ci`, the vitest suite, `tsc --noEmit`, `vite build` and
#     `tests/validate-ci.sh --self-test`, so the pipeline does not restate any
#     of them: a second spelling of the gate is a second thing to keep true.
#
#   * THE LOCKFILE GUARD is `git diff --exit-code -- package-lock.json` — the
#     `prime` job's second step. It covers the direction `npm ci` cannot: a
#     step later in the run writing a resolution into the tree, so the run
#     would go green having changed the file the next `npm ci` depends on.
#
#   * NO PATH ENTRIES. parlor's `ci.yml` appends nothing to `$GITHUB_PATH`.
#     `e2e.yml` appends `$(go env GOPATH)/bin` for goose, but that is the
#     whole-stack tier and this pipeline does not run it: e2e needs docker,
#     four sibling image builds and a browser download, and a ten-minute
#     addition to every push is how a per-commit gate stops being one. The
#     gate here is the one `gate.yml` declares and `ci.yml`'s `prime` job runs.
#
#   * THE SHIP is the image + chart publish. `ci/publish.yml` is
#     the github-actions spelling — `push: true` into kit's reusable publish
#     workflow on every push to master. On this backend the same bytes are
#     produced by `bin/publish` (kit's tool), which DERIVES the image digest
#     from the pushed image, stamps the chart with it and refuses a malformed
#     one. parlor ships a chart (`chart/Chart.yaml`), so that branch is live;
#     `bin/publish` is kit's `templates/bin/publish.sh`, copied here per
#     `backends/README.md` step 2. Do not reimplement the push.
#
# WHAT IT NEEDS FROM THE ENVIRONMENT (backends/README.md is the contract):
#   WORKSPACE   the directory holding anywaye/<name> checkouts
#   GH_TOKEN    a token that can read this project's private sources
#   CI          1, so nothing waits on a prompt
#   CI_DRY_RUN  1 runs the gate and ships nothing (a rehearsal)
# The registry login `bin/publish` needs is placed once by the operator
# (`bin/publish --sandbox`, token via stdin); it is not a pipeline input.
set -euo pipefail

# ---------------------------------------------------------------------------
# identity — the repository root comes from this file, not the caller's cwd
# ---------------------------------------------------------------------------
# `run from anywhere`: the instabox agent resets the checkout to the fetched
# commit before calling us, and the pipeline does the same itself so that a
# hand-run is identical to a polled one.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
REPO_NAME="$(basename "$REPO_DIR")"

WORKSPACE="${WORKSPACE:-$(cd "$REPO_DIR/../.." && pwd)}"
BRANCH="${CI_BRANCH:-master}"
export CI="${CI:-1}"
export WORKSPACE

log() { printf '\n== %s\n' "$1"; }

log "pipeline: $REPO_NAME at $REPO_DIR"

# ===========================================================================
# MARKED 1 — THE GATE. `./bin/prime`, the argv `ci/ci.yml`'s
# `prime` job runs and `gate.yml` declares. A list, so a multi-word gate works
# without eval and nothing written here is re-parsed.
# ===========================================================================
GATE=(./bin/prime)

# ===========================================================================
# MARKED 2 — PATHS THIS REPOSITORY'S CI ADDS. `grep GITHUB_PATH
# ci/*.yml` finds only the goose entry in `e2e.yml`, which is
# the separate whole-stack tier and not this pipeline's business; `ci.yml`
# appends none. So this is empty on purpose.
# ===========================================================================
PATHS=()

if [ "${#PATHS[@]}" -gt 0 ]; then
  for d in "${PATHS[@]}"; do
    # One entry per directory, in the order the workflow appends them: PATH is
    # searched front to back and a later entry must not shadow an earlier one.
    export PATH="$d:$PATH"
  done
fi

log "the toolchain the repository pins"
# `mise install` materializes the versions in mise.toml (node 22.23.4);
# `mise exec` runs the gate under them, so a developer, a runner and this
# sandbox all use the same compiler. `mise.toml`'s `[tasks.prime]` resolves to
# `./bin/prime`, which is the same file this pipeline runs.
if [ -f mise.toml ] && command -v mise >/dev/null 2>&1; then
  mise install
  GATE=(mise exec -- "${GATE[@]}")
elif [ -f mise.toml ]; then
  echo "pipeline: mise.toml is present and mise is NOT on PATH — the gate runs on the machine's own toolchain"
fi

log "the gate"
"${GATE[@]}"

# ---------------------------------------------------------------------------
# the lockfile guard — the `prime` job's second step, same argv
# ---------------------------------------------------------------------------
# `--` so a filename can never be read as a revision. `npm ci` exits nonzero
# rather than move the lockfile; this catches everything after it.
log "the gate left package-lock.json alone"
git diff --exit-code -- package-lock.json

# ===========================================================================
# MARKED 3 — SHIP. parlor ships an image and a chart, so this is the publish
# `publish.yml` does on GitHub Actions, run through kit's own tool. A service
# with no chart deletes this block; parlor has one.
# ===========================================================================
if [ "${CI_DRY_RUN:-0}" = "1" ]; then
  log "gate passed; CI_DRY_RUN=1, not shipping"
  exit 0
fi

SHIPPED=""
if [ -f chart/Chart.yaml ]; then
  log "publish image + chart"
  # `--service-dir .` because we are already at the root; the tool derives the
  # image name, reads the chart's name and version from Chart.yaml, stamps the
  # chart with the PUSHED image's digest, and pushes to
  # oci://ghcr.io/anywaye/charts. It needs a registry login already in place —
  # see backends/README.md.
  ./bin/publish --service-dir .
  chart_name="$(sed -n 's/^name: *//p' chart/Chart.yaml | head -1)"
  chart_version="$(sed -n 's/^version: *//p' chart/Chart.yaml | head -1)"
  SHIPPED="image+chart ${chart_name}:${chart_version}"
else
  echo "pipeline: no chart/Chart.yaml — nothing to publish; the gate is the whole run"
fi

# ---------------------------------------------------------------------------
# the last line a log tail reads
# ---------------------------------------------------------------------------
# Naming WHAT shipped and the COMMIT it was built from is the whole point of
# this line: the agent's `shipped <sha>` says the pipeline returned 0, and this
# says what that meant. A run that shipped nothing says so.
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$SHIPPED" ]; then
  log "pipeline: shipped $REPO_NAME $SHIPPED at $COMMIT"
else
  log "pipeline: passed $REPO_NAME at $COMMIT (nothing published)"
fi
