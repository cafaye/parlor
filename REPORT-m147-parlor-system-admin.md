# REPORT-m147-parlor-system-admin.md

## Packet
m147, Parlor half of CAFAYE's first system-admin console. Branch
`m147-parlor-system-admin`, worktree `parlor-worker-system-admin`.
Built against Identity m147's human-session operator contract (unmerged),
mocked in Parlor tests; no Identity code touched.

## What landed (commit 6231061 + follow-ups; see git log)

- `src/lib/operator.ts` (+ `operator.test.ts`, 14 tests): staff-gated client
  for exactly the four contracted routes — `GET /v1/operator/me`,
  `GET /v1/operator/users?query=&limit=25`, `POST
  /v1/operator/users/{id}/disable|enable`. Failures reuse `IdentityError`
  (same service, same envelope) so **401 anonymous vs 403 non-staff stay
  apart**. Readers are strict: a body missing `user.staff` or a row missing
  `id/email/created_at` throws `internal` rather than inventing state.
  Empty query never reaches the wire (sync throw, proved red-then-green).
  Only the caller's session bearer crosses — no machine key, no second
  credential (asserted on header names).
- `src/lib/upstream.ts` (+ 6 tests, client walk extended) and
  `openapi/v1.yaml` (+ 4 operations, two-direction doc test green): the four
  `/operator` routes in the BFF allow-list — `query: [query, limit]`,
  `:userId` uuid value-matched (reuses `SEGMENT_KINDS.userId`), 403 passes
  through. The machine-key pair is not in the table and stays refused.
- `/admin` (`src/routes/admin.tsx`, `src/app/admin/`): page shell +
  `AdminScreen` (16 tests) — session loading, anonymous → sign-in link (401
  gate also reads as signed out), non-staff/403 → flat "Not available"
  (names nothing searchable), other gate failure → `ErrorState` with retry.
  Console: search (empty query refused client-side, loading/empty/error
  states), selectable results with Active/Disabled + Verified/Unverified,
  detail `Panel`, **explicit `ConfirmDialog` before disable/enable**, success
  `Callout`, per-status error sentences. **Every disable/enable re-reads
  `operator/me` before mutating** (staff lost mid-session is refused locally;
  proved by test). No staff grants, impersonation, delete, billing.
- Header (`header.tsx`, +3 tests): "System admin" link renders only after a
  verified `staff: true` read for the session; signed-out renders nothing and
  sends no request. Customer nav unchanged.
- `src/lib/operator-context.tsx` + `Providers`/`renderWithProviders`
  passthrough (tests-only override, same pattern as billing).
- `src/lib/telemetry.server.ts` +1 template: `/admin` (the generated-tree
  coverage test went red on the new route, as designed — fixed by adding the
  template, not by touching the test).
- `gate.yml`: suite floor 1021 → **1061** (+40, counted above) with the
  per-packet account.

## CSRF (as briefed: consistent with existing BFF behavior)
No new mechanism, deliberately. The existing BFF has no CSRF tokens: the
property is same-origin fetch (`credentials: "same-origin"`) + bearer header
(a cross-origin form cannot set `Authorization`) + `SameSite=Lax`
`__Host-session` cookie. Operator search/mutations ride the same transport
and the same header allow-list; `OPTIONS` unanswered, no `Access-Control-*`.

## Contract-mismatch watch
API unmerged at build time; nothing to compare against. If merged Identity
answers a different shape, `operator.test.ts` strict-reader tests and the
upstream table-and-walk go red — that is the tripwire, and the mismatch gets
reported, not absorbed.

## Verification
- Narrow focused runs (the only suites re-run after the final reader fixes):
  `src/lib/operator.test.ts` + `src/app/admin/page.test.tsx` +
  `src/lib/telemetry.server.test.ts` → **3 files, 76 passed, 0 failed**.
- Earlier in this run, before the manager stopped gate work:
  `npx vitest run` (full) → 40 files, 1061 passed; `npx tsc --noEmit` →
  clean; `npm run build` → clean with regenerated `src/routeTree.gen.ts`.
  Those commands each exited green on their own and are preserved as
  observed evidence only.
- `./bin/prime`: **UNVERIFIED / INTERRUPTED — did NOT pass.** The manager
  terminated the exact PID tree after `npm ci` and as Vitest started; no
  exit file and no completed suite exist. The merged-tree prime belongs to
  the manager. No claim is made that the gate passed.
- `npm ci` printed 4 high-severity audit findings. Inspection note only —
  not remediated in this packet (out of scope) and not used as verification
  of anything. No audit claim is made.
- `./bin/lint`: not run in this packet.
- No E2E/Docker in this packet per brief (manager owns merged browser gate).

## Notes for successor / manager
- Post-freeze reader fix, corrected per manager: `readOperatorUsers`
  requires the two TIMESTAMP keys (`disabled_at`, `email_verified_at`) to be
  present — the contract promises null keys — and accepts an omitted
  `display_name` as null (identity tags it `omitempty`). Three focused tests:
  omitted name accepted, each absent timestamp refused. An earlier revision
  wrongly required all three; the correction is recorded here rather than
  hidden.
- Two findings worth keeping: (1) a React Query with `enabled: false` reads
  `isPending === true` — the Search button stayed disabled until the screen
  keyed on `fetchStatus === "fetching"`; (2) `Button` defaults `type` to
  `"button"`, so every form submit button must pass `type="submit"`.
- `routeTree.gen.ts` is committed and regenerated by build; it is in the
  follow-up commit with `telemetry.server.ts`, `gate.yml`, and the test fixes.
