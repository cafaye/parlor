# HANDOFF — parlor-e2e-sibling-checkouts-01: the checkouts were never named, and the tier is still unrun

**Branch** `worker/parlor-e2e-sibling-checkouts-01` · **Base** `3e867cd` ·
**Three commits.** Nothing pushed, nothing merged, no other worktree touched.

**State: the packet's own work is done and verified statically. The end-to-end
tier was NOT run** — this machine has no container runtime laid out the way a
runner has, and the brief is explicit that it cannot be run here — so every
statement below about how far the tier gets is read off the tree, not measured by
running it. What is left is named rather than implied.

## 1. The `SIBLING_SERVICES` decision

**`(identity gateway)` stays at TWO entries.** This was decided from this
repository's own files, not inherited from the fork, and the alternative was
measured rather than argued.

`pantry` appears **zero times** in this tree — not in `e2e/docker-compose.yml`,
not in `bin/e2e-stack`, not in any spec, not in any document. (`grep -rn pantry`
over the whole worktree, node_modules excluded: no hits.)

The list is not a wish list, and that is what makes the question decidable
mechanically. `SIBLING_SERVICES` is the list four loops in `bin/e2e-stack`
iterate:

| loop | what an extra entry costs |
|---|---|
| `preflight` (hatch mode only) | one more `../<name>/Dockerfile` requirement |
| `publish_siblings` build | one more `case` arm |
| `publish_siblings` push | one more `docker push` |
| `ensure_sibling_artifacts` | one more registry probe, pull, and `../<name>/Dockerfile` in the `have_all_checkouts` test |

So adding `pantry` is not a widening, it is a **red build on the default path in
CI**: `publish_siblings`' `case` has recipes for `identity` and `gateway` and a
`*)` arm that dies with `no build recipe for sibling pantry`
(`bin/e2e-stack:354`). Measured, not predicted — the new workflow step, extracted
from the parsed YAML and run against a tree with a third entry and no third
checkout, exits 1 naming the missing Dockerfile (see §5).

**The alternative, and why it is rejected.** `cafaye/site`'s list has three
entries and that is correct *for `site`*: its worker found `pantry` needed three
separate ways — the image, `../pantry/migrations`, and `../pantry/tests/seed.sql`.
Copying that list here would describe a fleet this repository does not run. It is
also the shape of defect 3 this commit removes: a list that goes quiet when a
service is added, or that names services which are not there.

**The forward-looking form, so the next reader does not re-ask.** A service joins
this tier through **three edits in one commit** — a `publish_siblings` recipe
(build args included), a `build:` context in `e2e/docker-compose.siblings.yml`,
and the entry in `SIBLING_SERVICES` — and never through `SIBLING_SERVICES` alone.
That is written into `AGENTS.md` in this branch so the decision survives me.

**Also considered and rejected: adding `billing`.** `e2e/docker-compose.yml:425`
sets `BILLING_URL: "http://billing:3000"` and **no `billing` service exists in the
stack**. See §6 — it is reported, not patched, because this repository does not own
the decision of what the billing screens do when billing is absent.

## 2. What was wrong, in the order a reader hits it

1. **No checkout step named a repository.** `actions/checkout` with only `path:`
   checks out `${{ github.repository }}` — this repository — into whatever
   directory `path:` names. So `path: identity` held a **copy of parlor** and
   `path: guard` held another copy of parlor in a directory called `guard`. The job
   had never checked out a sibling, and the assertion below was satisfied by
   *parlor's own* `Dockerfile`, which is in every checkout the job has ever made.
   That is why the `guard` → `gateway` rename looked like the whole cause.
2. **The assertion was the only `run:` step in the job with no
   `working-directory: parlor`,** so it ran from `$GITHUB_WORKSPACE` and
   `../identity` resolved to `/home/runner/work/identity` — *beside* the workspace,
   which is where a `path:` checkout puts nothing. (The goose step also omits it
   and is fine: it reads no file in this repository.)
3. **The loop named a hand-written `identity gateway`** — a second copy of a list
   that already exists in `bin/e2e-stack`, which is how it came to name a
   repository by a name that stopped existing at the rename. GitHub redirects
   `cafaye/guard`, which is how this stayed invisible.

## 3. How far the tier would now get

Read off the tree, step by step, with the evidence for each line. **No line here
was measured by running the tier.**

