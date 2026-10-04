# REPORT — parlor-docs-truth-01

**Worktree:** `/Users/kaka/Code/any/moon/cafaye/wt-parlor-docs-01`
(branch `worker/parlor-docs-truth-01`, cut from `master` at `84099d1`)

**Packet:** the README and AGENTS.md describe an architecture this repository does
not have. The migration off Next.js onto TanStack Start is complete; both
documents still describe the old architecture in the present tense.

**Four commits, in four increments.** No new document, no `CHANGELOG.md` edit,
and nothing touched outside `README.md` and `AGENTS.md`.

```
7e8db68  README: parlor is not a Next.js app, and the README says it is
02d364a  AGENTS.md: it told every agent to follow App Router conventions, and there is no App Router
faebf96  README/AGENTS: the numbers both documents quote about the gate are years out of date
54226c5  README: CI, container, deploy and e2e-topology claims that no longer describe the tree
```

## The gate

`bash tests/validate-ci.sh` — **47 checks declared, 47 passed, 0 failed,
0 skipped** on this machine (it has `caf`, `shellcheck` and a reachable docker
daemon, so nothing printed SKIP).

`./bin/prime` — **exit 0**, once, at the end. Steps and their results:

| step | result |
| --- | --- |
| `npm ci` | 312 packages, 5s |
| `npm test` | **31 files, 727 tests passed** |
| `npm run typecheck` | clean |
| `npm run build` | `vite build` clean |
| `bash tests/validate-ci.sh --self-test` | `47 checks declared, 47 passed, 0 failed, 0 skipped` and `self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine` |

Wall clock for the full gate: **7m 09s** (429s). The self-test is the large
majority of it, because each of the 52 breakages re-runs the whole check suite.

Those three lines are also the answer to AGENTS.md's three floors: the suite runs
**727** tests, the shape suite declares **47** checks, and the self-test declares
**52** breakages. `gate.yml`'s `minimum:` values are not below what the gate
reports.

`npm ci` ran *inside* `bin/prime`, which is that script's first step. It was not
run by hand.

## Every claim I checked

### Changed, and the file that makes the correction true

**The framework itself.** `grep -rn "from 'next" src/ e2e/` is empty;
`package.json` has no `next` dependency and declares `dev: vite dev`,
`build: vite build`, `start: node server/index.mjs`.

1. README "Stack": "Next.js (App Router) · …" → TanStack Start + Vite, React 19,
   `@tanstack/react-router`. Made true by `package.json`, `vite.config.mts`
   (`tanstackStart()` + `viteReact()`) and `server/index.mjs`.
2. README "a few hundred files of ordinary Next.js you can reason about end to
   end" → ordinary React on TanStack Start + Vite.
3. README "`npm run dev` on its own starts a Next.js server" → `vite dev`. Same
   claim in the command table: "`npm run dev  # Next.js alone`".
4. README's `caf.dev.json` note: "`caf dev` cannot tell that a **Next.js app**
   serves HTTP". The argument is unchanged and still true — `mise.toml`'s
   `[tasks.stack]` runs `caf dev -registry caf.dev.json -port 3000` and this
   repository declares no `exposes.api`.

**The routing model — AGENTS.md's, because AGENTS.md is what every agent reads.**

5. AGENTS.md "What this repo is": "app router, Tailwind v4" → file-based routes
   under `src/routes/`, screens and handler modules under `src/app/`.
6. AGENTS.md "Layout": `src/app/` described as the router, holding `page.tsx` per
   route and `route.ts` per endpoint, with `providers.tsx` "mounted by layout" →
   `src/routes/` is the router; `src/app/` is not scanned by the framework;
   `providers.tsx` is mounted by `src/routes/__root.tsx`. Files:
   `src/routes/index.tsx` (smallest complete example), `src/routes/__root.tsx`
   (whose own header says "THIS FILE REPLACED `src/app/layout.tsx`"),
   `src/routes/healthz.ts` and `src/routes/v1/$.ts` (whose headers describe the
   `route.ts` sibling convention as what it replaced).
