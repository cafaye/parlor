# BEFORE evidence — what a sibling build costs, measured

Raw measurement for `parlor-registry-e2e-01`. Committed with the first change so
the change can be read against the numbers that motivated it rather than against
a recollection of them.

Machine: macOS (darwin), Docker on OrbStack. Docker server version and the
compose/buildx builders are on this machine; see `before-e2e-stack-build.log`.
Date: 2026-10-02T20:48Z – 20:51Z.

## The commands

    docker compose --project-name parlor-e2e --project-directory . \
      --file e2e/docker-compose.yml build identity       # 20.67s warm
    docker compose ... build guard                        #  4.40s warm
    docker compose ... build parlor                       # 15.89s warm
    docker compose ... build --no-cache identity          # 45.10s
    docker compose ... build --no-cache guard             #  4.33s
    ./bin/e2e-stack build                                 # 13.81s (all CACHED)
    touch ../identity/main.go && ./bin/e2e-stack build    # 20.40s

## What it shows, and what it does not

**The time is not the argument.** On a warm cache a full `bin/e2e-stack build`
of all three images is 13.81s, and the entire cost of invalidating identity's
image with a one-line change is 20.40s. Those are seconds, not minutes. An
honest reading of these numbers is that the *wall-clock* case for this change is
weak on this machine, and a report that inflated them would be lying about the
measurement.

`--no-cache` for guard returning 4.33s is in these logs and is not a typo: the
build genuinely re-ran and produced a different image ID
(`c057c1041e0f` -> `32c1530edb19`). BuildKit reuses its own content-addressed
store for the dependency layers, so `--no-cache` at the compose level is not the
same as a cold daemon. A number for a genuinely cold machine is therefore NOT
among these measurements, and the report says so rather than quoting 4.33s as one.

**The identity of the artifact is the argument.** What the BEFORE tags prove is
worse than slow — they prove nothing:

    cafaye/e2e-identity:local   94015e86b7bc   21.8MB
    cafaye/e2e-guard:local      32c1530edb19    202MB
    cafaye/e2e-parlor:local     caf7461ce53f    314MB

These tags are built from whatever happens to be in `../identity` and `../guard`
at the moment the suite runs, they are pushed nowhere, and nothing outside this
docker daemon can name them. The suite therefore proves things about an image
that exists for the duration of one test run. That is the "build once, deploy
once, use everywhere" model failing in the only way that matters: the
verification tier cannot be shown to consume the artifact the fleet deploys,
because it consumes a different one by construction.

**The tax is duplicated across tiers.** `cafaye/e2e-site:local` (f12aef481f93)
is present in the same image list: site's e2e builds identity and guard again,
from the same checkouts, to the same effect. One change to identity invalidates
both tiers, and both rebuild the same two images independently. That
duplication is visible in this directory and nothing else.

## Files here

| file | what it holds |
|---|---|
| `before-build-identity-warm.log` | `build identity`, warm cache, full tail |
| `before-build-guard-parlor-warm.log` | `build guard` and `build parlor`, warm |
| `before-build-cold.log` | `build --no-cache identity` and `guard`, image IDs |
| `before-e2e-stack-build.log` | a whole `bin/e2e-stack build`, then the same with `../identity/main.go` touched |