| step | state after this branch |
|---|---|
| three checkouts | **fixed.** `repository:` named on all three; paths `parlor`, `identity`, `gateway` |
| `setup-node` | unchanged and correct — `node-version-file: parlor/package.json` is `ci.yml`'s `package.json` with the checkout's path in front of it |
| `npm ci` | unchanged |
| sibling presence | **fixed.** asserted from `working-directory: parlor`, list read out of `bin/e2e-stack`, empty extraction fails loudly, `Dockerfile` **and** `.git` checked |
| `goose` install | unchanged |
| `publish-siblings` | will run. `ensure_registry` starts a `registry:2` on 16010 with no volume; on a fresh runner it holds nothing; `ensure_sibling_artifacts` finds both tags missing, fails to pull, and falls through to `publish_siblings`, which has recipes for both. `../identity` and `../gateway` are checked out at master with root `Dockerfile`s |
| `migrate` | will run — `../identity/migrations` is supplied by the same checkout, and goose is installed by the job |
| `parlor` image build | **will run, and the build itself was measured here** — `npm run build:node` emits `.output/server/index.mjs` and 118 `.woff2` files, and the image's own command line binds `*:3000` with the compose environment. See §4 |
| `/readyz` wait | will run for `identity`, `gateway`, `parlor`, `edge`; `identity` has no container healthcheck by design and is polled from the host |
| the suite | **unknown.** 22 tests over 5 spec files. Nothing static says they cannot pass — see below |
| report upload + `assert-e2e-ran.mjs` | unchanged; floor is 2 tests and the tier has 22 |

**What the suite does NOT look like, statically.** `cafaye/site`'s handoff reports
two blockers on its tier — a spec driving a screen this fork does not have, and
four assertions expecting copy `register-form.tsx` cannot render. **Neither
applies here, and both were checked rather than assumed:**

- every `page.goto` in the five spec files targets a route that exists in
  `src/routes/` — `/login`, `/register`, `/verify-email`, `/verify-email/confirm`,
  `/forgot-password`, `/reset-password`, plus `/readyz` on each service's own port
  in `stack.e2e.spec.ts`. There is no `/verify-email` hole here.
- `register-form.tsx:74-82` carries all three created-state sentences, including
  `This deployment cannot send email right now, so no verification link was sent.`
  (`design-system.e2e.spec.ts:410`, `:528` and `session.e2e.spec.ts:138` expect
  exactly that), and `register/page.test.tsx:243` asserts the "send it again" link
  that `email-verification.e2e.spec.ts:204` expects. The copy the fork's suite
  could not produce, this tree produces.

**What remains unknown, and is why the next run matters:** whether the sibling
images build and publish on a runner; whether the `parlor` container serves (§4);
and whether `/v1/*` forwarding works from *inside* the container, which is where
`src/app/v1/[...path]/route.ts`'s module-scope `process.env` read is a live
question on a fresh runtime.

## 4. The Cloudflare/Nitro Dockerfile change and the e2e build

**Read, and the composition of the claim is uneven: the Dockerfile's build
statement is sound, its container contract is unproven here, and one compose
service points at a host the stack does not run.**

What the files say:

- `Dockerfile` builder runs `npm run build:node` (`vite.node.config.mts` →
  `nitro()` → `.output/`), and the runner copies `/app/.output` **and**
  `/app/node_modules` (production-only) and `CMD`s
  `node .output/server/index.mjs`. Nothing in the e2e document builds the
  Cloudflare target, and `e2e/docker-compose.yml` builds this `Dockerfile` with
  `context: .` — so the change did not break the *build* step's wiring, and
  `npm run build` (the Worker) is still built by `bin/prime` and by `ci.yml`'s
  `build` job.
- The runner's production tree can resolve what the output imports by name:
  `srvx` and `h3-v2` are transitive dependencies of `@tanstack/react-start`
  (via `@tanstack/start-server-core`, `crossws`), and that is a **prod**
  dependency, so `npm ci --omit=dev` installs them. Checked against the
  lockfile, not assumed.
- `.output/public/assets/files/` is copied as part of `.output`, so the webfont
  claim in the Dockerfile header holds by construction.

**The container contract: MEASURED, and it works.** `e2e/docker-compose.yml`
passes `PORT: "3000"` and `HOSTNAME: "0.0.0.0"` to the app container, and three
separate things depend on how the Nitro node server reads them:

1. the compose healthcheck probes `http://127.0.0.1:3000/healthz` **from inside**
   the container — passes whether the bind is loopback or not;
2. `edge` proxies to `http://parlor:3000` **from another container** — needs a
   non-loopback bind;
3. `bin/e2e-stack` polls `http://127.0.0.1:<published>/readyz` from the host.

