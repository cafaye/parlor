# HANDOFF — provenance-consumers-01

**Branches** `worker/provenance-parlor` (in
`wt-m39-provenance-parlor`) and `worker/provenance-site` (in
`wt-m39-provenance-site`) — two repositories, two branches, merged separately.
**Report** `REPORT-provenance-consumers-01.md`, in the **parlor** worktree.
**Nothing was pushed.** The manager merges and pushes.

The defect this closes: `kit/docker/provenance.sh` exists, `--verify` is
implemented and tested, and **no service in the fleet ever called it**. A
verifier with no caller is a rule that cannot fail. `HANDOFF-kit-provenance-01.md`
§"FIRST MOVE" scoped this to two lines in two repositories. Those are the two
lines, plus the test that proves they are not decoration.

---

## The decision, in one paragraph, and it is the same in both repositories

**The e2e tier PRINTS the stamp. It does not ASSERT it.** `|| true` is on the
one call in `publish_siblings` and nowhere else. This is a decision with a
measured reason, not a default, and the reason is that the assertion is not
available to this tier at all without editing two repositories this packet may
not touch:

1. **`publish_siblings` cannot produce a stamped sibling.** It builds identity
   and guard with a bare `docker build`, passing only
   `--build-arg SERVICE_NAME=identity` (or `BUN_VERSION`). It passes **no**
   `KIT_PROVENANCE_*` argument, and neither `identity/Dockerfile` nor
   `guard/Dockerfile` declares the stamp — grep for `KIT_PROVENANCE` in both
   returns nothing.
2. **Measured, on this machine, on the images this tier actually builds:**

   ```
   $ docker image inspect cafaye/identity:e2e --format '{{json .Config.Labels}}'
   null
   $ docker image inspect localhost:16010/cafaye/identity:e2e --format '{{json .Config.Labels}}'
   null
   ```

   `--verify` exits **4** on those. The first run against a sibling image built
   before this stamp exists is red, and so is every run after it, because the
   stamp will not appear until someone edits `identity/` and `guard/`. Asserting
   would hold the e2e tier permanently red for a drift that lives somewhere
   else — a tier that is always red is a tier nobody reads.
3. **There is no revision to assert against even if there were a stamp.** The
   siblings are built from `../identity` and `../guard`, not from this
   repository, so `$EXPECTED_SHA` has no honest value in this tier. Asserting
   "the sibling is at my HEAD" would be asserting something false.

`HANDOFF-kit-provenance-01.md` frames the trap as "the first run will be red,
decide whether to assert or print". The measurement says the first run **and
every run** would be red, so the answer is forced by evidence rather than
chosen by taste. The reason is recorded at the call site in `bin/e2e-stack` in
both repositories, not only here, because a reader of that file is the one who
needs it.

---

## The second decision: the `RepoDigests` line was KEPT, and the handoff was wrong

The brief says *"`--verify` supersedes it rather than sitting beside it"* and
asks for the reason either way. **It does not supersede it, and the reason is
that they are not the same fact.**

| | what it names | what it is |
| --- | --- | --- |
| `RepoDigests[0]` | **which BYTES** | `repo@sha256:…`, the registry's content address. Two rebuilds of one commit produce two of them. |
| `--verify` | **which CODE** | `revision`, `source`, `built_at`, `source_dirty`, `template_version`. |

Measured, not asserted: `--verify` prints **no digest**. Read
`docker/provenance.sh`'s `emit_verify` — the five fields are all it emits.
Deleting the digest line would therefore delete the only attribution this tier
has to the artifact itself, in exchange for a different attribution that
cannot reproduce a sha256. So both lines stay, and the comment above the loop
says so.

The reason to write this down rather than just do it: the next reader of
`HANDOFF-kit-provenance-01.md` will arrive with the instruction to remove the
digest, and without a recorded measurement they will remove it.

---

## The red proof — this is the part that matters

A consumer that prints and never fails is a consumer that has never been shown
to fail. **`tests/provenance-consumer-test.sh`**, in both repositories, builds
real images and asserts the real exit status of the real script. Nothing in it
is a claim about what the script would do.

```sh
bash tests/provenance-consumer-test.sh     # in either worktree
```

**11 assertions, 0 failed, exit 0.** Measured output is committed beside it as
`measurement-provenance-consumer.out` — one per repository, on purpose, because
the branches merge separately and a measurement that exists on only one of them
is a measurement nobody reads on the other. This follows the
`kit-advisor-pgproc-01` `measurement-pgproc.out` precedent.

The four red cases, from the committed transcript:

