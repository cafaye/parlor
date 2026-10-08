# REPORT-parlor-e2e-billing-probe-m128

Worker packet m128, branch `worker/m128-parlor-e2e-billing-probe`,
worktree `/Users/kaka/Code/any/wt/parlor-e2e-signup-key`.
Commit `ff6cd66` (inherited from a prior attempt of this same packet —
landed mid-session; verified below, kept as correct) plus this report.
No merge, no push.

## 1. Exact failure

A local full-browser E2E run was blocked before any Playwright test ran:

- `identity` and `gateway` reached `/readyz`; `parlor` stayed **503**.
- The parlor container's readiness body reported `identity: ok`,
  `billing: not ok`.
- The E2E container environment showed
  `IDENTITY_URL=http://identity:8080` (correct) and
  `BILLING_URL=http://billing:3000` — but `e2e/docker-compose.yml`
  declares **no `billing:` service**, so `billing` resolves to nothing.

Root cause chain (all three links verified in-tree, no container run needed):

1. `e2e/docker-compose.yml` (parlor service) set
   `BILLING_URL: "http://billing:3000"` — stale from an older topology.
2. `src/app/readyz/route.ts` probes billing **whenever `BILLING_URL`
   is set** (`if (billingUrl !== "")`), and a configured-but-unreachable
   dependency fails the gate: 503 with `{name:"billing", ok:false}`.
3. `bin/e2e-stack`'s bounded host poll on parlor's `/readyz` therefore
   spent its whole budget and brought the tier down.

The readiness behavior itself is correct and unchanged: a deployment
that explicitly configures billing keeps it as a readiness dependency
(`route.test.ts`: "fails closed when billing is configured but
unreachable"); an absent billing is not probed ("leaves billing out of
the sweep when it is not configured — the launch stack's shape").
Only the fixture was wrong.

## 2. Config change (commit `ff6cd66`, verified, kept)

- **`e2e/docker-compose.yml`** — deleted the stale
  `BILLING_URL: "http://billing:3000"` line from parlor's environment
  and left a comment in its place stating the absence is the contract
  (unset ⇒ not probed ⇒ honest shape of a stack with no billing;
  re-point only together with a `billing:` service in the same
  document). No service added, none removed otherwise.
- **`tests/validate-ci.sh`** — one new static check: a `BILLING_URL:`
  line carrying a value in the compose document requires a
  `billing:` service in the same document; an explicitly empty value
  (`""`/`''`) passes either way because the probe treats it as
  unconfigured. Comment-stripped read (`code_lines`), so the prose
  documenting the fix cannot trip it. Check count 48 → **49**.
- **`tests/validate-ci.sh --self-test`** — one new breakage,
  `the-e2e-stack-points-parlor-at-a-billing-service-it-does-not-run`,
  which re-appends the stale line and must send the script red.
  Breakage count 54 → **55** (axis `-`: needs nothing beyond node/grep).
- **`gate.yml`** — floors raised with the packet that earned them:
  `ci-shape-checks` minimum 48 → 49, `check-self-test` minimum
  54 → 55, each with a history note. Suite floor untouched (no vitest
  change — correct, the suite did not grow).

Scope held: no billing service added, no billing implemented,
`src/app/readyz/route.ts` untouched, launch stack (`config/deploy.yml`
still declares `BILLING_URL` as a run-time var for deployments that
*do* configure billing — that is the deployment story, not this
fixture), Site, Identity, and live `site-launch-*` containers untouched.
`git show ff6cd66 --stat` touches exactly the three files above.

A suspected defect in the new check's empty-value regex
(`(""|'"''"')` alternation) was investigated by executing the pattern:
it evaluates to `(""|'')` and both `BILLING_URL: ""` and
`BILLING_URL: ''` are correctly treated as unset. No edit needed;
evidence overruled the first reading.

## 3. Focused tests and exit statuses (no E2E Docker run, per brief)

| # | Command (each bounded by `timeout`) | Result |
|---|--------------------------------------|--------|
| 1 | `timeout 120 bash tests/validate-ci.sh` | exit **0** — `49 checks declared, 49 passed, 0 failed, 0 skipped` (log `/tmp/gate-parlor-e2e-signup-key.validate.log`) |
| 2 | `npx vitest run src/app/readyz/route.test.ts` | exit **0** — `Test Files 1 passed (1)`, `Tests 17 passed (17)` (log `.../gate-parlor-e2e-signup-key.readyz.log`): readiness behavior intact, both directions (billing probed when set, absent when unset) |
| 3 | New-check red proof: re-added `BILLING_URL: "http://billing:3000"` to a scratch copy of the compose doc, ran the check's exact logic | refs non-empty, no `billing:` service ⇒ **would FAIL** (correct); pristine tree passes |
| 4 | `bash tests/validate-ci.sh --self-test` (background, polled) | `self_test: 55 breakages declared, 55 proven able to fail, 0 unprovable on this machine`, including `ok the-e2e-stack-points-parlor-at-a-billing-service-it-does-not-run goes red` (log `.../gate-parlor-e2e-signup-key.selftest.log`) |

Full `bin/prime` and `./bin/e2e` were deliberately **not** run: the
brief bounds this packet to focused static/config tests and reserves
the full browser suite for the manager after this lands.

## 4. Handoff for the manager

- Merge candidate: `ff6cd66` + this report commit on
  `worker/m128-parlor-e2e-billing-probe`. Nothing else in the tree
  (verified `git status` clean apart from this report before
  committing it).
- Rerun trigger: the full parlor browser suite (`./bin/e2e`). Expected:
  parlor `/readyz` goes 200 on `{deps:[{identity,ok}]}` and the tier
  reaches the specs.
- Known pre-existing note, not this packet's: `e2e/stack.e2e.spec.ts:85`
  already asserts "this stack deploys no billing" — consistent with
  this fix, no change needed there.
- Watch: one stray `git diff --stat` blip mid-session reported an
  uncommitted compose change that a re-run showed as clean (stale stat
  cache or a concurrent touch in this shared worktree). Final
  `git status` before the report commit was re-verified clean.
