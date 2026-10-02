# HANDOFF — parlor-registry-e2e-02

**Read this section first; the rest of the file is packet 01's, still accurate
where it is not contradicted here.**

Branch `worker/parlor-registry-e2e-02`, worktree `wt-m39-parlor-registry-02`.
Seven commits on top of `ed4b522`. Not pushed — push is not mine.

## The thing packet 01 handed over: DONE, and it was not green when found

`./bin/e2e` runs the full tier against registry images. It does — **23 passed,
0 failed, 0 skipped**, on a worktree that had never run it. Evidence in
`logs/parlor-registry-e2e-02/`, summarised in `moon/logs/REPORT-parlor-registry-e2e-02.md`.

The awkward part is that **the first run of it was also green, and proved
nothing.** The resolver logged

    [e2e] sibling artifacts: 2/2 already published at localhost:16010, nothing to pull

against a registry whose catalog was `{"repositories":[]}` and whose manifests
answered 404. `ensure_sibling_artifacts` accepted a hit from `compose image
inspect` **or** `docker image ls` — both of which read the LOCAL image store —
and then printed a sentence naming the registry. A warm cache could therefore
satisfy the tier's central claim.

Fixed in `51670ac`. The probe is now `docker manifest inspect --insecure`,
which goes to the registry, and "published" and "cached" are counted as the two
separate things they are. All four states are exercised and green — the matrix
is in the report.

**So: if you are reading a green e2e log from BEFORE `51670ac`, the line
`already published at <registry>` means nothing.** Runs after it print the two
digests, which you can check against the registry.

## Three things to know before you run this

**`./bin/e2e` destroys the registry every run, by design, and it costs two
sibling builds.** `bin/e2e`'s teardown calls `bin/e2e-stack down`, which is
`compose down -v`, which deletes the registry's volume. The registry is
`registry:2` with no persistent storage (`e2e/docker-compose.yml` says so). So
the next run finds an empty registry, publishes once from the checkouts, and
runs. `11-tier-run-5-fixed-steady-state.log` is that, and `13-` is the steady
state reached by publishing explicitly first.

That means **the steady state is unreachable by typing `./bin/e2e`**. The
predecessor's report called "2/2 already published, nothing to pull" the fast
path; on this machine it only happens if you `publish-siblings` and then
`e2e-stack up` without tearing down. Worth deciding deliberately, because
"build once, deploy once" is currently true per-run and not across runs.

**The fallback announces itself, and that line is the one to read.** On a machine
with the checkouts present and the registry empty, the resolver publishes and
says so, in capitals-because-it-matters:

    [e2e] NOTE: these two images are being built from ../identity and ../guard,
    [e2e]       so this run tests YOUR working trees, not a published artifact.

A green containing that line is a green against local builds. It is not a
failure and not a skip; it is a different claim, and it is now true when it is
printed.

**`--insecure` in `bin/e2e-stack` is load-bearing, not tidiness.** Without it
`docker manifest inspect` exits 1 for a tag the registry is serving with a 200,
because this registry is plain HTTP on `localhost:16010`. It fails toward "not
published", so the symptom is a harmless-looking extra pull on every run and a
steady-state line that never appears. I shipped that mistake for one commit
(`4ed9721`) and it was caught only by running the branch it affected. Do not
delete the flag.

## Still owed, unchanged from packet 01

### 1. `.github/workflows/e2e.yml` is wrong in a way that matters

Not touched — the packet put it out of scope, twice now. Its comment claims the
compose file builds the siblings from the checkouts. It does not. Add, after the
three checkout steps and before `./bin/e2e`:

```yaml
      - name: publish the sibling artifacts the tier consumes
        working-directory: parlor
        run: ./bin/e2e-stack publish-siblings
```

Without it CI still passes — the resolver's fallback publishes and announces —
but the artifact under test would be built in the same job that tests it.

### 2. `migrate()` still needs `../identity` even on the default path

The packet asked whether kit's migrate-entrypoint had baked migrations into the
`:e2e` tags. **It has not, and cannot have for identity today.** Checked
directly: identity's `Dockerfile` builds `/out/service` and copies one file, so
`docker run --entrypoint sh <the :e2e image>` fails with `exec: "sh": executable
file not found`. The image is distroless with no migrations, no shell, and no
migrate binary. kit's `docker/entrypoint.sh` exists
(`wt-m39-kit-migrate-entrypoint-01`) and its own handoff says **no service repo
adopted it**, and that identity in particular "needs a static migrate binary
built in the builder before `KIT_MIGRATE_CMD` points at anything".

