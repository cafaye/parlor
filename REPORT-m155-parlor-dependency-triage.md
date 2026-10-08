# REPORT-m155 — Parlor dependency triage: four npm high-severity findings

Branch: `parlor-m148-focus-walk`. No code changes in this commit; report only.
Constraint respected: no touch to system-admin E2E or `bin/e2e-stack` (m153),
no push/merge, no Docker, no full-suite or browser E2E.

## 1. Raw finding (reproduced, not quoted from m147)

`timeout 120 npm audit --json` → **exit 1**, 4 high / 0 critical / 0 moderate:

| # | package | severity | direct? | via | range | fixAvailable |
|---|---------|----------|---------|-----|-------|--------------|
| 1 | `@cloudflare/vite-plugin` (installed 1.62.5) | high | yes (devDep) | miniflare, wrangler | `<=0.0.0-fff677e35 \|\| >=1.2.3` | 1.2.2, isSemVerMajor=true |
| 2 | `miniflare` (installed 5.20261001.0-alpha) | high | no | sharp | `<=0.0.0-fec45ed61 \|\| >=4.20250508.3` | wrangler 4.15.2, isSemVerMajor=true |
| 3 | `sharp` (installed 0.35.4) | high | no | **GHSA-wq5f-xc86-pv6w** | `<0.35.5` | wrangler 4.15.2, isSemVerMajor=true |
| 4 | `wrangler` (installed 4.147.0) | high | yes (devDep) | miniflare | `<=0.0.0-7ae5dd357 \|\| >=4.16.0` | 4.15.2, isSemVerMajor=true |

Full JSON was written to a temp file outside the tree and **not committed**
(no raw audit JSON in the repo, per brief).

## 2. The four collapse to one root cause

Only entry #3 carries an advisory. Entries #1, #2, #4 have no advisory of
their own — their `via` fields are pure propagation of the sharp issue up the
dependent chain. There is exactly one vulnerability to triage:

- **GHSA-wq5f-xc86-pv6w** — "sharp: Vulnerability in librsvg dependency",
  **CVE-2026-96889**, CWE-416 (use-after-free) + CWE-1395, CVSS 4.0 **8.9**
  (`AV:L/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H`).
  Published in lovell/sharp 2026-09-30, reviewed into the GitHub Advisory
  Database 2026-10-06. Affected: sharp `<0.35.5`. Patched: **0.35.5**
  (ships librsvg 2.63.2). RCE is possible only under runtime-specific
  conditions on glibc Linux (non-PIE node binary); the documented workaround
  is `sharp.block({ operation: ["VipsForeignLoadSvg"] })`.

Dependency path (measured with `npm ls sharp`, lockfile, registry):

```
sharp@0.35.4
└── miniflare@5.20261001.0-alpha  (depends on "sharp": "0.35.4", exact pin)
    ├── @cloudflare/vite-plugin@1.62.5  (devDependency, ^1.62.5)
    └── wrangler@4.147.0                (devDependency, ^4.147.0)
```

## 3. Production-vs-dev classification: DEV-ONLY, not shipped

- `package.json`: `@cloudflare/vite-plugin` and `wrangler` are both
  **devDependencies**. `package-lock.json` marks `node_modules/miniflare`
  and `node_modules/sharp` `"dev": true`.
- `npm ls sharp` shows the single chain above — no production (`dependencies`)
  path reaches sharp.
- No source references it: `grep` for `sharp`/`miniflare` imports across
  `src/ e2e/ tests/ bin/` is empty (grep matched nothing besides the
  wrangler-*comment* lines in `wrangler.jsonc`/Dockerfile, which name the
  deploy tool, not the library).
- The shipped artifacts (Cloudflare Worker bundle via `vite build`, Node
  target via `vite.node.config.mts`) never bundle devDependencies; sharp is a
  native image pipeline used by miniflare's local emulation, not by request
  handling.

Exploitability in this repo: an attacker would have to feed a malicious SVG
through sharp running on a developer's `vite dev`/`wrangler dev` loop —
developer-machine surface only. Production traffic never touches sharp.

**Verdict: not a launch blocker.** No shipped production dependency is
affected; no customer data path involves the vulnerable code.

## 4. Fix decision: minimal compatible remediation exists — do it as a follow-up commit

- A compatible fix exists: **sharp 0.35.5** is a patch release over installed
  0.35.4 (`npm view` confirms 0.35.5 published; only `-rc` tags sit between).
- `npm audit fix` (without `--force`, which is forbidden) **cannot** apply it:
  the audit `fixAvailable` pointers are stale/nonsensical — they propose
  *downgrading* wrangler to **4.15.2** (installed: 4.147.0; latest: 4.148.0),
  and even the newest miniflare (`5.20261006.0-alpha`, checked via
  `npm view`) still pins `sharp: 0.35.4`. Upstream has not flowed the patch
  through yet.
- Correct minimal move: add `"sharp": "0.35.5"` to the existing
  `"overrides"` block in `package.json` (which already overrides
  `source-map-js`, so the mechanism is established in this tree), then
  `npm ci`, re-run scoped `npm audit --json`, `npm run typecheck`, and the
  narrow affected tests. No new library, no version-range churn, no UI change.
- Successor's first move (if not done in this run): make that one-line edit,
  verify `node -e` reports sharp 0.35.5, confirm audit drops to 0 high, run
  typecheck + a narrow test slice, commit separately from this report.
- Bounded next action if the override breaks the miniflare pin at install:
  revert the override, keep this report as the triage record, and file the
  blocker as "waiting on miniflare to bump sharp past 0.35.4" with a weekly
  `npm view miniflare/... dependencies.sharp` check. Risk of waiting is
  accepted per §3 (dev-only, local attack surface).

## 5. Exact outputs / exit codes recorded

- `timeout 120 npm audit --json` → exit **1**, 4 high / 0 critical / 0 moderate.
- `npm ls sharp miniflare wrangler @cloudflare/vite-plugin` → single chain,
  versions sharp 0.35.4 / miniflare 5.20261001.0-alpha / wrangler 4.147.0 /
  vite-plugin 1.62.5.
- `npm view sharp@0.35.5 version` → `0.35.5` (exists).
- `npm view wrangler versions` tail → latest `4.148.0` (fixAvailable 4.15.2 is stale).
- `npm view miniflare@5.20261006.0-alpha dependencies.sharp` → `0.35.4` (upstream not yet fixed).
- `grep sharp|miniflare src/ e2e/ tests/ bin/` → no matches.

## 6. Statement

No unresolved high issue is called fixed: as of this commit, sharp@0.35.4
(GHSA-wq5f-xc86-pv6w) is still installed. It is classified dev-only and not a
launch blocker, with the bounded override remediation queued as the immediate
follow-up.