7. AGENTS.md "App Router conventions: `page.tsx` per route, `route.ts` per
   endpoint, layouts at the top. Server components by default — add `"use
   client"` only for something that genuinely needs interactivity." Replaced with
   how a screen is actually added (two files), how a `GET(): Response` reaches
   the wire (`server.handlers` on a route that already exists, declaring **no**
   `component`), and the fact that `HeadContent` + `Scripts` beside `Outlet` is
   what makes a page work at all.
8. AGENTS.md "`src/app/v1/[...path]/route.ts` forwards it to identity from the
   server" → true but no longer the whole story; `src/routes/v1/$.ts` names
   `GET`/`POST`/`PATCH`/`DELETE` one by one with no catch-all, which is *why*
   "OPTIONS is never answered". Both files named now.

**The build.**

9. AGENTS.md "`rm -rf .next` and check … rather than with Next's generated
   `LayoutProps` … The CI `build` job deletes `.next`" → `rm -rf dist`. True per
   `.github/workflows/ci.yml`'s `build` job. There are no layout props at all;
   the one generated module is `src/routeTree.gen.ts`, and `git ls-files` proves
   it is **committed**, which is what `.gitignore` says at the line.
10. AGENTS.md "`build` (typecheck, then `next build`, then an assertion that the
    standalone output the Dockerfile copies exists)" → `npm run build`, asserting
    `dist/server/server.mjs`, `dist/client/assets` and `server/index.mjs` exist
    and a `.woff2` was emitted. True per `ci.yml` and the `Dockerfile`'s `COPY
    --from=builder /app/dist ./dist`.
11. README's CI table `build` row: `rm -rf .next`, `.next/standalone/server.js`,
    `.next/BUILD_ID` → the `dist/` equivalents. `.next` is not even in
    `.gitignore` any more; `/dist/` is.
12. README "standalone Next output" and "`output: "standalone"` is not `output:
    "export"`, so … `next start`/`node server.js` remains the only way this app
    runs" → there is no output mode to configure; the CMD is `node
    server/index.mjs`.
13. README "the App Router serves exactly `/healthz` and `/readyz`" (deploy-table
    difference 1) → the app does.
14. README's `NEXT_PUBLIC_*` mechanism, in three places (AGENTS.md twice): "Next
    substitutes that prefix into the client bundle" / "because `next build`
    inlines `NEXT_PUBLIC_*`". Nothing in Vite substitutes that prefix. The
    *instructions* built on it were true and are kept verbatim in substance: the
    two addresses are run-time, `tests/validate-ci.sh` fails on a `NEXT_PUBLIC_`
    name in the Dockerfile or in `src/`, and
    `src/app/v1/[...path]/route.test.ts` byte-searches the built chunks —
    `STANDALONE_CHUNKS = "dist/client/assets"`, its own header saying "Was
    `.next/static/chunks`".

**The gate's own numbers.**

15. "`./bin/prime  # npm ci + npm test + the CI gate`" (both documents) and
    README's prose describing it as install + suite + CI shape. `bin/prime` runs
    **five** commands: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`,
    `bash tests/validate-ci.sh --self-test`. Its own header says "Five commands on
    purpose". **The brief's premise checked out: there is no "four commands"
    anywhere in `bin/prime`** — it is 74 lines and I read all of them. The two
    documents quoting three were the stale ones.
16. README "`bash tests/validate-ci.sh  # 18 checks`" → 47. The script's last line
    and `gate.yml`'s `ci-shape-checks` floor.
