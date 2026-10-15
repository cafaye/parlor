# REPORT-parlor-digest-pin-01

Worker packet: adopt kit's image-digest pin in parlor's chart. Branch
`feat/digest-pin`, worktree
`/Users/kaka/Code/any/moon/wt/adopt-digest-parlor`. Commit `abf75c3`
(Q1) plus this report. No merge, no push. No second repository touched,
no sub-agents; kit was **read** (`/Users/kaka/Code/any/moon/wt/kit`),
never edited.

## 0. Outcome in one paragraph

`image.digest` now reaches the pod. `chart/templates/deployment.yaml`
renders `repository@digest` when the value is set and `repository:tag`
when it is empty, and refuses a malformed digest rather than rendering
`repository@nonsense`. `chart/values.yaml` commits this repository's
current published image digest. `src/lib/chart.test.ts` asserts both
renders and the refusal (three tests; all three shown red before green).
The full gate (`./bin/prime`) is **green**: `Tests  1109 passed (1109)`,
`50 checks declared, 50 passed`, `self_test: 56 breakages declared, 56
proven`. `gate.yml`'s suite floor moved 1106 → 1109 with the tests that
earned it. `publish.yml` already calls kit's composer — **verified, no
finding**.

## 1. The contract, quoted

The spec is kit's, and the three sentences that define this packet are
`cafaye/kit/.github/workflows/chart.reusable.yml`, lines 58–76:

> `#   3. THE IMAGE DIGEST — THE ONE THAT REACHES THE POD, AND THE ONE THAT WAS`
> `#      MEASURED MISSING. The appVersion tag is overwritten on every push`
> `#      (it is this workflow's own hand-off, re-published per master push),`
> `#      and charts pinned the image by that tag: the rendered Deployment was`
> `#      textually IDENTICAL before and after a build, so Argo's diff reported`
> `#      Synced, rolled nothing, and the box sat on the old image while the`
> `#      registry held the new one.`
> ...
> `#      A DIGEST cannot move, so this workflow writes the digest of`
> `#      the image the compose run just built into the chart's values.yaml`
> `#      (image.digest) BEFORE helm package …`

And the writing half — the `pin the image by digest` step,
`chart.reusable.yml` lines 277–359:

> `# IT REFUSES RATHER THAN WRITES A MALFORMED DIGEST: a value that is`
> `# not sha256:<64 hex> would render repository@nonsense, which`
> `# looks like a pin and fails at image-pull with nothing naming this`
> `# step.`

> `if ! printf '%s' "$IMAGE_DIGEST" | grep -qE '^sha256:[0-9a-f]{64}$'; then`
> `  echo "chart: image-digest is '$IMAGE_DIGEST', not sha256:<64 hex>." >&2`
> `  …`
> `  exit 1`
> `fi`

and the INSERT branch, lines 348–356, which is the sentence the brief
turned on:

> `else`
> `  # INSERT it, for a chart that has not adopted the field yet: the`
> `  # publish pins what the template can read, and a deployment that`
> `  # does not render image.digest ignores a value it never reads.`

The composer that hands the digest down is
`cafaye/kit/.github/workflows/publish.reusable.yml`, lines 81–102 and
the `chart:` job at 263–275:

> `# So the chart names the image by DIGEST, which cannot move, and THIS`
> `# COMPOSER is the party that knows both ends: it takes the image job's`
> `# build output and hands it to the chart job …`

> `    image-digest: ${{ needs.image.outputs.digest }}`

## 2. What changed (commit `abf75c3`)

- **`chart/templates/deployment.yaml`** — the container's `image:` is now
  `{{ .Values.image.repository }}@{{ .Values.image.digest }}` when
  `image.digest` is non-empty, else `{{ .Values.image.repository }}:{{ .Values.image.tag }}`.
  A non-empty value that is not `^sha256:[0-9a-f]{64}$` is **refused**
  with `{{ fail … }}`. A paragraph above the branch states what the field
  is, the measured defect it closes, and that the empty path is the
  back-compat leg. Only this template names the image
  (`grep -rn 'repository\|image:' chart/` — `imagePullSecrets` is the
  only other `image`-shaped name and it names a secret, not the image).
- **`chart/values.yaml`** — `digest: "sha256:fa7fa7958ad35d228a6e387d7e8bb5eb9b69a14e4d15d457c9a6fb92bdf4945f"`
  added to the `image:` block, in house voice: what writes it (the publish
  workflow, from the image job's build output), why it exists (the tag is
  mutable — the measured stale-image defect), and that the committed value
  is what a fresh clone renders.
- **`src/lib/chart.test.ts`** — a new `describe("the image digest — the pin
  Argo can see")` with three tests and a `renderedImage()` helper; the
  file header's assertion list gained the digest bullet.
