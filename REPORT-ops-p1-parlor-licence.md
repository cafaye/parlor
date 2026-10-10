# REPORT — OPS-P1 part 2: parlor moves from closed to the Business Source Licence

**Repo:** `/Users/kaka/Code/any/moon/cafaye/parlor`
**Worktree:** `/Users/kaka/Code/any/ops-wt/lic-services-a-parlor`
**Branch:** `ops/w0-lic-services-a-parlor` — nothing pushed, nothing merged.
**Date:** 2026-10-10. Budget: one hour; this is the wrap-up.

## The shas

| sha | what it does |
|---|---|
| `fe7d6e2` | `licence(parlor): the BSL grant, and both manifests agree with it` |
| `00a6238` | `licence(parlor): the README and CHANGELOG now describe the grant that exists` |
| `88d027c` | `licence(parlor): covenant 1 worded exactly as the SPDX text words it` |
| `9ad11e7` | `licence(parlor): the MariaDB attribution the registered text carries` |

Four commits, six files, no source, no test, no CI file. **The parlor side of
the packet is accomplished.** The three items under *contradicts the brief* are
for the manager; one of them is a decision-level question rather than a defect,
and one is a measurement that changes what "done" means for the other three
repos.

## What changed, per file, with lines

### `LICENSE` — the grant itself

Business Source License 1.1, taken verbatim from the SPDX-registered text
(fetched from `spdx.org/licenses/BUSL-1.1.html`; compared word-by-word against
SPDX's `license-list-data` `text/BUSL-1.1.txt`). The parameter block — the only
part of the file that is ours to choose — is at `LICENSE:8-12`:

```
Licensor:             Cafaye        (LICENSE:8)
Licensed Work:        parlor        (LICENSE:9)
Change Date:          2030-10-10    (LICENSE:10)
Change Licence:       Apache-2.0    (LICENSE:11)
Additional Use Grant: None          (LICENSE:12)
```

`Change Date` is four years from today: 2026-10-10 + 4 = 2030-10-10.
`Additional Use Grant` is `None`, the spelling covenant 2 asks for
(`LICENSE:73-75` — "insert the text 'None'"). No bespoke clause was added:
covenant 4 says "Not to modify this License in any other way"
(`LICENSE:79`), which is also what makes the fleet-wide diff property hold —
a reader can diff two services' LICENSEs and see only the Licensed Work name
differ. The old file was 10 lines of "Copyright (c) 2026 Cafaye. All rights
reserved." plus a paragraph stating that access alone grants no general
permission.

### `package.json:4` — `"license": "UNLICENSED"` → `"license": "BUSL-1.1"`

`BUSL-1.1` is the SPDX short identifier for this licence (confirmed on
`spdx.org/licenses/BUSL-1.1.html`) and a value npm accepts.

### `package-lock.json:10` — `"license": "MIT"` → `"license": "BUSL-1.1"`

This is the defect the brief did not predict, and it is the one worth naming.
The lockfile's root entry still recorded the **MIT** grant from kit-18 (the
changelog entry now at `CHANGELOG.md:1349` describes
`"license": "MIT"` in `package.json`), while `package.json` said `UNLICENSED`
from `2724d10` "replace first-party MIT grant with proprietary notice". The two
manifests therefore disagreed with each other *as well as* with the file —
`m156` updated one and left the other. A manifest disagreeing with its LICENSE
is exactly the drift OPS-P1 exists to stop, so the lockfile moved too. The
other 494 `"license"` values in that file are third-party grants and were not
touched.

### `README.md` — three sites asserted the closed grant

- `README.md:21-26` — "the code is free … access alone grants no general
  permission, and rights beyond viewing exist only where a separate written
  Cafaye agreement expressly grants them".
- `README.md:45-47` — the same sentence repeated under the philosophy section.
- `README.md:785-795` — the License section, which ended by explaining why
  `package.json` marked the package `UNLICENSED`.

All three now name the grant that exists and its parameters. The License
section is written as a summary rather than a grant, and it deliberately says
production use requires a commercial licence or an Additional Use Grant
(`README.md:791-792`) — see *the one thing I would not let the README say*
below.