| invocation | exit | |
| --- | --- | --- |
| `--verify` on a stamped image | **0** | the green path |
| `--verify --expect-revision <the stamp's own commit>` | **0** | the assertion passing |
| `--verify --expect-revision <a different 40-hex commit>` | **5** | **MUST be red** |
| `--verify` on an image with **no labels at all** | **4** | **MUST be red** — the trap, named |
| `--verify` on a reference to no such image | **4** | **MUST be red** |
| `--verify` on an image carrying an **inherited base stamp** | **0** | the gap — see below |
| the e2e tier's own call form, `… \|\| true`, on a mismatch | **0** | the tolerance, measured |
| the same call, asking whether the word `FAIL` survived | yes | `\|\| true` hides a status, not a finding |

The images are built `FROM scratch` with no registry and no network, so the
measurement is of the label sink and the exit status, not of the machine.

**Three-valued exit** — `0` behaved, `1` a finding, `2` could not run (no
docker, no daemon). Never a silent `0`, following `bin/deploy-config`. A red
proof that did not run is exactly the failure mode this file exists to prevent.

---

## The finding nobody asked for, and it is a kit issue

**`--verify` cannot tell an inherited stamp from its own.** Measured on this
machine, on the image this tier builds:

```
$ docker image inspect cafaye/guard:e2e --format '{{json .Config.Labels}}'
{"org.opencontainers.image.created":"2026-04-10T03:06:38.682Z", …,
 "org.opencontainers.image.revision":"700fc117a2fd01ac0201deaa6fa69c5557acb04f",
 "org.opencontainers.image.source":"https://github.com/oven-sh/bun", …}
```

`guard` is built `FROM oven/bun`, and nothing overwrites bun's labels. So the
image **has** labels, `--verify` **exits 0**, and it prints a confident,
well-formed, completely false answer: a revision of bun's own commit, attributed
to the guard service. `emit_verify` only exits 4 when labels are *absent
entirely* (`null`), never when they are present and belong to something else.

This is worse than the unstamped case, because an unstamped image at least
announces itself. `tests/provenance-consumer-test.sh` case 6 builds that exact
shape and asserts the exit is **0**, so the gap is a recorded fact in both
repositories rather than a surprise in somebody's green log.

**Kit owns the fix and this packet did not touch kit.** The natural one is to
treat `source` as a *required* field for the `com.cafaye.kit.*` namespace:
either refuse to verify when no `com.cafaye.kit.*` label is present at all
(new exit code, distinct from 4), or require the consumer to pass
`--expect-source`. Both are kit decisions. Recorded here, not implemented.

---

## What was NOT done, and why — read this before adding anything

- **The `--expect-revision` assertion is not wired anywhere.** Not because it is
  unsafe but because there is nothing true to assert against; see point 3
  above. The flag is exercised by the test, so the next packet inherits a
  working caller rather than an unused code path.
- **`tests/provenance-consumer-test.sh` is NOT in `bin/prime`,** deliberately.
  It needs a docker daemon; `gate.yml` declares this repository's gate as
  `selfContained: false` with a node-only requirement list, and putting a
  daemon-dependent step in the per-commit gate would make a developer's gate
  red on a machine that has node and nothing else. Adding it would also move
  three floors in `gate.yml` (`662 / 41 / 42`) and add a `validate-ci.sh`
  self-test breakage, which is how a two-line packet becomes a merge conflict.
  It is a **one-command test**, run by hand and by this packet's gate evidence.
- **`identity/` and `guard/` were not edited.** They are the two repositories
  that would have to declare the stamp for the asserting form to become
  available. That is the follow-up, and it is out of scope here.
- **kit was not edited.** See the finding above.
- **No other call site was looked for beyond the two named.** Per the brief:
  found a third and it goes in this file, not into an unreviewed diff.
- **`docker/provenance.sh` is byte-identical to kit's**
  (`sha1 b5e9ab563979cf45f10ed79f0ebd50984c7b4f5b`) and is copied, not
  edited. Re-copy it rather than patching it; a second copy site is the thing
  that drifts.

---

## Gates

`gate.yml` names `./bin/prime`; both were run in full, with `timeout`. The
result of each is in `REPORT-provenance-consumers-01.md` §Gate, including the
`tests/validate-ci.sh` check and self-test tallies and the vitest counts, so a
reader can compare them against the floors `gate.yml` declares.

---

## The one-line summary for the next person

The verifier is called now, from the two places the brief named, and it prints
rather than asserts because the siblings do not stamp themselves — measured,
not assumed. The digest line stayed because it answers a different question
than the stamp. The red proof is a committed test, because a printing consumer
cannot demonstrate its own failure. And `--verify` currently cannot tell an
inherited base-image stamp from a real one, which is the next thing worth
fixing, in kit.