- **`gate.yml`** — `suite` floor `minimum: 1106 → 1109`, with the
  accounting paragraph in the file's own "IT IS N BY THE NEXT ACCOUNT"
  chain. Measured on this tree: `Tests 1109 passed (1109), 48 files`.

Nothing else changed. Not the app, not `Chart.yaml`, not the chart's other
values, not the workflows.

### The committed digest

`sha256:fa7fa7958ad35d228a6e387d7e8bb5eb9b69a14e4d15d457c9a6fb92bdf4945f`
is this repository's **current published image digest**, read from the
registry as the brief supplied it. The chart test asserts its shape
(`^sha256:[0-9a-f]{64}$`) and that it is what the template renders, so a
fresh clone with no publish renders the pin and not the mutable tag.

## 3. The template-side decision: refuse, not absent

The brief offered "treat as absent OR refuse". I chose **refuse**
(`fail`), deliberately:

- A **malformed** non-empty digest is never a legitimate state: kit's pin
  step refuses that shape before `helm package` (`grep -qE
  '^sha256:[0-9a-f]{64}$' … exit 1`), so one reaching the template is a
  hand-edit or a bad merge. Rendering `repository@not-a-digest` is the
  defect the kit step exists to prevent; silently falling back to the
  mutable tag reproduces the **measured** stale-image defect while the
  values file still "looks pinned". Both are worse than failing loudly.
- It matches this chart's own precedent: `templates/ingress.yaml` `fail`s
  on an enabled Ingress with no host, for the same reason — a render that
  looks fine and is not is the class of defect a template guard is for.
- An **empty** digest is different and is NOT a refusal: it is a real
  state kit supports (a `push: false` run pins nothing; a chart that has
  not adopted the field), so it renders `repository:tag`, exactly as the
  chart rendered before this packet.

The refusal message names the field, the grammar, the publish step that
derives it, and the escape (`Unset image.digest to render repository:tag`).

## 4. Red proofs (run at the tree level, restored after each)

Each was run as `npx vitest run src/lib/chart.test.ts`, then
`git checkout -- chart/`.

| # | Break | Result |
|---|---|---|
| A | blank the committed digest in `values.yaml` (`digest: ""`) | `× renders repository@digest …` — **1 failed, 17 passed**; the tag render is asserted |
| B | change the template's digest branch to render `repository:tag` (the tag-only template that was the defect) | `× renders repository@digest …` — **1 failed, 17 passed** |
| C | delete the `{{ fail … }}` guard | malformed rendered `image: "ghcr.io/cafaye/parlor@not-a-digest"` and `× REFUSES a non-empty digest …` — **1 failed, 17 passed** |

After restore: `git status --short` empty, `18 passed (18)`.

## 5. The workflow verification (contract §3)

`grep -rn 'image\|digest\|repository\|ghcr' .github/workflows/`:

- **`.github/workflows/publish.yml`** — calls
  `uses: cafaye/kit/.github/workflows/publish.reusable.yml@master` with
  `push: true`. That composer calls `image.reusable.yml` then
  `chart.reusable.yml` and passes
  `image-digest: ${{ needs.image.outputs.digest }}`
  (`publish.reusable.yml:275`). **Verified — the digest reaches the chart
  job with no change needed here. No finding.**
- `e2e.yml` and `ci.yml` mention "image"/"repository" only for the
  whole-stack sibling images and the runtime pin — neither names this
  chart's image, so neither needs the handoff.
- `config/deploy.yml` builds the **Kamal/Node** image; it is a separate
  deploy target and out of this packet.

## 6. Gate (Q2)

```
==> npm ci
==> npm test           Tests  1109 passed (1109)
==> npm run typecheck
==> npm run build
==> tests/validate-ci.sh --self-test
50 checks declared, 50 passed, 0 failed, 0 skipped
self_test: 56 breakages declared, 56 proven able to fail, 0 unprovable on this machine
exit 0
```

All three `gate.yml` proofs satisfied (suite ≥1109, ci-shape-checks ≥50,
check-self-test ≥56). `./bin/lint src/lib/chart.test.ts` is clean; the
whole-tree lint was also run against kit's config.

## 7. Leftovers / notes for the successor

- **The generator is kit's.** `chart/templates/deployment.yaml` says
  "Code generated by `caf gen chart`. DO NOT EDIT." — the digest branch is
  a hand-edit here, exactly as the earlier apex-hosts packet hand-edited
  the Ingress. A follow-up should teach kit's generator the same branch
  (`cafaye/kit`, a repository this packet may not edit) so a regenerated
  chart does not drop it. **This is the one real gap.**
- The acceptance test is live and out of this worker's hands: the manager
  merges and pushes, the composer republishes the chart with the fresh
  digest, and Argo must roll the Deployment with no human step.
