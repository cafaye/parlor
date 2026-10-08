# REPORT-parlor-m134-base-dialog-p10.md — P-10: refused delete closes the dialog, alert stays visible

## Outcome

Done in-worktree, unpushed. Closes the P-09 known gap: a refused/failed
account delete rendered its `role="alert"` on the page behind the still-open
modal, where the truthful Base UI dialog hides it from assistive tech. The
fix is the smaller of the two options the brief allowed — close the dialog
on refusal/failure and expose the existing page-level alert — applied
consistently to the account screen's delete AND leave flows and to Settings'
delete-my-account flow. Chose close-over-inline because rendering inside the
modal would have changed `ConfirmDialog`'s public API for an error the page
already states; closing keeps one alert, one copy, one place.

## Commits (branch `parlor-m134-base-dialog`, base `b00432b`)

- `ad3b834` (red): the three refused-delete tests now assert the normal
  visible `findByRole("alert")` plus `queryByRole("dialog")` null. All three
  failed on the unfixed tree (alert only in the hidden subtree).
- (green, this packet): `setConfirming(false)`/`setConfirmingLeave(false)` in
  the three catch paths, `dialog.tsx` semantics comment corrected, P-09
  report gap marked closed, CHANGELOG entry, this report.

## Verification (exact)

- Red: `account-screen.test.tsx` "says so when the delete is refused" —
  1 failed / 52 skipped; `page.test.tsx` "accounts to transfer" — 1 failed /
  63 skipped; `page.test.tsx` "network failure" — 1 failed / 2 passed /
  61 skipped.
- Green touched files: `account-screen` + `settings/page` +
  `confirm-dialog` — 126 passed. Full suite: **38 files, 1008 passed**
  (floor unchanged, no new tests — three queries strengthened, not added).
- `npm run typecheck`: clean.
- NOT run (manager owns): Docker, `./bin/e2e`, `./bin/prime`, push, merge,
  gate, final browser suite.

## What changed and what deliberately did not

- Changed: 3 catch blocks close their dialog before setting the existing
  error state; copy, contracts, `deleteFailure`/`leaveFailure` sentences,
  403/404/409 semantics, busy guard, and focus restoration (Base UI default
  back to the Delete/Leave trigger) untouched. Token-intact-on-refusal
  assertions kept and still passing (Settings 409, account 403 leaves the
  account in place with no navigation).
- Changed: `dialog.tsx` header no longer claims the primitives print
  `aria-modal`; `ConfirmDialog`'s explicit attribute and its test stay.
- Kept: the Rename comparison control's `{ hidden: true }` button query — a
  visual-comparison test of a background control, not an error message.
- No new E2E assertion: the refusal path needs a stubbed identity (403/409
  on demand), which the browser tier cannot produce truthfully; the existing
  design-system spec already proves inert-while-open and clean close, and the
  unit tests prove the alert is visible with no dialog present after refusal.

## Handoff notes for the manager

- Merge, gate (`./bin/prime`), the one final Parlor browser suite, push.
- `gate.yml` floors untouched (suite 1008, shape and self-test as-is).
- No other repos touched; no worker spawned; no new dependency.