So migrations stay a host-side deploy step — `bin/e2e-stack migrate` runs
`goose` against `../identity/migrations`, which is identity's documented
procedure. **But that means the default "pull the published artifact" path still
requires the identity checkout**, while `preflight` only requires sibling
checkouts under `E2E_BUILD_SIBLINGS=1`. The two disagree, and a developer
without `../identity` gets a `cd` failure at the migrate step rather than the
clear preflight error the script already knows how to give. Small, real, and
nobody's this hour.

### 3. site's identical packet

Unchanged. Still waiting on nothing — the tier is green here — but the pattern
does not copy cleanly yet, because of the two things above: the registry does
not survive a `./bin/e2e`, and the migrate step still wants a sibling checkout.

## Not verified here, so nobody should assume it

- **No spec, no `playwright.config.ts`, no fixture and no assertion was touched.**
  All 23 tests were green before my first change and after it, which is the
  point: the image contract was the variable under test.
- **The resolver has no automated check.** `tests/validate-ci.sh` has 45 checks
  and none of them exercise this function; the gate was green through every
  defect in this file. The evidence is the four-run matrix in the report. A grep
  for `docker manifest inspect` in `bin/e2e-stack` would be the check AGENTS.md
  warns against — one a comment can satisfy — so the honest version needs a
  fake `docker` on `PATH`, and I did not have the hour.
- **`tests/validate-ci.sh` self-test still 42 breakages**, floors unchanged in
  `gate.yml`, because no test was added or removed.

## Things that will look like bugs and are not

Everything in packet 01's list below still holds. Add:

**`bin/e2e` printing two sibling builds on every run is not a regression.** It is
the registry being deleted by its own teardown, above.

**A green log saying `verified over the network, nothing to pull` is now
checkable**: the two `sha256:` lines under it are the digests, and they match
what `publish-siblings` printed when it pushed. If they ever disagree with
`GET /v2/cafaye/<service>/manifests/e2e`, the log is lying again.

---

# HANDOFF — parlor-registry-e2e-01

parlor's end-to-end tier now consumes identity's and guard's images **by tag from
a registry** instead of rebuilding both from `../identity` and `../guard` on
every run. Branch `worker/parlor-registry-e2e-01`. Committed, not pushed.

---

## Done and verified

| | |
|---|---|
| BEFORE evidence, committed | `logs/parlor-registry-e2e-01/` (4 raw logs + a README that reads them honestly) |
| `identity` and `guard` have `image:` and **no** `build:` | `e2e/docker-compose.yml` |
| A registry service, and `E2E_REGISTRY` repoints the whole document | `e2e/docker-compose.yml` |
| `parlor` keeps its `build:` | `e2e/docker-compose.yml` |
| The hatch: `E2E_BUILD_SIBLINGS=1` | `e2e/docker-compose.siblings.yml` + `bin/e2e-stack` |
| `bin/e2e-stack publish-siblings` — build, tag, push, print digest | `bin/e2e-stack` |
| Compose comments rewritten for the new contract | lines ~30, ~120, ~160, ~215, ~300, ~360 |
| `tests/validate-ci.sh` | **45 passed, 0 failed, 0 skipped** |

Verified by running, not by reading:

```
$ docker compose -f e2e/docker-compose.yml config
edge               nginx:1.27.4-alpine                 image-only
guard              localhost:16010/cafaye/guard:e2e    image-only
guard-redis        redis:7.4.1-alpine                  image-only
identity           localhost:16010/cafaye/identity:e2e image-only
identity-postgres  postgres:17-alpine                  image-only
parlor             cafaye/e2e-parlor:local             BUILD   <- intended
registry           registry:2                          image-only

$ docker compose -f e2e/docker-compose.yml \
    -f e2e/docker-compose.siblings.yml config      # the hatch
guard              cafaye/guard:e2e     BUILD ctx=.../cafaye/guard    args={"BUN_VERSION":"1.3.12"}
identity           cafaye/identity:e2e  BUILD ctx=.../cafaye/identity args={"SERVICE_NAME":"identity"}

$ E2E_BUILD_SIBLINGS=yes ./bin/e2e-stack ps
[e2e] FAIL: E2E_BUILD_SIBLINGS is "yes"; it is 1 (build the siblings from their
checkouts) or 0 (pull the published artifacts), and nothing else.
exit=1
```

---

## Half-done, and why

**SUPERSEDED by packet 02, which ran the full tier: 23 passed, 0 failed, 0
skipped.** Read the top of this file first; the two paragraphs below describe
what was true when this section was written and are kept because the reason they
gave is still the reason this handoff existed.

