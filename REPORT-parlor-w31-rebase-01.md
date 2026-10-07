# REPORT — parlor W31 rebase onto master, and the suite floor re-measured

**Branch:** `worker/parlor-w31-mfaenroll`
**Master tip:** `041acd4` (W26, the profile screen, version 2)
**Merged tree tip:** `7a0a3a9`
**Gate:** `./bin/prime` — **exit 0**

---

## 1. What I found on arrival

The previous attempt had **already rebased** the branch onto master. The
branch's history contains `041acd4` (master's tip) as an ancestor, and
`git merge-base master HEAD` returns `041acd4`. The five conflicted files
had been resolved. My job was to **verify the resolution was semantically
correct**, re-measure the floor, and run the gate.

The previous attempt also left an **uncommitted diff** to
`src/app/settings/page.test.tsx` — two session-panel test stubs gaining
`mfaStatus: mfaDisabled()`. I judged it correct (the merged screen calls
`mfaStatus` on render, so every stub that renders the full screen needs it)
and preserved it as a WIP commit (`cc3bae6`).

## 2. The rebase resolution — verified, not redone

I read both sides of all five conflicted files and confirmed each carries
**both packets' work**:

| File | W26 (profile-v2) | W31 (MFA) |
|---|---|---|
| `src/app/settings/page.tsx` | "profile screen, version 2" comment | "your second factor" in the orientation line |
| `src/app/settings/settings-screen.tsx` | `DisplayNamePanel`, `EmailPanel`, `SessionsPanel`, `SessionPanel`, `DeleteAccountPanel` | `MfaSection` — imported and rendered between `EmailPanel` and `SessionsPanel` |
| `src/app/settings/page.test.tsx` | "the display name panel", "the sessions panel", "the session panel", "signing out from the profile screen" | "the second factor section" (10 tests) |
| `src/lib/upstream.ts` | `PATCH /v1/me`, `GET /v1/sessions`, `DELETE /v1/sessions/{id}`, `DELETE /v1/me` | the four MFA management routes (`GET /v1/mfa`, `POST /v1/mfa/enrollments`, `POST /v1/mfa/enrollments/{id}/confirm`, `POST /v1/mfa/recovery-codes`) |
| `src/lib/upstream.test.ts` | display-name and session forwarding tests | "forwards the four MFA management routes the settings screen drives" |

The non-conflicting files (`auth.tsx`, `sessions.ts`, `routes/settings.tsx`,
`confirm-dialog.tsx`, `confirm-dialog.test.tsx`) had byte-identical changes
on both sides and auto-merged cleanly. `identity.ts`, `identity.test.ts`,
and `test/support/identity.ts` were supersets on the branch (W31's MFA work
built on W26's display-name/sessions work) and also auto-merged.

**No test was weakened, skipped, or renumbered.** The resolution is one
screen carrying both packets' panels, with one set of tests covering both.

## 3. The floor — re-measured, and the finding about master

### The measurement

| Tree | Command | Result |
|---|---|---|
| Merged (this branch) | `npm test` | **Tests 940 passed (940)** — 37 files |
| Master `041acd4` | `npm test` (in the main repo) | **Tests 913 passed (913)** — 37 files |

### Why the branch's 895 was wrong

The branch's floor was `895 = 868 + 27`, computed on the old base
`8c10b20` (W23). But 868 was master's **declared** floor — and master's
declared floor was **stale by 45**.

### Master's 868 is stale — a finding

Master's floor of 868 was set at profile-v1 (commit `503f3a1`). The
profile screen, version 2 (W26, commits `35639db` / merge `041acd4`)
landed **without moving the floor**. W26 added 45 tests:

- **26** in `src/app/settings/page.test.tsx` — the display-name panel,
  sessions panel, and delete-account panel, each asserted through the
  screen rather than through the client;
- **12** in `src/lib/identity.test.ts` — the four client methods W26 added
  (`updateMyDisplayName`, `listSessions`, `revokeSession`,
  `deleteMyAccount`);
- **5** in `src/lib/upstream.test.ts` — the four routes the profile-v2
  screen drives, forwarded through the table;
- **2** in `src/components/ui/confirm-dialog.test.tsx` — the dialog's
  keyboard contract.

Measured on master's tree: 913. The floor said 868. **A floor that does
not move when 45 tests land is a floor that has stopped detecting
anything** — the exact defect the gate format exists to catch. This is the
finding the brief asked me to check for, and it is real.

### The merged floor

**940 = 913 + 27**, re-measured on the rebased tree. The 27 are the MFA
enrollment surface:

- **15** in `src/lib/identity.test.ts` — the four MFA client methods;
- **2** in `src/lib/upstream.test.ts` — the four management routes
  forwarded, and a non-uuid enrollment id refused before an address is
  contacted;
- **10** in `src/app/settings/page.test.tsx` — the section, including the
  one that asserts the secret and provisioning URI are gone after the
  confirm.

### The other two floors

Both hold unchanged on the rebased tree:

- `47 checks declared, 47 passed, 0 failed, 0 skipped`
- `self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine`

## 4. The gate

`./bin/prime` — **exit 0**. All five steps green:

1. `npm ci` — 374 packages, 8s
2. `npm test` — 940 passed
3. `npm run typecheck` — clean
4. `npm run build` — clean (woff2 warnings are pre-existing and benign)
5. `tests/validate-ci.sh --self-test` — 47 checks, 52 breakages, all proven

## 5. Commits

| Commit | What |
|---|---|
| `cc3bae6` | WIP — preserved the previous attempt's partial work (`mfaStatus` in two session-panel stubs) |
| `7a0a3a9` | The suite floor is 940, re-measured on the merged tree — gate.yml derivation prose |

## 6. What is left

Nothing. The branch is rebased, the floor is re-measured and derived, the
gate is green, and the work is committed. The manager gates the merged
result and pushes.
