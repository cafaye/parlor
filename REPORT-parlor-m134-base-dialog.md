# REPORT-parlor-m134-base-dialog.md — P-09: ConfirmDialog on Base UI Dialog

## Outcome

Done in-worktree, unpushed. `ConfirmDialog` no longer owns modal machinery:
new `src/components/ui/dialog.tsx` wraps `@base-ui/react/dialog`
(shadcn/ui's current default foundation), and `confirm-dialog.tsx` composes
it. Public API, call sites, copy, labels, styling, callbacks and all
routes/flows unchanged. No other component migrated, no redesign.

## Commits (branch `parlor-m134-base-dialog`, base 943e981)

- `b3fc90c` (red): 2 failing modal-inertness tests + the `@base-ui/react`
  install. Narrow run: 2 failed, 7 passed on `confirm-dialog.test.tsx`.
- `fbbc111` (green): implementation + mechanics-only test adaptations + e2e
  browser assertions for real Tab and `aria-hidden`.

## Verification

- Touched files: `confirm-dialog.test` + `feedback` + `controls` +
  `client-boundary`: 58 passed.
- Full suite: **38 files, 1008 passed, 0 failed** (`Tests 1008 passed
  (1008)`); floor was 1006, +2 are the new inertness tests.
- `npm run typecheck`: clean (one fix needed: Base UI `className` accepts a
  state function, so the wrapper narrows props to string via
  `StringClassProps`).
- NOT run (manager owns): `./bin/prime`, Docker, `./bin/e2e`, push. The e2e
  additions in `design-system.e2e.spec.ts` (real-Tab wrap both directions,
  `body > [aria-hidden='true']` count >0 while open / 0 after close) are
  written but unrunnable here — the post-merge browser suite is their proof.

## Dependency / perf (exact)

- Verified current stable first: `npm view @base-ui/react version` →
  **1.8.0**; installed bounded as
  `timeout 180 npm install --save-exact @base-ui/react@1.8.0`.
- Delta vs base: `package.json` +1 line (`"@base-ui/react": "1.8.0"`,
  exact, no caret); `package-lock.json` +107/−3. Nothing else added —
  no Radix, React Aria, class library, icon package, or CLI.
- `node_modules/@base-ui/react`: 19M on disk (of 522M total).
- Production build (`npm run build`, Worker target), before (base tree via
  `git archive` + symlinked `node_modules`) vs after:
  - `dist/` total: 4256k → **4440k** (+184k, incl. server bundle SSR).
  - `dist/client/assets` total: 2472k → **2524k** (+52k).
  - Main client chunk (holds the dialog): `index-ARM7IKgc.js` 342k raw /
    106k gzip → `index-BX70wIyU.js` 393k raw / **123k gzip (+17k gzip)**.

## What the packet forced to change (mechanics only, behavior kept)

- Focus moves are `requestAnimationFrame`-deferred in Base UI (verified in
  `enqueueFocus` + `FloatingFocusManager`): keyboard-contract assertions now
  `await waitFor(...)`. Same behavior, async mechanics — the house rule's
  allowed use of `waitFor`.
- The trap is sentinel guards, not a keydown handler: Base UI only
  intercepts Tab when zero tabbables exist. Wrap tests focus the
  `[data-base-ui-focus-guard]` sentinels (exactly 2, asserted) instead of
  firing Tab keydown. A spurious pass was caught and fixed: an unsettled
  initial-focus rAF can win the race, so guard tests settle initial focus
  first (commented in the tests).
- `aria-modal="true"` is stated on the popup: the primitive hides the
  background via `aria-hidden` + trap but prints no `aria-modal`; the
  existing assertion names it where modality is decided.
- 4 screen-test queries behind the open modal now pass `{ hidden: true }`
  (same role, same copy): refused-delete alerts and the Rename comparison
  control render behind the still-open dialog.

## Known gap surfaced (not fixed — flows frozen by this packet)

A refused delete renders its error alert on the screen *behind* the
still-open dialog. The truthful modal now hides that alert from assistive
tech until the dialog closes (previously reachable because nothing was
hidden). Follow-up packet: close the dialog on refusal or move the error
inside it. Recorded in CHANGELOG; tests assert the copy through the hidden
subtree so the gap stays visible.

## Handoff notes for the manager

- Merge, gate (`./bin/prime`), one full browser suite (covers the new e2e
  Tab/`aria-hidden` assertions), push.
- `gate.yml` suite floor moved 1006 → 1008 with the per-packet account;
  no new `validate-ci.sh` checks, so shape/self-test floors untouched.
- Worktree will be clean after the docs commit (CHANGELOG, gate.yml, this
  report); no other repos touched; no worker spawned.
