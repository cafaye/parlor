# REPORT-parlor-signup-no-mail-m131

## Packet

m131 — diagnose the Parlor signup mail-unavailable E2E failure:
`e2e/session.e2e.spec.ts` “a person can create an account and sign in to it”
expected `CREATED_NO_MAIL` (“This deployment cannot send email…”) but the UI
showed `CREATED_NO_REQUEST` (“We could not start sending…”). Worktree
`/Users/kaka/Code/any/wt/parlor-e2e-signup-key`, branch
`worker/m128-parlor-e2e-billing-probe`. No push/merge (manager merges).

## Diagnosis (one line)

Not a product bug. Identity's per-(client IP, route) recovery rate limiter
(default 5/min) answered the register flow's verification request with 429 —
replacing the 503 the no-courier stack otherwise answers — because the whole
browser suite funnels through parlor's forwarder (one source address) and makes
~12 `POST /v1/email-verifications` per run inside a minute. The 429 rendering
(`CREATED_NO_REQUEST`) is the correct rendering of a non-503. Fixture budget
misconfiguration; fixed by raising it.

## Evidence chain (all read-only; sibling identity repo read, never edited)

- `register-form.tsx` maps only `IdentityError.status === 503` to
  `CREATED_NO_MAIL` (`"unavailable"`); every other verification failure —
  including 429 — maps to `"failed"` → `CREATED_NO_REQUEST`. That mapping is
  correct: 429 is retryable, the deployment CAN send.
- identity `cmd/identity/main.go` wires the limiter unconditionally:
  `"/v1/email-verifications": {Max: cfg.RateLimit.Recovery, …}`; default
  `RATE_LIMIT_RECOVERY=5`, window 1m (`internal/config/config.go`). Zero is a
  startup error, so the limiter cannot be disabled — only sized.
- identity `internal/httpapi/ratelimit.go`: the handler runs, THEN the limiter
  replaces the buffered response with `429 rate_limited`. Key is
  (client address, route pattern) — never the account.
- identity `internal/recovery/service.go` `RequestVerification` checks
  `deliverable` (mailer) FIRST → 503 with no courier. So a lone run always
  sees 503; only a budget-exhausted run sees 429.
- Manager run timeline (from `e2e-results.json`, read locally, nothing secret
  copied): `POST /v1/email-verifications` #1–2 design-system (~02:06:10–14),
  #3–5 email-verification (~02:06:14–21), #6–7 its equality-test pair,
  #8 password-reset's register (~02:06:25), #9 session t1 (~02:06:28) → 429.
  Every earlier assertion either ran inside budget (#1–5: exact 503 text) or
  was loose enough to pass under 429 (equality of two 429s, bare visibility).
  Session t1 was the first exact-text assertion past the 5-request budget —
  hence exactly one failure. Session t1 duration 10.2s = the 10s expect
  timeout polling on the wrong-but-stable copy.

## Fix (committed)

1. `3cdd3aa` — `e2e/docker-compose.yml`: `RATE_LIMIT_RECOVERY: "30"` on the
   identity service with a comment recording the count (2+5+1+3+1=12/run) and
   the m131 evidence. Keeps a real bound; identity's own suite still proves
   the limiter itself.
2. `e0ac39e` — `src/app/register/page.test.tsx`: new test “does not read a
   rate limit as a deployment that cannot send”: 429 → account-created lead,
   `could not start sending`, never `on its way`, never `cannot send email`.
   Red-proved (temporarily mapped 429→unavailable, watched it go red,
   reverted; `git diff` confirms `register-form.tsx` byte-identical).

No UI copy changed, no assertion weakened, no sleeps/retries, no product code
touched.

## Commands / results

- `npx vitest run src/app/register/page.test.tsx` → 42 passed (incl. new 429
  test). Red proof: 1 failed on the deliberate mutation, then reverted.
- `npm run typecheck` → clean.
- E2E verification: `E2E_STACK_NAME=parlor-e2e-m131 timeout 900 ./bin/e2e --
  e2e/email-verification.e2e.spec.ts e2e/session.e2e.spec.ts`
  (the budget-accumulation path plus the failing test; 9 tests, above the
  tier's 2-test floor; isolated project name; `bin/e2e` tears down its own
  stack; log at `/tmp/parlor-m131-e2e.log`):
  - DONE — 9 passed, 0 failed, 0 skipped (`[e2e] the tier ran: 9 passed…`,
    `EXIT=0`, `e2e-results.json` confirms 9/9 passed). Session t1's exact
    503-text assertion passes after the full accumulation sequence that
    previously 429'd it. Stack ran as isolated project `parlor-e2e-m131` and
    `bin/e2e` tore it down itself (containers, network, volumes removed).

## Result

Fixed and proved narrowly: 9/9 in the two-spec verification run (see above).
A lone run of session t1 could not have validated this fix (fresh budget
always 503s); the two-spec sequence is the minimal honest proof, and the full
26-test suite remains the manager's rerun on the merged tree.

## Manager's remaining work (merged tree + full E2E)

- Merge this branch; rerun the FULL 26-test suite (`./bin/e2e` unfiltered) —
  only a full run re-accumulates the real budget pressure.
- Watch item (no evidence of failure yet, not changed): `POST /v1/users` sits
  at ~9 requests/run against identity's default `RATE_LIMIT_SIGNUP=10/min`.
  If the suite gains another register flow, that budget 429s a registration
  itself (“Something went wrong”). Same one-line treatment
  (`RATE_LIMIT_SIGNUP`) if it ever fires.
- `gate.yml` floors untouched (no new `validate-ci.sh` check added
  deliberately — a static floor cannot track suite volume; the compose comment
  holds the count).
- Secrets hygiene: this report contains no emails, tokens, or response
  bodies; the E2E log at `/tmp/parlor-m131-e2e.log` was not copied into the
  tree.