17. README "`--self-test  # break a throwaway copy 16 ways`" and AGENTS.md's "34
    ways" → **52**. `awk '/^  for proof in \\$/,/^  do$/' tests/validate-ci.sh |
    grep -c` is 52; the script prints `self_test: %d breakages declared`; and
    `bin/prime` printed `self_test: 52 breakages declared, 52 proven able to
    fail, 0 unprovable on this machine`.
18. AGENTS.md "Measured on this tree: 46/45/44/43 passed across four machines,
    **46 declared on all four**" → the tree declares 47 today. Rewritten to keep
    the claim the paragraph exists to make — the declared total is the same on
    every machine, the passed count is not — without restating a stale
    measurement.
19. "twenty-two routes" in the forwarder's allow-list (both documents) →
    **twenty-four**. The `ROUTES` table in `src/lib/upstream.ts` has 24
    `method:` entries: 19 identity (4 core + 10 tenancy + 5 recovery/verification,
    which is exactly the identity client's surface) and 5 billing.

**The end-to-end tier.**

20. AGENTS.md's file map: "e2e/docker-compose.yml the stack: identity + gateway
    **built from ../ and siblings**" → pulled by tag from
    `${E2E_REGISTRY:-localhost:16010}`, which is the `registry:2` service at the
    top of the same file; only `parlor` is built (`build: {context: .}`). The
    compose file's own header calls this change "the point of the whole contract
    below" and names `E2E_BUILD_SIBLINGS=1` + `e2e/docker-compose.siblings.yml`
    as the escape hatch.
21. AGENTS.md "It checks out `../identity` and `../guard` beside this repository,
    **because the stack builds their images from those checkouts**" → what the
    workflow does (checks out three paths, fails when
    `../$sibling/Dockerfile` is absent) plus the fact that this no longer
    describes anything the stack does.
22. README's e2e container table: `identity` | `../identity` and `gateway` |
    `../guard` → both pulled by tag; the `registry` service on 16010 was missing
    from the table entirely. Ports verified one at a time against the `ports:`
    stanzas: edge **16000**, registry **16010**, identity-postgres **16001**,
    gateway-redis **16002**, parlor **16003**, identity **16080**, gateway
    **16081**. All seven are `${E2E_*:default}` substitutions.
23. README "The sibling checkouts `../identity` and `../guard` must exist — the
    stack builds their images from there, and CI checks out both." → backwards:
    a sibling checkout is what this tier no longer needs. What it needs is
    registry egress — the compose network cannot be `internal: true` any more.
24. README "`bin/e2e` builds it, and **so builds `identity` and `gateway` from
    their own checkouts**" and "a whole stack of containers, **three image
    builds**" → one image build and two pulls.
25. README's e2e paragraph said the workflow "checks out `identity` and
    `gateway` beside this repository" — the checkout path is `guard`, not
    `gateway` (`.github/workflows/e2e.yml`, three checkout steps).

**A self-contradiction.**

26. README listed "Playwright E2E suite (signup, login, MFA, invites, checkout)
    against the compose stack — PLAN.md §3 puts its birth in Phase 2" under
    **"Not yet — Phase 2"**, while the README's own "End to end" section
    documented the tier in detail and five spec files sat in `e2e/`. Replaced
    with what exists (`session`, `password-reset`, `email-verification`,
    `design-system`, `stack` — 23 `test(` calls) and what does not (MFA,
    invitation redemption, checkout).

**One claim that reads wrong but is a measurement.**

27. README's cold/warm table says "3m 23s building **three images** from three
    toolchains" and "4.3s running the **six specs**". Both rows are real
    measurements, so I did not delete them — I labelled them as what they are: a
    measurement taken when the stack built all three images. A warm run today is
    cheaper by however long those two builds took. Deleting a measured table is
    the rewrite the brief warns about; letting it read as current is the lie.
    (The spec count is also stale: there are 23 tests across 5 files, not 6.)

### Checked and CORRECT — do not re-check these

| claim | file that makes it true |
| --- | --- |
| `bin/prime`'s "Five commands on purpose" | `bin/prime` lines 4 and 61–74: five steps, and no "four" anywhere in the file |
| AGENTS.md's three floors: 727 tests / 47 checks / 52 breakages | `gate.yml` lines 330–331, 397–398, 438–439; `bin/prime` printed **727 passed**, **47 checks declared** and **52 breakages declared** today — the floors are not below what the gate reports |
| `config/deploy.yml` is a copy of `cafaye/kit`'s template at `b9d8a30` with **five** differences | `config/deploy.yml` lines 4–8 and the five numbered differences at 39–44 |
| `proxy.healthcheck.path: /readyz`, and `src/app/readyz/route.test.ts` reads it out of the config | `config/deploy.yml` line 227; `route.test.ts` lines 31–35 resolve `config/deploy.yml` |
| every published port is in `16xxx`, is a substitution, and matches `playwright.config.ts`'s fallbacks | `validate-ci.sh`'s own passing checks, read by hand at every `ports:` stanza |
| `playwright.config.ts`: trace off, video off, `retries: 0`, one worker | lines 43, 50, 112, 115 |
| `e2e/no-token-artifacts.ts` is the global teardown; `tests/assert-e2e-ran.mjs` reads the report twice | `e2e/no-token-artifacts.ts`; `e2e.yml` last step and the in-tier check |
| the session token key is `parlor.session.token`, and `__Host-session` is live | `src/lib/token-store.ts:20`, `src/lib/identity.ts:330`, `src/lib/upstream.test.ts:413` |
| **every** method name in README's identity table (19) and billing table (5) | `src/lib/identity.ts`, `src/lib/billing.ts` |
| every path named in README's "What is here today" table | all 15 exist |
| the primitives list in README's table | `src/components/ui/index.ts` exports exactly Button, Field, FieldSummary, ConfirmDialog, Callout, Input, CardLink, TextLink, Spinner, DescriptionList, EmptyState, ErrorState, FormStack, LoadingState, Panel, RoleBadge, Select, Surface, VisuallyHidden |
| "ten hand-written links" still to migrate | `grep -r "underline-offset-2 hover:no-underline" src/app/` → exactly 10 (in 3 files) |
| `/healthz` → `{"status":"ok"}`, `/readyz` → `{"status":"ok","deps":"none"}`, both `no-store` | `src/app/healthz/route.ts`, `src/app/readyz/route.ts` |
| `formatMoney` reads the currency exponent from `Intl`, and is the only division | `src/lib/money.ts` lines 57–77 |
| identity is the one service with no `healthcheck:` and a `FINDING` in its own block | `e2e/docker-compose.yml` line 253 |
| `mise run stack` = `caf dev -registry caf.dev.json -port 3000`; `mise run deploy:config` = `./bin/deploy-config` | `mise.toml` lines 34, 70 |
| `gate.yml`'s `miseTask: prime` resolves to `./bin/prime` | `gate.yml` line 34 + `mise.toml` `[tasks.prime]` |
| AGENTS.md's `breakage_axis` / `axis_available` exist and mirror the gate's own conditions | `tests/validate-ci.sh` lines 1484–1513 |
| `docs/design-system.md` has **no** false present-tense claim | read in full: no framework names at all; the four measured decisions, the component contracts, the four migration recipes and the "deliberately not here" list all line up with `src/components/ui/` |

### Claims I could NOT check from this tree

Every claim either document makes about the **sibling services** — `identity
serves thirty`, `identity/openapi/v1.yaml` describes five paths,
`sessionCredentialOnly`, the 503 on `/v1/email-changes`, courier's single
`linkTemplate`, identity serving no CORS headers, the measured 202/409/404
behaviours. `../identity` is not in this worktree. These were left alone: I
cannot refute them, and a correction I cannot ground is exactly the failure mode
this packet exists to prevent.

## False, outside the two documents I edited

Found, **not** fixed — `src/`, `e2e/`, `bin/`, `tests/`, `gate.yml` and the
workflows are all off-limits for this packet, and another worker is changing the
gate machinery.

| # | file:line | what it says | what is true |
| --- | --- | --- | --- |
| 1 | `caf.dev.json`, the `x-port` key (line 22) | "`src/lib/identity.ts` has the browser call identity directly, with `NEXT_PUBLIC_IDENTITY_URL` defaulting to `http://localhost:8080`" | `src/lib/identity.ts:54` is `export const IDENTITY_BASE_URL = ""`. The browser is same-origin and no `NEXT_PUBLIC_` name exists anywhere in `src/`. The rest of the key (8080 is identity's own port, `publish: true` is load-bearing) still holds. |
| 2 | `mise.toml:37` | `[tasks.dev] description = "Next dev server"` | it runs `npm run dev`, which is `vite dev`. |
| 3 | `.github/workflows/e2e.yml:10-13`, `:65-67`, `:99-111` | "e2e/docker-compose.yml builds identity's and gateway's images from `../identity` and `../guard`", and a step that fails when `../$sibling/Dockerfile` is missing | the compose file carries `image:` and **no** `build:` for both, so the step guards a build that no longer happens and the run cannot prove the checkouts were what it consumed. **This is the brief's known, out-of-scope item** — described correctly in both documents, behaviour untouched. |
| 4 | `bin/prime:11-28` | "WHY `npm run build` IS HERE … `src/components/ui/feedback.tsx` calls useCallback/useEffect/useId/useRef with no `"use client"` directive … The only thing that catches it is `next build`." | there is no `next build`. The argument survives — a bundler compile is the only thing in the gate that can see a client/server boundary jsdom cannot — but it names a tool the gate does not run. `bin/` is off-limits. |
| 5 | `src/components/ui/client-boundary.test.ts:10` | "WHY A CHECK IS NEEDED AT ALL, GIVEN `next build` ALREADY CATCHES THIS", and line 304's failure message "…fails \`next build\`" | same. The rest of that file's history is correctly framed as history ("Before the split, `next build` fails:"). |
| 6 | `src/app/v1/[...path]/route.ts:44`, `src/lib/identity.ts:32`, `src/lib/upstream.ts:11` | "`next build` substitutes `NEXT_PUBLIC_*`" in the present tense | historical in substance ("This used to be…"), but stated as a mechanism of the current build. |
| 7 | `src/lib/navigation.ts:14` | "`next/navigation` — a module name that no longer exists" | **correct**, and worth saying so: this file records the same migration from the other side. |

## What I deliberately did not do

- **`CHANGELOG.md`.** Untouched. A Next.js mention there is history and is
  correct.
- **`docs/design-system.md`.** Read in full and **not edited**: I found no false
  present-tense claim in it. Starting a fourth file to "improve" it would have
  been the rewrite the brief warns about.
- **The history passages.** Left as history on purpose: README's "Why it is not
  in the bundle. This used to be `NEXT_PUBLIC_IDENTITY_URL`, which `next build`
  inlines…", the `next/font/google` notes in `src/styles/tokens.css` and
  `src/routes/__root.tsx`, and README's PLAN.md quotation (`"app shell template +
  admin (Next.js)"`). A reader is not misled by a sentence marked "used to be".
- **The cold/warm measurement table.** Kept, labelled as a past measurement.
- **Behaviour, in both documents' out-of-scope items.** The e2e workflow's stale
  sibling-Dockerfile step (#3 above) and kit's `publish` failure: the
  *descriptions* are corrected; neither behaviour was touched.
- **New documents.** None added. If the manager wants one, the honest candidate
  is a short **"How a screen gets onto the wire"** note — route file → screen →
  handler, `server.handlers`, and why `/healthz` declares no `component`. That
  content is now in AGENTS.md's "Layout", which is where an agent will look, so I
  would not add a second home for it. A separate decision either way.
- **No subagents, no subprocesses doing independent work.** Read the brief,
  checked the tree, wrote the corrections.

## Handoff

No `HANDOFF-parlor-docs-truth-01.md`: the four "done" conditions are met and no
work on this packet remains. What is left is a decision for the manager, not a
task — items 1, 2, 4, 5 and 6 in the table above are all one-line comment fixes
in files this packet was told not to touch, and they are all the same class of
defect: prose that names a framework the repository no longer runs. They are
listed rather than fixed so the diff stays reviewable.