### `CHANGELOG.md:9-29` — a Changed entry at the top of `[Unreleased]`

The stale MIT entry sits **inside `[Unreleased]`**, not under a released
version heading (the only `##` heading before it is `## [Unreleased]` at
`CHANGELOG.md:7`), so to a reader of the changelog it presents as current. I
added the new entry above it rather than rewriting the old one: a dated record
is worth more than a tidy one, and falsifying what a past packet did is not
this packet's business. The entry says so explicitly.

### `REPORT-ops-p1-parlor-licence.md` — this file.

## The fleet measurement, which changes what "done" means

The brief's acceptance criterion is that "a reader can diff two repos and see
only the Licensed Work name differ". **That holds for parlor and identity and
fails for gateway and courier**, and the failures are substantive rather than
cosmetic. Measured 2026-10-10 against the three sibling worktrees'
branch tips, comparing the grant body (Terms + Covenants) as words:

| vs parlor | result | what differs |
|---|---|---|
| `identity` | **identical, word for word** | nothing in the grant body |
| `gateway` | differs | covenant 1 is written "GPL Version 2.0 or **any** later version" in all three positions where the registered text has "any" once and "**a**" twice; and gateway appends a third-party paragraph ("Third-party components remain under their own licenses…") that the standard text does not contain |
| `courier` | differs | the same covenant-1 wording error, and the Covenants of Licensor have **lost their numbering** — covenants 2, 3 and 4 are merged into a single sentence ("…or (b) insert the text "None" to specify a Change Date. Not to modify this License in any other way."), which is the shape MariaDB's *web page* produces when its bullet list is flattened to text |

Both gateway and courier have made the exact covenant-1 error my first draft
made and `88d027c` corrected; the measurement above is what caught it in
parlor. Courier's merged covenants are the more serious of the two: the
Covenants are the part of the licence that binds *Cafaye*, and an unnumbered,
three-in-one covenant list is not the registered text.

Header shape across the four, for whoever normalises them:

| | MariaDB attribution | parameter order | label spelling | extras |
|---|---|---|---|---|
| parlor | yes (`LICENSE:3-4`) | Change Date, Change Licence, Additional Use Grant | **British** ("Change Licence") | none |
| identity | yes | Additional Use Grant, Change Date, Change License | American | a `Notice` section at `identity/LICENSE:14-18` |
| gateway | yes | Additional Use Grant, Change Date, Change License | American | the third-party paragraph |
| courier | yes | Additional Use Grant, Change Date, Change License | American | dash separators and an FAQ pointer |

**parlor's parameter block is the one the brief specified**, including its
British "Change Licence"; the other three use American, which is also the
spelling inside the unmodifiable Terms (`LICENSE:24`). If the manager wants
byte-identical files, that is a one-word change in parlor and a parameter-block
reorder in the other three — manager's call, and I did not make it for them.
Note identity's file also carries a stray leading space before "Business
Source License 1.1" on line 1.

## Verification, with what was actually run

| command | exit | result |
|---|---|---|
| `node -e JSON.parse(package.json); JSON.parse(package-lock.json)` | 0 | both parses OK |
| root lock entry vs manifest (name/version/licence/deps/devDeps) | 0 | `license in package.json: BUSL-1.1`, `license in lock root: BUSL-1.1`, `root entry matches manifest: YES` — so `npm ci` has nothing to disagree about |
| word-level diff, my Terms+Covenants vs SPDX `text/BUSL-1.1.txt` | 0 | `parlor grant body still verbatim SPDX: true` |
| word-level diff, parlor vs identity grant bodies | 0 | `parlor grant body === identity grant body: true` |
| word-level diff, parlor vs gateway / courier | 0 | both `false`, with the regions characterised in the table above |
| `git status --porcelain` | — | empty apart from the two untracked brief files |
| `git diff --stat` | — | `LICENSE 74 +++++-----`, `package-lock.json 2 +-`, `package.json 2 +-`, plus README, CHANGELOG and the report |
| `grep -rn licen tests/ bin/ gate.yml .github/` | 0 | one hit, `tests/validate-ci.sh:909` — "would otherwise **license** a missing check", the verb. No gate reads the licence field. |
| `grep -n info src/lib/openapi-document.test.ts` | 1 | zero matches — the contract test does not read `info` at all |