So the whole question is whether that entry honours `PORT`, and whether it reads
`HOST`/`NITRO_HOST` or Docker's `HOSTNAME` for the bind address. **Measured on
this tree, with the image's own command line and the compose file's own
environment:**

- `npm run build:node` → exit 0, `.output/server/index.mjs` emitted, and
  `.output/public` carries **118 `.woff2` files** — so the fonts the Dockerfile
  header warns about are in the Node target's output, and the webfont claim holds
  by measurement now rather than by construction.
- `PORT=3000 HOSTNAME=0.0.0.0 node .output/server/index.mjs` listens on
  **`*:3000`** (`lsof`: `node … TCP *:3000 (LISTEN)`), not `127.0.0.1:3000`.
- `GET /healthz` → **200** on loopback *and* on this machine's own non-loopback
  address (`192.168.1.109`), which is the question the edge's proxy asks.
- `GET /readyz` → **200** `{"status":"ok","deps":"none"}` — the contract keys the
  platform reads, unchanged.
- `GET /v1/me` with an unreachable `IDENTITY_URL` → **502**, the fixed body. The
  BFF's forwarder read its address at run time from this process's environment and
  failed as a failure rather than as a 200.

**So the Cloudflare move did not break the e2e tier's build, and the compose
service's environment is right.** Two caveats, so this is not over-read:

1. **This ran the image's command, not the image.** The runner stage carries a
   production-only `node_modules`, and my process used the full tree. The prod
   tree resolves what the output imports by name: `npm ls --omit=dev` puts
   `srvx@0.11.22` and `h3-v2@2.0.1-rc.20` under `@tanstack/react-start`, which is
   a **prod** dependency — checked, not assumed — but only a real `docker build`
   proves the combination.
2. **`nitro` was missing from this worktree's `node_modules`** when the packet
   started (stale, pre-Cloudflare), so the first `npm run build:node` failed with
   `Cannot find package 'nitro'`. That was a **local-environment fact, not a
   repository defect**: the lockfile has it and `npm ci` installs it, which is
   also what the image's builder stage does. It is recorded because it is what
   the first attempt produced, and a report that quietly dropped a failed command
   would be a report nobody could check.

**What is left for a run:** whether the sibling images build and publish on a
runner, and whether the three processes answer each other by service name — which
is the one thing a single local process cannot tell you.

## 5. Verification

**`./bin/prime`, with the exit code captured — not inferred from a pipe.** First
run captured `PRIME_EXIT=0`, but **its log was contaminated**: `/tmp/prime.log`
also carries a Rust test banner (`==> cargo test (no database)`) from a
concurrent process on this machine, so the log cannot be quoted as evidence of
what this run printed. The gate was therefore run a second time to a private path
and the code captured from that file:

- `PRIME2_EXIT=` **0** — captured immediately after the command, with no pipeline
  between them (`PIPESTATUS` is a bash-ism that does not fire in zsh, which is the
  trap the brief names). The run reached its final line under its own
  `set -euo pipefail` (`bin/prime:82`), which is the proof that all five commands
  exited 0.
- `npm test`: **781 passed across 33 files** — exactly `gate.yml`'s declared
  `minimum` for the suite proof. No test added or removed by this branch.
- `bash tests/validate-ci.sh`: **47 checks declared, 47 passed, 0 failed, 0
  skipped** — exactly `gate.yml`'s `ci-shape-checks` floor. This branch adds no
  check and removes none, so **no floor moved and none was lowered.**
