# REPORT-m153-parlor-system-admin-browser-e2e.md

m153. Branch `parlor-m148-focus-walk`, worktree
`parlor-worker-m148-focus-walk`, on top of manager's m148 fast-forward
(`a25baf1`). One commit: `a91548c`.

## What was built

Real-browser coverage for the `/admin` system-admin console (shipped in
m147, untested by any E2E until now):

- `e2e/system-admin.e2e.spec.ts` — two Playwright tests, following the
  `account-admin.e2e.spec.ts` conventions verbatim (fresh `e2e-<uuid>`
  addresses, register → sign-in through the real forms, `recordSessionToken`
  for every minted token, rendered-text/role assertions only, no sleeps, no
  skips, one worker):
  1. Non-staff refusal: a fresh account signs in, `/admin` renders the shell
     (`System admin`) plus the flat refusal (`Not available` + the staff
     sentence, no role/reason named), the staff-only header link is absent,
     and Accounts still renders.
  2. Staff flow: a separately created user is registered in a second browser
     context; a staff candidate registers, is granted staff, and — with no
     re-sign-in, because the gate is a fresh `operator/me` read — opens
     `/admin`, searches the full address (exactly one row, the service's
     status rendered), runs the confirm disable flow (reads Disabled), reloads
     and re-searches (still Disabled: server-backed, not optimistic), then
     re-enables (reads Active, subject left as found).
- `bin/e2e-stack grant-staff <email>` — the fixture seam. It execs
  `/app/identity-staff grant` (the operator command identity packages in its
  own image, the only writer of `users.is_staff`) inside the running
  identity container via the existing `compose()` helper, so project name,
  directory, and the `E2E_BUILD_SIBLINGS=1` overlay all behave exactly as
  every other stack command. No HTTP bootstrap, no test-only production
  route. Header usage block and its `sed` range updated together.

What was deliberately not covered: user deletion, UI grants, impersonation,
billing, audit scope — the screen offers none of them.

## Verification (exact commands, all from the worktree root)

| Command | Outcome |
|---|---|
| `bash -n bin/e2e-stack && ./bin/e2e-stack` (usage) | syntax OK; `grant-staff` listed |
| `npm run typecheck` (`tsc --noEmit`) | clean |
| `npx --no-install playwright test --list` | `Total: 34 tests in 9 files`, both new tests collect |
| `eslint` (kit config) on `e2e/system-admin.e2e.spec.ts` | clean |
| `shellcheck -S warning bin/e2e-stack` | clean |
| `bash tests/validate-ci.sh` | `50 checks declared, 50 passed, 0 failed, 0 skipped` (matches `gate.yml` floor of 50) |
| Full `./bin/lint` | 38 errors, all in files untouched by this packet; reproduced on clean HEAD via `git stash` — pre-existing, not mine |

No Docker and no browser ran in this worker, per the brief. **No browser
execution is claimed.**

## Manager follow-up: the one merged Chromium E2E

```sh
cd /Users/kaka/Code/any/moon/cafaye/parlor-worker-m148-focus-walk
E2E_BUILD_SIBLINGS=1 ./bin/e2e -- e2e/system-admin.e2e.spec.ts
```

Prerequisites the run assumes: sibling checkouts `../identity` (with the
m147 staff surface + packaged `/app/identity-staff` merged), `../gateway`,
`../oauth-stub`, `../kit` present. If the staff test fails at the grant step,
the seam to inspect is `grant_staff()` in `bin/e2e-stack` and whether the
running identity image contains `/app/identity-staff` (`docker compose exec`
names it immediately). If the search returns zero rows, the seam is
identity's `SearchUsers` substring semantics vs. the full-address query.

## State for a successor

Branch contains `a91548c` on top of `a25baf1`; tree clean. Nothing is
blocked; the only unproven half is the live run above, which this worker was
forbidden from performing.