The word-level diff is the check that mattered, and it caught two real errors
in parlor: covenant 1's "any later version" (fixed in `88d027c`) and the
missing MariaDB attribution (fixed in `9ad11e7`). A licence transcribed from
memory is a licence nobody can rely on.

**What was NOT run, stated plainly: `npm test` was not run.** `node_modules/`
is absent in this worktree, so the suite would need a full `npm ci` over the
network first. I did not run it because the licence field is not read anywhere
in `tests/` or `bin/` (measured above) and the manifest/lockfile invariant
holds. That is a reasoned skip, not a measured green, and it is the one number
in this report that is not a proof.

## The one thing I would not let the README say

**As specified, the licence does not grant what OPS-D2's wording says it
grants.** This is the flag, and it is a decision-level question rather than a
typo.

`CAFAYE-OPS.md:176` (OPS-D2) puts the services under a Business Source Licence
and describes it as "**free to run, free to self-host, never to offer a
competing service**". The BSL text itself grants something narrower. From the
file this packet wrote:

> "The Licensor hereby grants you the right to copy, modify, create derivative
> works, redistribute, and make **non-production use** of the Licensed Work.
> The Licensor may make an Additional Use Grant, above, permitting limited
> production use." (`LICENSE:16-18`)

and, with `Additional Use Grant: None` (`LICENSE:12`):

> "If your use of the Licensed Work does not comply with the requirements
> currently in effect as described in this License, you must **purchase a
> commercial license** from the Licensor, its affiliated entities, or
> authorized resellers, or you must refrain from using the Licensed Work."
> (`LICENSE:27-30`)

So under the parameters the brief specified, a customer who self-hosts parlor
in production is not licensed by this file. That is not a reading I invented —
it is what the Terms say, and the ladder's "Self-host | free | everything: the
framework, the services, the runbooks, community" (`CAFAYE-OPS.md:356`) and the
pricing page's "Buy a unit licence, self-host free"
(`CAFAYE-OPS.md:253-254`) both promise the opposite.

