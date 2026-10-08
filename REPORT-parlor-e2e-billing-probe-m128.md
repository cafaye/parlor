# REPORT-parlor-e2e-billing-probe-m128

Worker packet m128 on `worker/m128-parlor-e2e-billing-probe`, worktree
`/Users/kaka/Code/any/wt/parlor-e2e-signup-key`. One commit: `ff6cd66`
(this report is the second commit). No merge, no push.

## 1. Exact failure

A local full-browser E2E run was blocked before any Playwright test began:
identity and gateway reached `/readyz`; parlor stayed **503**. The parlor
container's readiness body reported `identity: ok` and **`billing: not ok`**.

Root cause, measured in the E2E container environment: parlor had
`IDENTITY_URL=http://identity:8080` (correct) **and**
`BILLING_URL=http://billing:3000`, from `e2e/docker-compose.yml:783` — but
this E2E Compose stack runs **no billing service** (no `billing:` service in
the document, nothing on the `platform` network answering that name).
Parlor's `/readyz` (`src/app/readyz/route.ts:71-73`) probes billing whenever
`BILLING_URL` is non-empty and fails the gate while that probe fails, so the
readiness poll in `bin/e2e-stack` could never open and the tier came down
with `{"name":"billing","ok":false}` before a single browser test ran.
Billing is not part of the launch stack or the current feature set
(`caf.dev.json`: billing deliberately absent, `required: false`).

## 2. Config change (and only that)

- `e2e/docker-compose.yml` — deleted the `BILLING_URL: "http://billing:3000"`
  line from parlor's `environment:` and left a comment saying why the absence
  is the fix, when to re-add it (only together with a `billing:` service in
  the same document), and where the pairing is held (`tests/validate-ci.sh`).
- Readiness behavior is **untouched**: no `src/` change. `BILLING_URL` unset
  means billing is not probed and the launch-shaped sweep is identity-only
  (`deps: [{name: identity, ok: true}]`); a deployment that explicitly sets
  `BILLING_URL` still gets billing as a readiness dependency. The forwarder
  already treats empty `BILLING_URL` as "answer billing routes 503 here,
  dial nothing" (`src/lib/upstream.ts`), so nothing else in the container
  changes either.
- Deliberately NOT done: no billing service added, no billing implemented,
  no touch of launch stack (`config/deploy.yml` keeps its interpolated
  `BILLING_URL` — that is the deploy's business), Site, Identity, or any
  live `site-launch-*` container.

## 3. Regression check (the narrowest one)

- `tests/validate-ci.sh` — new check
  "the e2e stack does not point parlor at a billing service it does not run":
  if the compose document (comments stripped) sets `BILLING_URL:` to a
  non-empty value while no `^  billing:` service exists in the same document,
  the gate fails. Adding a real `billing:` service later satisfies it; an
  explicitly empty value passes either way (the probe treats it as unset).
- Self-test — new breakage
  `the-e2e-stack-points-parlor-at-a-billing-service-it-does-not-run`
  (appends the stale `BILLING_URL` line to a sandbox copy; asserted to go red).
- Floors moved with the tree, same commit: `gate.yml` ci-shape-checks
  `48 -> 49`, check-self-test `54 -> 55`; `validate-ci.sh` header comments
  `54 -> 55`. Suite floor `959` untouched (no vitest files changed).

## 4. Focused tests and exit statuses

| Test | Result |
|---|---|
| `timeout 300 bash tests/validate-ci.sh` | exit 0 — `49 checks declared, 49 passed, 0 failed, 0 skipped` (incl. the new check PASS, shellcheck clean) |
| Red proof: appended `BILLING_URL: "http://billing:3000"` to `e2e/docker-compose.yml`, re-ran `validate-ci.sh` | exit 1 — `49 checks declared, 48 passed, 1 failed, 0 skipped`; the single FAIL is the new check and nothing else; restored with `git checkout -- e2e/docker-compose.yml` (verified: no `BILLING_URL:` code line remains) |
| `timeout 280 npx vitest run src/app/readyz/route.test.ts` (after background `npm ci`, exit 0) | exit 0 — `Tests 17 passed (17)`; readiness behavior intact |
| NOT run | Full `bin/prime`, full `validate-ci.sh --self-test` (55 breakages × ~12 s each exceeds this packet's hour budget; the new breakage's logic is proved by the plant/restore row above — CI runs the self-test via the gate), any E2E Docker run (forbidden by this brief), full vitest suite (no suite files changed) |

## 5. Handoff

Manager reruns the full Parlor browser suite (`./bin/e2e`), which should now
pass parlor's `/readyz` with the identity-only `deps` shape that
`e2e/stack.e2e.spec.ts` already asserts. Successor's first move if the tier
still reports a billing dep: `grep -n BILLING_URL e2e/docker-compose.yml` —
the new gate check answers that statically before any container starts.
