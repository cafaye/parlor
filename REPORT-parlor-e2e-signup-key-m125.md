# REPORT — parlor E2E signup key (m125)

## Packet
Supply Identity's required `SIGNUP_SIGNING_KEY` to the Parlor browser E2E
stack as a valid, ephemeral, per-run value. No committed key, no echo, no
persistent env file, no artifact residue. OIDC behavior and the product
unchanged. No topology change, no scope broadening.

## Failure mechanism (reproduced from safe evidence, no raw env/logs read)
- Identity's `config.Load` treats `SIGNUP_SIGNING_KEY` as the one secret with
  no supported absent state (`identity/internal/config/config.go`,
  `ErrNoSignupSigningKey = "SIGNUP_SIGNING_KEY is not configured"`). It must
  be base64url without padding decoding to exactly 32 bytes, else boot fails.
- Identity's own `docker-compose.yml` carries an obviously-development
  default for it (`${SIGNUP_SIGNING_KEY:-aWRlbnRpdHktZGV2ZWxvcG1lbnQtc2lnbnVwLWtleSE}`).
  Parlor's `e2e/docker-compose.yml` named no such variable at all, so the
  container inherited an empty environment and exited 1 with
  `loading configuration: SIGNUP_SIGNING_KEY is not configured` — after
  migrations applied, before any `/readyz` answered. Every preflight was
  green; no browser journey started.
- The harness already solved the identical problem for OIDC:
  `ensure_oidc_signing_key` in `bin/e2e-stack` generates an RSA key per run
  with openssl, exports it, and the compose document interpolates
  `${OIDC_SIGNING_KEY:-}`. The signup key follows the same proven path
  (exported env → compose interpolation → container), so no persistence or
  echo was needed and no committed default was used.

## Change (5 files, +1 check, +2 breakages)
- `e2e/docker-compose.yml` — identity environment gains
  `SIGNUP_SIGNING_KEY: "${SIGNUP_SIGNING_KEY:-}"` with an EMPTY default and a
  comment block stating why (no committed key: the tier needs no stable key;
  a bare `compose up` without the harness renders empty and identity refuses
  to boot naming the variable — the fail-loud direction).
- `bin/e2e-stack` — new `ensure_signup_signing_key()`, called from
  `preflight()` beside `ensure_oidc_signing_key`. Respects an operator
  preset after a silent shape check (43 base64url chars, no padding; length
  via `${#var}` and a `case` glob — nothing printed, ever); otherwise mints
  with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'` (identity
  README's own mint command) and exports it. Never echoes, writes, or logs
  the value; the die message names the variable and the mint command only.
- `tests/validate-ci.sh` — new check `the e2e stack supplies identity an
  ephemeral signup key`: compose wires the exact empty-default interpolation
  with no literal and no committed default; `bin/e2e-stack` defines, calls
  (from preflight indentation), mints (`openssl rand -base64 32`) and exports
  it. Reads shapes only; renders no secret. `bin/e2e-stack` is now seeded
  into the self-test sandbox (`E2E_STACK`) so both halves are breakable.
- `tests/validate-ci.sh` self-test — two new breakages:
  `the-stack-names-no-signup-key` (deletes the compose wiring line) and
  `the-harness-generates-no-signup-key` (deletes the preflight call). Counts
  in prose updated (54 breakages).
- `gate.yml` — `ci-shape-checks` minimum 47→48, `check-self-test` minimum
  52→54, with the accounting comment rewritten (this packet ADDS a check, so
  both floors move together).
- `AGENTS.md` — floor numbers 47→48, 52→54 (historical measurements left as
  history).

## Safe verification (no Docker operations, no secret rendering)
- `bash -n bin/e2e-stack` → OK. `bash -n tests/validate-ci.sh` → OK.
- `shellcheck -S warning bin/e2e-stack` → clean (same severity the gate
  applies to `tests/validate-ci.sh`).
- `bash tests/validate-ci.sh` with `docker` hidden from PATH (the provenance
  check otherwise runs real `docker build`s; the packet forbids all Docker
  ops — the hide degrades exactly that check to SKIP, which the
  declared-total floor is designed to absorb):
  `48 checks declared, 47 passed, 0 failed, 1 skipped`, including
  `PASS the e2e stack supplies identity an ephemeral signup key`.
- `bash tests/validate-ci.sh --self-test` (same sanitized PATH, background,
  unique log): pristine copy passes; final tally
  `self_test: 54 breakages declared, 54 proven able to fail, 0 unprovable on
  this machine`, exit 0 — including `ok the-stack-names-no-signup-key goes
  red` and `ok the-harness-generates-no-signup-key goes red`. (First attempt
  was cut short at 49/54 by my own 500 s timeout, not by a failure; reran
  with timeout 1100 to completion.)
- Deliberately NOT run: `docker compose config` (would interpolate env; the
  static check above is the compose validation), any `up`/`build`/`pull`, any
  container log inspection, and `bin/prime` (out of scope per brief — only
  the new check plus syntax/static validation).

## What was NOT changed and why
- No committed default (not even identity's dev default): the brief forbids
  it, and the tier needs no stable key.
- No `.github/workflows/e2e.yml` change: the key is generated in-process by
  `bin/e2e-stack` and inherited by its `docker compose` child, exactly like
  `OIDC_SIGNING_KEY` — no CI plumbing needed.
- No OIDC, product, topology, or test-scope change.

## Handoff for the manager
- Merge this branch; rerun the browser tier (`bin/e2e`). Expectation:
  identity boots (signup key present), migrations apply, `/readyz` answers,
  journeys run.
- If identity still exits 1 on config: the refusal names the variable —
  compare against `loadSignupSigningKey` in the sibling checkout.
- Commit SHA: <filled at commit time>.
- Browser E2E is NOT claimed passed here; the manager reruns the tier after
  merge. Never pushed (worker contract).
