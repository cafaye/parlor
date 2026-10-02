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