**The full e2e tier (`./bin/e2e`) has not been run.** It was not run in this
packet's hour. It needs a Playwright chromium download plus the suite on top of
the bring-up, and the packet's own shape said to run the services-half and hand
the full tier over rather than imply a verification that did not happen.

**What *was* run** is `bin/e2e-stack up` — registry, sibling publish, build,
start, migrations, and the bounded `/readyz` poll on every service. Its output
is `logs/parlor-registry-e2e-01/after-stack-up.log`. Read that file before
trusting the summary above: if the bring-up failed, this section is the place it
shows.

**The gate's check count did not change** (45 before, 45 after), so `gate.yml`'s
`validate-ci.sh` proof floor needed no bump. Nobody added a test.

---

## Three things the successor should decide, in this order

### 1. Run the full tier — `./bin/e2e`

The stack should already be up. If it is not:

```sh
./bin/e2e-stack up
./bin/e2e
./bin/e2e-stack down
```

This is the first move because it is the only thing in this packet that is
untested, and it is the assertion the packet cares about: that a suite which
pulls its siblings still passes every check it passed when it rebuilt them. The
assertions are untouched — no spec, no `playwright.config.ts`, no
`tests/assert-e2e-ran.mjs` edit — so a red suite here means the image contract
is wrong, not that a test moved.

### 2. `.github/workflows/e2e.yml` is now wrong in a way that matters

**Not touched — the packet put it out of scope. It needs a two-line change and a
comment fix, and it is the successor's call whether that is in the next packet or
this one.**

What is stale: the job's comment says `e2e/docker-compose.yml` builds identity's
and guard's images from the sibling checkouts. It no longer does. The checkouts
are still needed — nothing can publish an artifact that was never built — but
nothing builds them.

What to change. After the three checkout steps, before `./bin/e2e`:

```yaml
      - name: publish the sibling artifacts the tier consumes
        working-directory: parlor
        run: ./bin/e2e-stack publish-siblings
```

That is the model the packet asks for: built **once**, into the registry, named
by a tag, then consumed by the tier. It replaces three sibling builds inside
`compose build` with one explicit publish.

Without it the job still passes — `ensure_sibling_artifacts` finds the
checkouts, notices the registry is empty, publishes once and says so in the log.
That fallback is deliberate (it is what makes the default path work on a fresh
machine), but it means CI would be doing the seeding implicitly, and a reader of
a green CI log would have to read three lines down to learn that the artifact
under test was built in the same job rather than consumed from a registry. Making
it explicit is the difference between the model and an approximation of it.

### 3. site's identical packet

`site` has the same `build:` stanzas and the same duplication — `cafaye/e2e-site:local`
was in the same image list as parlor's on this machine. Once the full tier is
green here, the pattern transfers: `E2E_BUILD_SIBLINGS`, a
`docker-compose.siblings.yml`, a `publish-siblings`, and one `ensure_registry`.
Nothing in this packet makes that copy-able yet, and the report says why.

---

## Things that will look like bugs and are not

**`bin/e2e-stack build` builds one image now.** Not a dropped loop. The siblings
are consumed.

**The registry binds all interfaces, not loopback.** `tests/validate-ci.sh`
requires the bare `${E2E_REGISTRY_PORT:-16010}` shape for every published port,
as every other port in the file has, so `127.0.0.1:` in front of it fails the
gate. The check was not loosened. What it serves is two throwaway artifacts with
no credentials, deleted by `down -v`.

**No local registry existed on this machine.** The packet's premise that one did
was wrong — `kamal-local-registry` is a buildx *builder*, there is no registry
server behind it, and port 5000 is macOS AirPlay Receiver. That is why there is a
`registry` service in the compose file at all.

**The registry service must come up first.** `docker compose up` pulls every
`image:` before it creates a container, so a stack pulling from the registry it
is about to start cannot start. `ensure_registry` exists for that reason alone.

**Running the hatch leaves a local `cafaye/identity:e2e` that shadows the
registry tag.** Next default run may start the working-tree build instead of
pulling. `./bin/e2e-stack publish-siblings` puts the registry back in charge.

---

## If something is red

`bin/e2e-stack` prints the failing container's logs before it exits, by design.
`./bin/e2e-stack ps` and `./bin/e2e-stack logs <service>` are there for after.

The likeliest red is the *published* image being older than the checkout, which
is the cost of this model and not a defect in it: run `./bin/e2e-stack
publish-siblings` after pulling a sibling's changes.