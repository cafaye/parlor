#!/bin/bash
#
# The red proof for `docker/provenance.sh --verify`, in this repository's own
# test.
#
# WHY IT EXISTS, and it is the whole point of the file
# ------------------------------------------------------
# `bin/e2e-stack publish-siblings` consults the verifier and does NOT assert on
# it, deliberately: the two sibling images it publishes are built by a bare
# `docker build` that passes no `KIT_PROVENANCE_*` argument, so an unstamped
# image is the ordinary case rather than a failure of this repository. The
# decision and its measured reasons are in the comment above the reporting loop
# in `bin/e2e-stack`, and the same answer holds in `site`.
#
# The cost of a consumer that only prints is that it has never been shown to
# fail. THIS is where it is shown to fail. Every case below builds a real image
# and reads the real exit status of the real script; nothing here is a claim
# about what the script would do.
#
# THREE-VALUED EXIT, following `bin/deploy-config` in this repository:
#   0  every case behaved as declared
#   1  a case behaved differently — this is a finding, not a flake
#   2  could not run (no docker, or no daemon) — NEVER 0, because a red proof
#      that did not run is the exact failure mode this file exists to prevent
#
# RUN IT:
#   bash tests/provenance-consumer-test.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY="$ROOT/docker/provenance.sh"

# A revision that is not this repository's HEAD, so nobody can read a pass as
# "it happened to agree with the checkout".
STAMPED_REV='1111111111111111111111111111111111111111'
OTHER_REV='2222222222222222222222222222222222222222'

pass=0
fail=0
skipped=0

if [ ! -f "$VERIFY" ]; then
  printf 'FAIL: %s does not exist. The consumer wiring has no verifier to consult.\n' "$VERIFY" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'CANNOT RUN: docker is not on PATH. This is exit 2, not a pass.\n' >&2
  exit 2
fi
if ! timeout 60 docker info >/dev/null 2>&1; then
  printf 'CANNOT RUN: the docker daemon does not answer. This is exit 2, not a pass.\n' >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/provenance-consumer.XXXXXX")"
