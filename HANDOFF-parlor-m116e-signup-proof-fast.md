# Handoff: parlor m116e — focused verification of the fast monotonic signup-proof tests

Branch: `worker/parlor-m116-signup-timestamp`. Code commit under test: `ccbe1c8`
(m116d: monotonic `performance.now` clock, scripted-clock sleeps in register
form tests). No product code changed in this packet; report only.

## Commands run (clean tree, `git status` empty before and after)

1. `timeout 300 npx vitest run src/app/register/page.test.tsx src/lib/signup-proof.test.ts`
2. `timeout 240 npm run typecheck`

No full gate, Docker, stack, browser, install, push, publish, or deploy.

## Results

- Focused vitest: **47/47 passed (2 files), exit 0.** Wall time **~2.8s**
  (`time`: 3.07s user, 0.61s system, 132% cpu, 2.778 total; vitest internal
  Duration 1.83s). Output secret-free (test summary only).
- Typecheck (`tsc --noEmit`): **clean, exit 0.** Wall time **~1.5s**
  (2.71s user, 0.22s system, 200% cpu, 1.463 total).

## Comparison against the m116c baseline

- m116c focused run: 46/46 passed in **~75s** (real 2.5s `setTimeout` holds
  per submit test, per `HANDOFF-parlor-m116c-signup-timestamp.md`).
- This run: 47/47 passed in **~2.8s** — one more test than baseline (the new
  monotonic-source pin against a disagreeing wall clock) in roughly **1/27th**
  the time.
- Target (<20s) met with wide margin. No assertions weakened to hit it: the
  hold length is still asserted from the recorded scripted-sleep argument
  (full floor, single mint / renewal + floor), not from measured real time.

## For the manager

- Manager owns the merged full gate and local end-to-end acceptance; nothing
  here replaces that.
- Nothing to fix: both commands green on the first run, no failure to hand off.
