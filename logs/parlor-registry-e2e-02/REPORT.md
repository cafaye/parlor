# REPORT — parlor-registry-e2e-02

**`./bin/e2e` runs the full browser tier against identity's and guard's images
pulled from a registry, on a worktree that had never run it. The result is
green, and the green is committed as evidence — after the first green turned
out to prove nothing.**

Repo `cafaye/parlor`, branch `worker/parlor-registry-e2e-02`, worktree
`wt-m39-parlor-registry-02`. Eight commits on `ed4b522`, not pushed. Push is not
mine. Raw logs in `parlor/logs/parlor-registry-e2e-02/`.

---

## 1. The answer, in one table

Seven full-tier runs. All seven: **23 passed, 0 failed, 0 skipped**, exit 0.
They are not interchangeable, and the column that matters is what the tier
actually consumed.

| # | log | registry | local cache | consumed | worth anything? |
|---|---|---|---|---|---|
| 1 | `04-` | **empty** | warm | local cache | **no** — logged a false claim |
| 2 | `08-` | populated | **removed by me** | **a real pull** | **yes** |
| 3 | `09-` | **empty, 6s old** | warm | local cache | **no** — an ordinary run, still lying |
| 4 | `10-` | empty | warm | checkouts (announced) | yes, and it says so |
| 5 | `11-` | empty | warm | checkouts (announced) | yes, and it says so |
| 6 | `13-` | populated | warm | published tag + digests | **yes — the steady state** |
| 7 | `14-` | populated | **cold** | **a real pull** | **yes — the second-machine case** |

Run 2 is the packet's headline. Run 6 is the one that proves the fast path is
honest. Runs 1 and 3 are kept because the distance between them and the others
*is* the finding.

## 2. The green that was not evidence

Run 1 is a real, complete, green tier. It also says this:

```
[e2e] sibling artifacts: 2/2 already published at localhost:16010, nothing to pull
```

and, measured before the run started (`03-registry-before.log`):

```
curl -s http://localhost:16010/v2/_catalog          -> {"repositories":[]}
GET /v2/cafaye/identity/manifests/e2e               -> 404
GET /v2/cafaye/guard/manifests/e2e                  -> 404
```

A registry holding nothing was reported as holding both artifacts, by a machine
deciding that on the strength of its own local image cache. The suite passed
against `localhost:16010/*:e2e` tags left in the local store by the
predecessor's run — images of unrecorded provenance, pulled at some point in the
past by code that no longer exists.

### It is not a cold-start artefact

Run 3 is the same sentence from **an ordinary second run of a session, with no
intervention at all** — no `docker rmi`, no `publish-siblings`, nothing. Its
pre-run state, recorded in the same log:

```
registry catalog:  (empty — the container had just been recreated by `down -v`)
GET .../manifests/e2e -> HTTP 000
local cache: localhost:16010/cafaye/guard:e2e  localhost:16010/cafaye/identity:e2e
```

then

```
[e2e] registry up in 6s
[e2e] sibling artifacts: 2/2 already published at localhost:16010, nothing to pull
  23 passed (9.5s)
TIER_EXIT=0
```

**A registry created six seconds earlier, which had never held a blob in its
life, was reported as holding both artifacts.** That is the run a developer
actually types.

### Root cause

`bin/e2e-stack`, `ensure_sibling_artifacts`:

```sh
if compose_timed 60 image inspect "$tag" >/dev/null 2>&1 \
  || [ -n "$(docker image ls -q "$tag" 2>/dev/null || true)" ]; then
```

Both probes read the **local image store**. Neither contacts `$REGISTRY`. The
`||` lets one local hit stand in for "is this published", and the log line then
named the registry in a sentence the code never checked.

An empty registry here is *by design* — `registry:2`, no persistent volume,
deleted by `down -v`, and `e2e/docker-compose.yml` says exactly that. The defect
is not the registry. It is that the tier's central claim was decided by a cache.

## 3. The fix, and the mistake inside the fix

The resolver now asks the registry, and counts "published" and "cached" as the
two separate facts they are:

```
published && cached   -> the steady state; "nothing to pull" is now true
published && !cached  -> the ordinary case on a second machine; pull it
!published            -> nothing to pull by; fall through to the checkouts
```

**I got it wrong first, and the wrongness was only visible by running the
branch.** `4ed9721` used `docker manifest inspect` without `--insecure`. This
registry is plain HTTP on `localhost:16010`, and without that flag the probe
exits 1 with `no such manifest` for a tag the registry is serving with a **200**:

```
docker manifest inspect              localhost:16010/cafaye/identity:e2e -> exit 1
docker manifest inspect --insecure   localhost:16010/cafaye/identity:e2e -> exit 0
curl -o /dev/null -w %{http_code}     .../manifests/e2e                 -> 200
```

It fails toward *not published*, which is the safe direction and still a defect:
every run announced a pull, and the steady-state line the branch exists to print
never appeared — so I had "fixed" a resolver by making it permanently say no.
`51670ac` corrects it. The digest-extraction `sed` was also matching `"Digest"`
where `--verbose` emits `"digest"`, printing nothing at all; that is fixed too,
and run 6 below is the evidence it now matches.

The lesson is the one this repository already writes down in several places, and
I walked into it anyway: **a probe is not evidence because it returned
something.** The only reason I caught this is that after fixing the false
positive I insisted on exercising the *fast* path, which is the path a broken
fast path hides behind.

### The fix, verified in both directions

Red — the state that used to lie (registry empty, cache warm), run 3 vs run 4:

```
BEFORE: "2/2 already published at localhost:16010, nothing to pull"  -> 23 passed
AFTER:  "pulling localhost:16010/cafaye/identity:e2e"
        "  localhost:16010/cafaye/identity:e2e is not in localhost:16010"
        "not published at localhost:16010 and the sibling checkouts are here;
         publishing once"
        [the existing NOTE about testing the working tree]
        "the whole stack is ready"                                   -> 23 passed
```

Green — steady state, and now **checkable rather than asserted** (run 6):

```
[e2e] sibling artifacts: 2/2 published at localhost:16010, verified over the
       network, nothing to pull
[e2e]   identity -> sha256:3d1c274bffc7300611ccf31d1c089263f407deff0fba0f5ca3acc28caae2086a
[e2e]   guard    -> sha256:4cf42f061f0f555b9ddec7a88138e2bf5ea743b401b03f029468f25846507b38
```

Those are byte-for-byte the digests `publish-siblings` printed when it pushed,
so the line can be checked against the registry instead of believed.

Second-machine case (run 7) — the one the old code also had wrong in the
*other* direction: it would have printed "already published, nothing to pull"
and returned **without pulling**, leaving compose to fetch the same bytes a step
later with no log line at all:

```
[e2e] sibling artifacts: 2/2 published at localhost:16010, not all cached locally
[e2e] pulling localhost:16010/cafaye/identity:e2e
[e2e] pulling localhost:16010/cafaye/guard:e2e
[e2e] sibling artifacts: pulled from localhost:16010
```

**What this establishes:** the image contract holds. Both siblings resolve by
tag from the registry, the stack comes up on them, identity's migrations apply,
every service reports ready, and all 23 assertions pass — with no spec, no
`playwright.config.ts`, no fixture and no assertion touched. All 23 tests were
green before my first change and after it; the image contract was the only
variable.

## 4. Migrations: the packet's question, answered

The packet asked whether kit's `migrate-entrypoint` had baked migrations into
the `:e2e` tags, warning that "the compose's old comments mentioned
migrations". **It has not, and cannot have for identity today.**

Checked directly rather than inferred:

- identity's `Dockerfile` builds `/out/service` and copies exactly one file.
- `docker run --entrypoint sh <the :e2e image>` →
  `exec: "sh": executable file not found in $PATH`. The image is distroless: no
  shell, no migrations, no migrate binary. Its entrypoint is `["/app/service"]`.
- kit's `docker/entrypoint.sh` **exists**
  (`wt-m39-kit-migrate-entrypoint-01`) and its own handoff says **no service repo
  adopted it**, that `go` and `rust` had to leave distroless because neither
  variant ships a shell, and that identity "needs a static migrate binary built
  in the builder before `KIT_MIGRATE_CMD` points at anything".

So the compose comments are not stale — they describe a host-side deploy step
that is correct. `bin/e2e-stack migrate` runs `goose` against
`../identity/migrations`, identity's own documented procedure, and it applies in
0–1s on every run in this packet. **This was not the cause of anything and
needed no fix.**

**But it leaves a real gap, which is item 2 in the handoff:** the default path
is billed as "pull the published artifact, no sibling checkout needed", and
`preflight` only requires sibling checkouts under `E2E_BUILD_SIBLINGS=1` — yet
`migrate()` does `cd "$ROOT/../identity"` unconditionally. A developer with no
`../identity` gets a `cd` failure at the migrate step instead of the clear
preflight error the script already knows how to give.