**I implemented the brief as written** (`no Additional Use Grant`, per the
brief's own parameter list) rather than quietly widening it, for two reasons:
the brief specified the parameter explicitly, and a grant is not something a
worker edits to make the marketing read better. What I did instead is keep the
README honest: `README.md:791-792` says production use requires a commercial
licence or an Additional Use Grant, and it does **not** repeat "free to
self-host". If the manager decides the licence should match the promise, the
change is one parameter — an Additional Use Grant permitting internal
production use while reserving competing hosted offerings — and it is a
one-line edit in all four repos, plus the README sentence. **Recommended: the
manager decides this before OPS-P2's tier copy quotes the self-host promise.**

One smaller check on the same file, since it is a covenant we are now bound
by: covenant 1 requires the Change Licence to be GPL-2.0-or-later or a licence
"compatible with GPL Version 2.0 or any later version, where 'compatible'
means that software provided under the Change License can be included in a
program with software provided under GPL Version 2.0 or any later version"
(`LICENSE:66-68`). Apache-2.0 combined into a GPLv3 program is the standard
one-way compatibility, so Apache-2.0 satisfies it under the "or any later
version" reading, and it is what the brief specified. If counsel wants the
unambiguous version, `GPL-3.0-or-later` is squarely inside the covenant. This
is reasoned from the covenant's own definition rather than measured against an
authority — flagged as such.

## Deliberately untouched, with the reason

- **`chart/README.md:22` and `chart/values.yaml:16`** — both say "the substrate
  is closed source and a pull-based system needs somewhere to pull from". Both
  sentences are **generated output**: they are emitted by
  `caf/internal/gen/chart.go:190` (the values.yaml comment) and
  `caf/internal/gen/chart.go:552` (the chart README sentence), and the same
  text is live in `courier`, `identity` and `website`'s charts too. Hand-editing
  here would be undone by the next `caf gen chart` and would drift four repos
  apart — the exact trap `REPORT-fleet-license-specs.md` records from the
  vendored-spec brief. The fix is one line each in `caf`, which is source code
  in a repository I do not own. **Manager's call, one-line change, fixes all
  four.*
- **`openapi/v1.yaml:147-156`** — the `info:` block carries no `licence` field.
  That is an absence, not a stale claim, and it is not one of the three work
  items; `courier/openapi.yaml` and `muse/openapi/v1.yaml` both declare
  `info.licence` (per `REPORT-fleet-license-specs.md:19-31`), so this is the
  one surface where parlor's grant is now invisible. Measured:
  `src/lib/openapi-document.test.ts` returns zero matches for `info`, so adding
  the field is safe whenever it is wanted. **Flagged, not done** — a contract
  document is a deliberate edit.
- **`README.md:39`** — "There is no license key, no feature gate, no call home".
  Still true, and true of the BSL too: the BSL is legal enforcement and adds no
  technical gate. Left as written.
- **`package.json:5` `"private": true`** — left alone. That is npm publishing
  control, not a grant; the brief named the licence field only.
- **`CHANGELOG.md`'s historical entries** — the kit-18 MIT entry and the
  `2724d10` proprietary migration's absence both stay as written. The
  proprietary migration has no changelog entry at all (`grep -n m156
  CHANGELOG.md` returns nothing), which is plausibly how the lockfile drift
  survived it.

## Contradicts the brief, stated rather than resolved

1. **Work item 2 says to change `identity`, `gateway` and `courier`'s manifests
   too. I did not, and I believe I am right not to.** The dispatch brief's
   `REPO:` line names parlor only, and the HARD RULES put one worker on one
   repository on one branch with no committing to another repo's main. All
   three repos have their own worktrees running the same four-repo
   `brief-lic-services-a.txt`, and all three have now landed their own
   packets — re-measured at wrap-up:

   ```
   lic-services-a-identity  branch ops/w0-lic-services-a-identity  tip 6712be6
   lic-services-a-gateway   branch ops/w0-lic-services-a-gateway   tip c78c554
   lic-services-a-courier   branch ops/w0-lic-services-a-courier   tip 74affe3
   ```

   So the four-repo brief was split one-repo-per-worker, and editing those
   trees from here would put two workers in one file. Their grants are now
   measured rather than guessed — see *the fleet measurement*. **If the manager
   intended one worker to own all four, this brief contradicts that worker's
   dispatch and my branch is parlor-complete.**
2. **The BSL's production-use gap** — *the one thing I would not let the README
   say*, above. The decision's wording and the specified parameters disagree.
3. **The brief's licence-prose sweep would have had me hand-edit generated
   chart files** — see *deliberately untouched*.
4. **The brief's uniformity criterion is not met, and not by parlor's doing** —
   see *the fleet measurement*. Two of the three siblings have a covenant-1
   wording error and one has a garbled covenant list.

## Unverified, stated as such

- **`npm test` was not run** (see above). The licence change is inert to it by
  measurement, but the number is not a proof.
- **Apache-2.0's compliance with covenant 1 is reasoned, not measured.**
- **The fleet uniformity is measured against unmerged branch tips.** identity,
  gateway and courier are on their own branches; the manager has not merged
  them, so what I measured is what they *wrote*, not what lands.

## The successor's first move

If you are picking this up: parlor is done and green as far as it can be
verified offline. The first move is the manager's decision on the Additional
Use Grant above — everything downstream of that (the README sentence, the tier
copy in OPS-P2, the pricing page's "self-host free") waits on it, and changing
the parameter after the tier copy is published is the awkward direction.
Second move: normalise the four headers on one of the two shapes in *the fleet
measurement*, and fix gateway's and courier's covenant 1 and courier's
numbering in the same pass. Third: `openapi/v1.yaml:150`, the `info.licence`
field, once someone decides a contract document is allowed to change for it.
