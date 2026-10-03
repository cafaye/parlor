# REPORT — provenance-consumers-01

**Worker** `provenance-consumers-01`
**Branches** `worker/provenance-parlor`, `worker/provenance-site`
**Worktrees** `wt-m39-provenance-parlor`, `wt-m39-provenance-site`
**Pushed** no. The manager merges and pushes.
**Full argument** `HANDOFF-provenance-consumers-01.md` (in the parlor worktree).

---

## 1. What the defect was

`kit/docker/provenance.sh` shipped a working `--verify` — the consumer side, the
one that reads a pulled image's stamp and can exit non-zero — and **nothing in
the fleet ever called it**. A mechanism that is real, tested and inert is the
same defect as a rule that cannot fail. `HANDOFF-kit-provenance-01.md`
§"FIRST MOVE — the consumer wiring" scoped it to two lines in two repositories
and stopped.

## 2. What landed, per repository

| repo | branch | files |
| --- | --- | --- |
| `parlor` | `worker/provenance-parlor` | `docker/provenance.sh` (new, copied), `bin/e2e-stack` (+the call and its reasoning), `tests/provenance-consumer-test.sh` (new), `measurement-provenance-consumer.out` (new), this report, the handoff |
| `site` | `worker/provenance-site` | the same four, minus the report and handoff |

Two repositories, two branches, no branch spans both. `docker/provenance.sh` is
copied from `cafaye/kit/docker/provenance.sh` and is **byte-identical** —
`sha1 b5e9ab563979cf45f10ed79f0ebd50984c7b4f5b` in all three places. It was
copied rather than edited deliberately: kit says a second copy site is the thing
that drifts.

### The call itself

In the reporting loop at the end of `publish_siblings`, beside the existing
digest line:

```sh
# What am I? The stamp a pulled image carries — see docker/provenance.sh.
sh "$ROOT/docker/provenance.sh" --verify "$REGISTRY/$tag" || true
```

## 3. The decision, and the measurement that forced it

**The e2e tier prints; it does not assert.** Identical in both repositories.

The packet framed the choice as "assert or print". Measurement closed it: the
assertion is not merely risky here, it is **unavailable**.

- `publish_siblings` builds identity and guard with a bare `docker build` and
  passes only `--build-arg SERVICE_NAME=…` / `BUN_VERSION=…`. It passes **no**
  `KIT_PROVENANCE_*` argument, and `identity/Dockerfile` and `guard/Dockerfile`
  do not declare the stamp at all (`grep KIT_PROVENANCE` in both: nothing).
- Measured on the images this tier actually builds:

  ```
  cafaye/identity:e2e                  labels: null    -> --verify exits 4
  localhost:16010/cafaye/identity:e2e  labels: null    -> --verify exits 4
  cafaye/guard:e2e                     labels: bun's   -> --verify exits 0, WRONG ANSWER
  ```

  So `--verify` would be red on **every** run, not the first, until two
  repositories this packet may not edit change their Dockerfiles.
- And there is no honest value for `$EXPECTED_SHA` in this tier: the siblings
  come from `../identity` and `../guard`, not from this repository, so "this
  image is at my HEAD" would be asserting something false.

`|| true` is therefore on **that one call and nowhere else**, and the reason is
written at the call site in both `bin/e2e-stack` files — not only in the
handoff, because the reader who needs it is the one reading that function.

### The `RepoDigests` line: kept, and the handoff was wrong

The brief says `--verify` *supersedes* it. It does not, because they answer
different questions: the digest is **which bytes** (`repo@sha256:…`, which
changes on every rebuild of one commit), the stamp is **which code**
(`revision`/`source`/`built_at`). `--verify` prints no digest — that is visible
in `emit_verify`, which emits five fields and none of them is a sha256. Removing
the digest line would trade the only attribution to the artifact for one that
cannot reproduce it. **Both lines stay**, and the comment above the loop says
why, because the next reader of `HANDOFF-kit-provenance-01.md` arrives with the
instruction to delete it.

## 4. The red proof

Because the tier only prints, nothing in the tier can be shown to fail. So the
proof is a test in the repository, and it is the packet's whole bar:

```sh
bash tests/provenance-consumer-test.sh      # either worktree
```

It builds **real images** (`FROM scratch`, no registry, no network) and asserts
the **real exit status** of the real script. **11 assertions, 0 failed, exit 0.**
The output is committed as `measurement-provenance-consumer.out` in each
repository, following the `kit-advisor-pgproc-01` precedent — measured output,
not a claim about output.

| case | exit | |
| --- | --- | --- |
| `--verify` on a stamped image | 0 | green path |
| `--verify --expect-revision <the stamp's own commit>` | 0 | assertion passes |
| `--verify --expect-revision <different 40-hex commit>` | **5** | **red, as it must be** |
| `--verify` on an image with no labels at all | **4** | **the trap, named in the handoff** |
| `--verify` on a reference to no such image | **4** | red |
| `--verify` on an image with an inherited base stamp | 0 | the gap — §5 |
| the e2e tier's own call form on a mismatch | 0 | the tolerance, measured |
| …does `FAIL` still appear in its text? | yes | `\|\| true` hides a status, not a finding |

Three-valued exit: `0` behaved, `1` a finding, `2` could not run. A red proof
that did not run must never read as a pass.

## 5. A finding this packet did not cause and did not fix

**`--verify` cannot distinguish an inherited stamp from its own, and this is
worse than having no stamp.** `guard` is built `FROM oven/bun`, so it carries
**bun's** OCI labels — `source: https://github.com/oven-sh/bun`,
`revision: 700fc117…`. `emit_verify` exits 4 only when labels are *absent
entirely*; present labels belonging to something else are a pass, printed with
complete confidence and full formatting.

An unstamped image at least announces itself. This one does not. Test case 6
builds that shape on purpose and asserts the exit is `0`, so it is a recorded
fact in both repositories rather than a surprise in somebody's green log.

**The fix belongs to kit** (refuse to verify when no `com.cafaye.kit.*` label
is present, or add `--expect-source`) and this packet did not touch kit. It is
written up in `HANDOFF-provenance-consumers-01.md` for the next packet.

## 6. Gates — both run, in full, with `timeout`

`gate.yml` names `./bin/prime` in both repositories. No other command was
guessed.

<!--GATE-TABLE-->

## 7. Time and shape

Deliberately small, and it stayed small: two call sites, one vendored file each,
one test each, two transcripts, one report, one handoff. No `identity/`, no
`guard/`, no kit, no other service, no third call site. Four commits per
repository. Nothing pushed.

## 8. What the next packet should do, in order

1. **Stamp the siblings** in `identity/` and `guard/` — declare the five ARGs
   and the five `LABEL`s, and pass `--build-arg KIT_PROVENANCE_*` from
   `publish_siblings`. That is what makes the asserting form available, and it
   is the only thing that does.
2. **Then** flip the call from `|| true` to `--expect-revision`, in both
   repositories, in one commit each. Until step 1 lands this is a lie.
3. **In kit:** make `--verify` refuse an image whose only labels are inherited.
4. `HANDOFF-kit-provenance-01.md` §"SECOND MOVE" — the `self_test` breakage —
   is untouched and still outstanding.