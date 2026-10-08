# REPORT-m148-parlor-e2e-focus-walk.md

## Packet
m148 — Fix the design-system browser test's focus-walk false positive.
Changed file only: `e2e/design-system.e2e.spec.ts` (walker in the first test).
No product markup changed: browser evidence (manager's 31/32 run) shows the
login page renders Email + Password correctly and holds two legitimate
"Create account" links (header + "No account yet?"), so the defect is in the
harness until proven otherwise.

## Prior evidence (from the brief, not re-run here)
- Merged Parlor E2E, real Chromium, 32 specs: 31 passed, 1 failed.
- The failure is `e2e/design-system.e2e.spec.ts` /
  `every interactive primitive is keyboard-reachable and paints a visible
  focus ring`, at the assertion that `order` contains `Password`.
- Cause: the walker broke with `if (order.includes(here.name)) break`, i.e.
  accessible-name identity, so the second "Create account" link read as a
  focus cycle and the walk exited before the login fields.

## Fix
- Each focused element is stamped in-page with an expando numeric id
  (`__focusWalkId`, counter `__focusWalkNextId` on `window`); the walk keeps
  a `Set<number>` of visited ids and breaks only when the *same DOM element*
  regains focus.
- Bound raised 8 → 24 steps: a full Tab cycle on `/login` is a handful of
  controls and the revisit-break stops a second lap, so the cap only fires
  when focus never cycles. Still bounded, no repeated loops.
- Preserved: real `Tab` presses (no `.focus()`), the Password / Sign-in
  reachability assertions, the unnamed-control assertion, and the per-step
  visible-ring checks (non-`none` style, width > 0, offset > 0).

## Verification (this worker; no Docker/E2E per the brief)
- `npm ci` (prerequisite, `node_modules` was absent): exit 0.
- `npm run typecheck` (`tsc --noEmit`): exit 0, no output.
- `npx playwright test e2e/design-system.e2e.spec.ts --list`: exit 0,
  8 tests listed, file parses.
- `./bin/lint` (kit config, `../kit` present): the changed spec file has
  zero findings; the tree reports 38 pre-existing errors in unrelated files
  (e.g. `src/lib/telemetry.server.ts`, account/admin/settings screens and
  their tests) that this packet does not touch. Full output was not kept;
  re-run `./bin/lint` to reproduce. These failures pre-date m148
  (worktree was clean at `d53f419` before my edit; my diff is one file).
- Full E2E (Docker/Chromium run) NOT run here — explicitly owned by the
  manager's merged run per the brief.

## Commits
- `787f720` m148: focus-walk stops on same element, not same name
  (this report follows as the next commit).

## Handoff for successor / manager
- If the manager's merged E2E still fails this test after this fix, the
  failure is no longer explainable as the duplicate-name trap: capture the
  new `order`/`rings` from the failure output and the Playwright snapshot,
  and treat it as a genuine product focus defect.
- Suggested next step if green: none for m148; close the packet.