cleanup() {
  for tag in provenance-consumer-stamped provenance-consumer-inherited provenance-consumer-bare; do
    timeout 60 docker image rm -f "$tag" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- the three images ---------------------------------------------------------
#
# `FROM scratch` and nothing else, so this test needs no registry, no base image
# and no network. The only thing under test is the label sink and the exit
# status, and a test that cannot run offline is a test about the machine.

cat >"$WORK/stamped.Dockerfile" <<'DOCKERFILE'
FROM scratch
ARG KIT_PROVENANCE_SOURCE
ARG KIT_PROVENANCE_REVISION
ARG KIT_PROVENANCE_BUILT_AT
ARG KIT_PROVENANCE_SOURCE_DIRTY
ARG KIT_PROVENANCE_TEMPLATE_VERSION
LABEL org.opencontainers.image.source="${KIT_PROVENANCE_SOURCE}"
LABEL org.opencontainers.image.revision="${KIT_PROVENANCE_REVISION}"
LABEL org.opencontainers.image.created="${KIT_PROVENANCE_BUILT_AT}"
LABEL com.cafaye.kit.source.dirty="${KIT_PROVENANCE_SOURCE_DIRTY}"
LABEL com.cafaye.kit.template.version="${KIT_PROVENANCE_TEMPLATE_VERSION}"
DOCKERFILE

# The shape of a sibling image that inherits a base image's stamp — measured on
# this machine: `cafaye/guard:e2e` carries BUN's labels, because it is built
# `FROM oven/bun` and nothing overwrites them. The stamp is present, plausible
# and about the wrong software entirely.
cat >"$WORK/inherited.Dockerfile" <<'DOCKERFILE'
FROM scratch
LABEL org.opencontainers.image.source="https://github.com/oven-sh/bun"
LABEL org.opencontainers.image.revision="700fc117a2fd01ac0201deaa6fa69c5557acb04f"
DOCKERFILE

# No labels at all — the shape of a sibling image whose Dockerfile predates the
# stamp. Measured: `cafaye/identity:e2e` reports `null` here.
cat >"$WORK/bare.Dockerfile" <<'DOCKERFILE'
FROM scratch
DOCKERFILE

build() {
  timeout 300 docker build -f "$WORK/$1.Dockerfile" -t "$2" "$WORK" >/dev/null 2>&1
}

# The five fields are passed the way kit's producer passes them (`stamp --args`),
# because an ARG left unset yields `LABEL org.opencontainers.image.revision=""`
# — labels present, values empty, which is a THIRD shape nobody should have to
# reason about, and which the verifier reports as `<absent>`.
build_stamped() {
  timeout 300 docker build \
    --build-arg "KIT_PROVENANCE_SOURCE=cafaye/parlor" \
    --build-arg "KIT_PROVENANCE_REVISION=$STAMPED_REV" \
    --build-arg "KIT_PROVENANCE_BUILT_AT=2026-04-10T03:06:38Z" \
    --build-arg "KIT_PROVENANCE_SOURCE_DIRTY=clean" \
    --build-arg "KIT_PROVENANCE_TEMPLATE_VERSION=v1.4.0" \
    -f "$WORK/stamped.Dockerfile" -t provenance-consumer-stamped "$WORK" >/dev/null 2>&1
}

# --- the cases ----------------------------------------------------------------

# expect_exit <label> <expected status> <command...>
#
# The command is run as given, with its output folded into the transcript, and
# the STATUS is what is asserted. A case that cannot fail is not a case.
expect_exit() {
  local label="$1" want="$2"
  shift 2
  local out status
  out="$("$@" 2>&1)"
  status=$?
  printf '\n--- %s\n$ %s\n%s\n[exit %s]\n' "$label" "$*" "$out" "$status"
  if [ "$status" -eq "$want" ]; then
    printf 'PASS: %s exited %s as declared\n' "$label" "$want"
    pass=$((pass + 1))
  else
    printf 'FAIL: %s exited %s, declared %s\n' "$label" "$status" "$want" >&2
    fail=$((fail + 1))
  fi
}

# expect_output <label> <pattern> <command...>
expect_output() {
  local label="$1" pattern="$2"
  shift 2
  local out
  out="$("$@" 2>&1)"
  if printf '%s' "$out" | grep -Fq -- "$pattern"; then
    printf 'PASS: %s printed %s\n' "$label" "$pattern"
    pass=$((pass + 1))
  else
    printf 'FAIL: %s did not print %s. Got:\n%s\n' "$label" "$pattern" "$out" >&2
    fail=$((fail + 1))
  fi
}

printf '== provenance consumer: the verifier is consulted, and it can go red\n'
printf '== repo: %s\n' "$ROOT"
printf '== verifier: %s\n' "$VERIFY"

if ! build_stamped; then
  printf 'CANNOT RUN: could not build the stamped probe image. This is exit 2, not a pass.\n' >&2
  exit 2
fi
build inherited provenance-consumer-inherited || true
build bare provenance-consumer-bare || true

# 1. THE GREEN PATH. A stamped image is read and named.
expect_exit 'stamped image, printing form' 0 \
  sh "$VERIFY" --verify provenance-consumer-stamped
expect_output 'stamped image names its revision' "$STAMPED_REV" \
  sh "$VERIFY" --verify provenance-consumer-stamped

# 2. THE ASSERTION PASSES when the expectation is the stamp's own commit.
expect_exit 'expectation agrees with the stamp' 0 \
  sh "$VERIFY" --verify provenance-consumer-stamped --expect-revision "$STAMPED_REV"

# 3. THE RED PROOF. Same real image, same real invocation, one flag different:
# a different commit is expected. This must be non-zero or the whole mechanism
# is decorative.
expect_exit 'expectation disagrees with the stamp — MUST be red' 5 \
  sh "$VERIFY" --verify provenance-consumer-stamped --expect-revision "$OTHER_REV"

# 4. THE TRAP NAMED IN THE HANDOFF. An image with no labels at all exits 4.
expect_exit 'image with no labels at all — MUST be red' 4 \
  sh "$VERIFY" --verify provenance-consumer-bare

# 5. A reference to nothing also exits non-zero rather than printing a blank and
#    calling it a pass.
expect_exit 'image that does not exist — MUST be red' 4 \
  sh "$VERIFY" --verify provenance-consumer-does-not-exist:no-such-tag

# 6. AN INHERITED STAMP IS REFUSED. This assertion used to read `0`, and the
#    `0` was not a measurement of correctness — it was a measurement of a defect
#    that had been recorded here and then frozen into the suite as the expected
#    answer. An image built `FROM oven/bun` inherits Bun's publisher's
#    `org.opencontainers.image.*`, so the old verifier printed Bun's URL as our
#    source and exited 0.
#
#    A test that pins a bug is how the bug survives a fix: this file went red the
#    moment kit's ownership check landed, and the red read like a regression in
#    the fix rather than like the fix working. That is the whole hazard, and it
#    is why the reason the number changed is written here rather than left for
#    the next person to reverse-engineer from the diff.
#
#    So this is now the fix's own red proof: the same real image, the same
#    invocation, and a refusal. The SECOND assertion is unchanged and still
#    passes, which is the point worth keeping — the verifier still PRINTS the
#    base's commit. It just no longer calls that ours.
expect_exit 'inherited base-image stamp is REFUSED, not accepted as ours' 6 \
  sh "$VERIFY" --verify provenance-consumer-inherited
expect_output 'the refusal names the base image it inherited from' \
  'oven-sh/bun' \
  sh "$VERIFY" --verify provenance-consumer-inherited
expect_output 'inherited stamp names the BASE image commit' \
  '700fc117a2fd01ac0201deaa6fa69c5557acb04f' \
  sh "$VERIFY" --verify provenance-consumer-inherited

# 7. THE TOLERANCE IS REAL AND SCOPED. This is byte-for-byte the call
#    `publish_siblings` makes. On the mismatched image it returns 0, because
#    `|| true` is there — which is exactly why this file, and not the e2e tier,
#    is where the red proof lives.
expect_exit "the e2e tier's own call form tolerates a mismatch" 0 \
  sh -c "sh '$VERIFY' --verify provenance-consumer-stamped --expect-revision '$OTHER_REV' || true"
expect_exit "the e2e tier's own call form still surfaces a mismatch in its text" 0 \
  sh -c "sh '$VERIFY' --verify provenance-consumer-stamped --expect-revision '$OTHER_REV' || true"
if sh -c "sh '$VERIFY' --verify provenance-consumer-stamped --expect-revision '$OTHER_REV' || true" 2>&1 \
  | grep -Fq 'FAIL'; then
  printf 'PASS: the tolerated call still says FAIL in its output\n'
  pass=$((pass + 1))
else
  printf 'FAIL: the tolerated call swallowed the word FAIL. `|| true` may hide an exit status; it may not hide the finding.\n' >&2
  fail=$((fail + 1))
fi

printf '\n== %s passed, %s failed, %s skipped\n' "$pass" "$fail" "$skipped"
if [ "$fail" -ne 0 ]; then
  exit 1
fi
exit 0