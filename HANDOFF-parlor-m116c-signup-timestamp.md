# Handoff: parlor m116c — signup timestamp proof safe across quick submit and long-open forms

Branch: `worker/parlor-m116-signup-timestamp`. Commits (on top of c6aebc9/f6eecec/e5fd629):
- `f54d212` — `src/lib/signup-proof.ts` + unit tests (Q1 commit)
- `7fa10b3` — form wiring + page tests, typecheck green (Q2 commit)

## What was wrong

The render-time mint (m116) fixed the missing-pair defect but left identity's
two age edges (`MinAge` 2s / `MaxAge` 1h): a password-manager fast submit lands
inside the floor and is refused as bot-like; a tab open past the hour submits a
stale pair. Both refusals are the same generic 422, so the user sees an
unactionable failure for doing nothing wrong.

## Behavior now

- At submit, `ensureSignupProof` (new, `src/lib/signup-proof.ts`) returns a
  sendable pair: a young pair is held until 2500ms local elapsed (2s policy +
  0.5s submit-flight margin); a pair older than 55min local elapsed is
  re-minted, and the renewal is itself held past the floor; with no pair it
  mints and holds. A mint failure propagates — the form renders the existing
  generic sentence and never calls `register` without a proof.
- Age is LOCAL ELAPSED time since this client received the pair, never the
  pair's `timestamp` against this client's clock — the server subtracts with
  its own clock, and local elapsed is a lower bound on what it will observe
  (minted-before-receipt, verified-after-send), so the margins lean the safe
  way without trusting clock agreement. Identity policy/tests untouched.
- The submit button stays disabled through the hold via a local `waiting`
  state (`pending` only covers the mutations); the double-submit `inFlight`
  ref guard is unchanged.

## Tests (focused only, per brief — no gate/Docker/browser)

- `src/lib/signup-proof.test.ts` (5, scripted clock): young waits remainder,
  aged sends without waiting, stale renews + ages renewal, null mints + ages,
  mint failure propagates. All pass.
- `src/app/register/page.test.tsx` (41): two new — fast submit sends the
  render-time pair with mint called once and submit-to-register ≥2000ms;
  61-minute-old tab re-mints and registers with the renewal. `asyncUtilTimeout`
  raised to 8000 file-wide because a submit may now hold ~2.5s real time.
- Focused run `vitest run src/app/register/page.test.tsx
  src/lib/signup-proof.test.ts`: **46/46 pass** (~75s; the holds are real
  `setTimeout`s). `npm run typecheck`: clean.

## For the successor / manager

- Full gate and local acceptance are explicitly the manager's (per brief).
- CHANGELOG untouched (brief scoped changes to form/tests); the m116 entry
  from m116b still describes the render mint — worth a line noting the
  submit-time hold/renew when this merges.
- Known cost: every register submit test now pays one ~2.5s hold (~50s of the
  75s run). If that grows teeth, the seam is `ProofClock` (injectable
  now/sleep) — but wiring it into the form would be test-aware production
  code, so it was left out.
