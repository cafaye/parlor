# HANDOFF — roll-c5-parlor-lint

**Packet:** make `npm run lint` (kit's ESLint `recommendedTypeChecked` config) green
end to end in `cafaye/parlor`, with no runtime behaviour change.
**Branch:** `roll-c5-parlor-lint` · **Worktree:** `/Users/kaka/Code/any/moon/wt/roll-c5-parlor-lint`
**Base:** `9d64bf8` · **Status: DONE.** Gate green locally; nothing pushed, nothing merged.

## Result, measured

| check | before | after |
|---|---|---|
| `npm run lint` | **38 errors, exit 1** | **no output, exit 0** |
| `npx tsc --noEmit` | (clean) | clean, exit 0 |
| full `npm test` | — | 48 files, **1105 passed**, exit 0 |
| `./bin/prime` (repo gate) | — | **exit 0** — npm ci, 1105 tests, typecheck, `vite build` (worker + node), validate-ci 50/50, self-test 56/56 |

The brief predicted ~10 findings; the real run reported **38** across 10 files. The
brief's `158:23 '_variables'` hint and its "rename required-but-unused parameters
with the `_` prefix" remedy are both wrong for this config: kit sets **no
`argsIgnorePattern`**, so an already-`_`-prefixed unused *trailing* parameter is
still reported. The fix is to drop the unused trailing params, not to prefix them.

## Commits (2, manager merges)

1. `d906847` `lint: drop unused Link import in accounts-screen (kit eslint no-unused-vars)`
2. `35645c9` `lint: clear kit's remaining findings so npm run lint is green end to end`

## Touched files (10) and what each change was

| file | finding | fix |
|---|---|---|
| `src/app/accounts/accounts-screen.tsx` | `no-unused-vars` `Link` | removed the unused import |
| `src/app/admin/admin-screen.tsx` | `no-unused-vars` `_variables`,`_context` | `onSuccess: (kind, _v, _c)` → `(kind)` — unused trailing params dropped |
| `src/app/readyz/route.test.ts` | `no-base-to-string` | `String(input)` → real narrowing (`string` / `URL.href` / `Request.url`); a `Request` stringifies to `[object Request]` |
| `src/app/settings/settings-screen.tsx` | `no-unused-vars` `token` | dropped the unused `token` prop from `DeleteAccountPanel` and its call site |
| `src/components/shell/header.test.tsx` | `require-await` | test callback was `async` with no `await` → sync |
| `src/lib/chart.test.ts` | `no-regex-spaces` | `/^  tag:/` → `/^ {2}tag:/` |
| `src/lib/openapi-document.test.ts` | unused `isMappingEntry`; `no-base-to-string`; 6× `restrict-template-expressions` | deleted the dead helper; folded-scalar append uses a real conversion (`typeof prior === "string" ? prior : JSON.stringify(prior)`); `string[]` mismatches render with `.join(", ")` |
| `src/lib/operator.test.ts` | `require-await` | sync test callback |
| `src/lib/telemetry.server.test.ts` | 4× `require-await`; 13× `no-unnecessary-type-assertion`; 2× `no-unnecessary-type-assertion` on `as typeof fetch` | `async` dropped where nothing is awaited; `!` non-null assertions and `as typeof fetch` removed (this tsconfig has no `noUncheckedIndexedAccess`, so the type already carried them; the arrow already satisfies `typeof fetch`) |
| `src/lib/telemetry.server.ts` | `no-console` (`console.info` not in kit's warn/error allow-list) | `process.stdout.write("…\n")` — same line, same stdout. **No `eslint-disable` used anywhere.** |

No rule was disabled, no config edited (kit's config is not ours to edit), no test
weakened, no assertion deleted.

## The one judgement call

`telemetry.server.ts:193` `console.info(...)`, the single boot line on the
telemetry-disabled path. kit's `no-console` allows only `warn`/`error`, so the
alternatives were: relax kit's config (out of scope — a shared standard), use
`console.warn` (moves a chosen-state line to stderr), or `process.stdout.write`.
I took `process.stdout.write` — stdout is exactly where the line already landed,
so the observable behaviour is unchanged (confirmed: the line still prints in the
vitest output). This is the *only* place a rule and the code disagreed, and it
was resolved in favour of the code's behaviour, not by silencing the rule.

## What I deliberately did NOT do

- **No `eslint-disable`** — the packet allows one only for a genuine false
  positive, and none of the 38 was one. Every finding had a real fix.
- **No edit to kit's config or any sibling repo.** No `NEXT_PUBLIC_`, no deploy
  config, no `package.json`/lockfile change.
- **No push, no merge, no rebase, no cherry-pick of another branch** — commits
  only, on this branch.
- **Did not run the e2e tier** (`./bin/e2e`): it needs a Docker stack and no
  touched file is exercised by it. `bin/prime` plus the full vitest suite and the
  build are the relevant proofs for a lint-only change.

## Note for the manager — a duplicate packet exists

While working I found **`/Users/kaka/Code/any/moon/wt/roll-c5-nodelint-parlor`**,
a sibling worktree for a *different packet* (`roll-c5-nodelint`, "node-lint,
repos parlor+website") at the **same base commit**, whose commit `3f574a3`
("lint: clear kit's remaining findings…") already solves this exact problem.
I read it, verified every hunk, applied the equivalent changes here, and then
confirmed the 10 touched files in this worktree are **byte-identical** to that
commit's versions. Independently, I ran lint/typecheck/tests/prime *here* — the
numbers above are this worktree's, not that one's. The two branches will conflict
on merge; they fix the same defect, so merge one and discard the other.

## Reproduce

```sh
cd /Users/kaka/Code/any/moon/wt/roll-c5-parlor-lint
npm ci                 # node_modules was incomplete when this attempt started
npm run lint           # expect: no output, exit 0
npx tsc --noEmit
npm test
./bin/prime
```