## 5. The thing nobody planned for: `./bin/e2e` destroys the registry

`bin/e2e`'s teardown calls `bin/e2e-stack down`, which is `compose down -v`,
which deletes the registry's volume. The registry is `registry:2` with no
persistent storage.

So **every `./bin/e2e` run leaves the registry empty for the next one**, and the
next run republishes from the checkouts — runs 4 and 5 above are exactly that,
each announcing the fallback in capitals. Two consequences:

1. **"Build once, deploy once, use everywhere" is currently true per-run and not
   across runs.** A developer typing `./bin/e2e` pays two sibling builds every
   time. The steady state is reachable only by publishing explicitly first
   (`./bin/e2e-stack publish-siblings`, then `./bin/e2e --no-stack`) — that is
   run 6.
2. **Packet 01's report called "2/2 already published, nothing to pull" the
   steady state**, and on this machine that sentence cannot be produced by
   `./bin/e2e` at all. It was produced by the local cache, which is why it
   looked true.

I did not change this. `-v` is right for the *database* — a stale schema is a
previous checkout's schema, and a suite that passes against yesterday's
migrations has verified nothing. Whether the registry should survive `down -v`
is a decision with a real trade on both sides, and it is not mine to make
unilaterally. It is the first thing the manager should rule on, because it
decides whether this tier costs two builds a run forever.

## 6. Priming gaps found

The worktree had no `node_modules`, as the predecessor's report said.

| step | result |
|---|---|
| `timeout 900 npm ci` | exit 0, **4.76s user / 8.06s total**, 455 packages, 0 vulnerabilities |
| `timeout 900 npx playwright install chromium` | exit 0, **1.57s** — already in the shared Playwright cache |

Both were near-instant on a warm machine, so `logs/.../01-` and `02-` are two
lines of evidence each. **No priming documentation gap surfaced and nothing was
committed for one** — `bin/prime` and the packet's instructions were accurate.
`goose` v3.28.0 and `unzip` were already on `PATH`, which `preflight` requires.

`bin/prime`'s vitest leg was **not** run: it is not in this packet's scope, and
`tests/validate-ci.sh` — the part of the gate covering the files I touched — is
green (45/0/0, below). The 662-test suite floor in `gate.yml` is unchanged and
was not re-proved here.

## 7. What I deliberately did not do

- **Did not touch a single spec, `playwright.config.ts`, fixture, assertion, or
  retry/skip setting.** 23 passed / 0 failed / 0 skipped on all seven runs, and
  the same 23 passed before I changed anything. The image contract was the only
  variable under test.
- **Did not loosen a check.** `tests/validate-ci.sh` is **45 passed, 0 failed, 0
  skipped** — unchanged, so `gate.yml`'s floors (662 / 41 / 42) needed no bump.
  No test was added or removed.
- **Did not push, merge, tag, or touch another repository's branch.**
- **Did not touch site, identity, guard, or kit.** `cafaye/e2e-site:local` is
  still the same duplication and site's packet follows this one.
- **Did not add a `validate-ci.sh` check for the resolver.** The honest version
  needs a fake `docker` on `PATH`; a grep for `docker manifest inspect` is a
  check a comment can satisfy, which `AGENTS.md` forbids. The gate was green
  through both defects in this report, and it will stay green through the next
  one — that is a known hole, named in the handoff, not papered over.
- **Did not change `down -v`** even though it costs two builds a run (§5). Right
  for the database, and the registry's half is a decision, not a bug.
- **Did not claim a speed win.** The claim this packet set out to test — that
  the tier consumes a named, published artifact — holds. The wall-clock claim
  packet 01 already declined to make is still declined here: warm builds are
  seconds.
- **Did not delete runs 1 and 3.** They are the evidence for the finding, and a
  report that showed only the green runs would be indistinguishable from one
  that never found anything.

## 8. Handoff

`HANDOFF-parlor-registry-e2e.md` in the repo, packet 02's section at the top:
what a reader of a green log may and may not believe (the line to notice is
**"if you are reading a green log from before `51670ac`, `already published at
<registry>` means nothing"**), why `./bin/e2e` empties the registry every run,
why `--insecure` is load-bearing, and the three things still owed.

**The successor's first move is `./bin/e2e` — it should now print either a real
pull or a digest pair, and never the sentence this packet spent its hour
removing.**