- the self-test's own tally: `self_test: 52 breakages declared, 52 proven able to
  fail` — `gate.yml`'s third floor, met exactly, nothing UNPROVABLE on this
  machine.
- `tsc --noEmit` (`npm run typecheck`): clean, between the suite and the build.

Static verification of the change itself:

- the workflow YAML parses (`js-yaml`), and the three checkout steps carry
  `repository: cafaye/parlor` / `cafaye/identity` / `cafaye/gateway`;
- the presence step's own `run:` body, extracted from the parsed document and
  executed verbatim, prints `../identity: present`, `../gateway: present` and exits
  0 against this machine's real checkouts;
- **four red proofs**, each exiting 1 with the message it claims: no
  `SIBLING_SERVICES` line at all; a third entry with no checkout beside the repo
  (this is the `pantry` hypothesis, measured); a tree with a `Dockerfile` and no
  `.git`; and the control — the same two with `.git`, green.
- `bash -n bin/e2e-stack` clean after the `../guard` → `../gateway` edits; both
  compose files still parse.
- the Node target, measured rather than assumed (§4): `npm run build:node` exits
  0 with `.output/server/index.mjs` and 118 `.woff2` files; the image's own
  `node .output/server/index.mjs` with `PORT=3000 HOSTNAME=0.0.0.0` listens on
  `*:3000` and answers `/healthz` 200, `/readyz` 200
  `{"status":"ok","deps":"none"}`, and `/v1/me` 502 against an unreachable
  `IDENTITY_URL`; `npm ls --omit=dev` puts `srvx` and `h3-v2` inside the prod
  tree, under the prod dependency `@tanstack/react-start`.

**NOT VERIFIED HERE, and not claimed:**

1. **The e2e tier was not run.** No containers, and the brief forbids burning the
   hour trying. "The step is correct" is static reasoning plus four red proofs;
   "the job is green" is not claimed anywhere.
2. **Whether `actions/checkout` of a different PUBLIC repository works under this
   job's `permissions: contents: read`** — reasoned, not measured, and inherited
   unchanged from the fork. All three repositories are public and the pattern is
   widely used. If a checkout step ever fails with a 403 the fix is `token:`, and
   nothing else in this branch depends on the answer.
3. **`E2E_BUILD_SIBLINGS=1` was not run** either, so commit 3's claim is that the
   build context, `preflight`'s check and the failure messages now name one
   directory, and that it exists — not that the hatch is green.

## 6. What I deliberately did not do

- **Did not make the tier green, and did not touch
  `tests/assert-e2e-ran.mjs` or `e2e/no-token-artifacts.ts`.** No
  `continue-on-error`, no skip branch, no soft-fail path anywhere in the job. The
  remaining unknowns are runtime questions, and a green run bought by a skip is
  the failure this job's own header bans.
- **Did not patch the `BILLING_URL` / missing `billing` service.** The compose
  file points the app at `http://billing:3000` and the stack has no `billing`
  service; no spec visits `/billing/*`, so it costs nothing today, and deciding
  whether those screens should fail loudly, be hidden, or have a stub is a
  product call about a service this repository does not own. Reported here
  instead.
- **Did not patch the Nitro bind-address question** (§4) — a finding to measure,
  not a guess to commit.
- **Did not add a `tests/validate-ci.sh` check for a `repository:`-less checkout.**
  That class is exactly what that file is for, and check + self-test breakage +
  `gate.yml`'s floor is a packet of its own. This hour's floor arithmetic is
  untouched rather than moved once and left.
- **Did not add a test.** Nothing here is testable without a container runtime,
  and a test that asserts a YAML string is not the guard — it is a copy of the
  file. The four red proofs above are the substitute, and they are recorded in the
  commit rather than invented as a suite.
- **Did not rewrite `CHANGELOG.md`'s historical `../guard` entries or
  `REPORT-provenance-consumers-01.md`.** A changelog entry records what was true
  when written; a packet report is one run's account. Editing either would make
  the history lie about itself. **A new CHANGELOG entry for this branch is owed**
  and is the first thing the next packet should write.
- **Did not run `npm ci` as a separate step.** It ran only as `bin/prime`'s first
  command, which is where the gate runs it.
- **Did not push, merge, or touch another worktree.**

## 7. Obligations the next packet can pick up, each checkable alone

1. **Run the tier.** Everything above is static. The first thing to do is
   `./bin/e2e` on a machine with `../identity` and `../gateway` beside the
   repository, then read which step goes red.
2. **Run it against the image, not just the process.** §4 measured the image's
   command line and the compose file's environment on this tree, which is not the
   same as a `docker build` of the runner stage with its production-only tree. If
   anything about the Node target is still wrong, that is where it will be.
3. **Decide the `BILLING_URL` question in §6.**
4. **Write the CHANGELOG entry** for the three decisions this branch records:
   named checkouts, the extracted sibling list, and two entries rather than three.
5. **Re-read `AGENTS.md`'s e2e paragraphs** — they were corrected here against the
   files that make them true, and they will go stale again the moment the
   mechanism changes.
6. **`AGENTS.md:231` names the wrong vitest floor.** It says "727 vitest tests"
   and "raising `minimum: 727` in `gate.yml`", while `gate.yml:450` declares
   `minimum: 781` — and gate.yml's own comment records that floor having moved
   *down* (798 → 781). The gate measured **781 passed (33 files)** here, so the
   declared floor is exactly met and `AGENTS.md` is the stale one. Reported rather
   than corrected: that number belongs to whichever packet last moved the floor,
   and this packet adds no tests and moves no floor.