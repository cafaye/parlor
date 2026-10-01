# Changelog

All notable changes to parlor are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`gate.yml` — this repository's gate, declared instead of discovered.**
  `core` ships the standard (a `gate.schema.json`, a `harness/gate_check.py`
  and the reasoning in `docs/gate.md`), and this is the adopting packet for
  `parlor`: one file at the root saying what gates the repository
  (`./bin/prime`, behind `bin/prime`, resolved by `[tasks.prime]` in
  `mise.toml`, and by the `prime` job in `ci.yml`), what it needs from the
  machine that is not in the repository, and what its own output must contain
  before "passed" means anything. The honest answer for the second question is
  `selfContained: false`: `node_modules/` is gitignored, so a fresh clone needs
  the npm registry once, and no Node is vendored. Both requirements name a
  command you can paste and what "unmet" looks like, and the toolchain one is
  demonstrated rather than asserted — with `.npmrc`'s `engine-strict=true`, a
  Node that is not 22.22.2 makes `npm ci` exit 1 with `npm error code
  EBADENGINE`, so the pin is a red `bin/prime` and not a suite that quietly
  passed on a different runtime.
- **Three `proof` floors, because `bin/prime` runs three separately-countable
  things and "exited 0" says nothing about any of them:** 377 vitest tests,
  the 35 checks in `tests/validate-ci.sh`, and the 34 breakages in its
  self-test. A run that skipped one and exited zero is `gate.proof-missing`,
  which is a failure — the `cafaye-rb` defect, where a tier never executed once
  and the run printed `ok`. The floors are decrease-detectors, not budgets:
  they are today's counts, so a suite that quietly lost forty tests cannot
  report itself as passing. Note what this repository does **not** have, which
  `core` does: a ratchet test that forces the floor up when the suite grows.
  Here it is a thing a human has to remember.
- **`tests/gate-declaration-self-test.sh` — proof that the proof can fail.** A
  control on an unmodified clone, then every breakage asserted to go red **and
  to name the finding it expects** — including the one that is not string
  matching at all: a well-formed `bin/prime` that is `exit 0`, where every
  string in `gate.yml` is true and the repository is ungated. It is
  deliberately not in `bin/prime`: the checker is `core`'s and is not vendored
  here, and the proof cases each run the whole gate in a fresh clone. It exits
  **2**, never 0, when `core` is not beside the repository.
- **Colour cases built from captured bytes.** Four fixtures reproduce the exact
  byte sequences a real run of this gate wrote with `FORCE_COLOR=1` — the
  coloured `Tests` line, one where the suite lost tests, one where it skipped
  one, and one that printed the file count instead of the test count. They are
  transcriptions rather than hand-rendered imitations, because a fixture that
  re-drew the output would be testing the fixture.

- **The whole-stack end-to-end tier.** `./bin/e2e` brings up a Docker Compose
  stack — `parlor` built from here, `identity` and `guard` built from
  `../identity` and `../guard`, one Postgres, one Redis, and the same-origin edge
  described above — waits on each service's `/readyz` with a bounded poll,
  installs the pinned Chromium, runs six Playwright specs, checks the report and
  takes the stack down. It is deliberately *not* in `bin/prime`: a whole stack
  is not a per-commit gate. Six specs, in two files:
  `e2e/session.e2e.spec.ts` is the headline path — a person creates an account,
  signs in, sees an account row `identity` created and made them the owner of,
  creates a second account through the form, signs out, reloads, and is signed
  out — and it includes the security case that only a real service can settle,
  a wrong password and an address that was never registered rendering
  byte-identical refusals. `e2e/stack.e2e.spec.ts` is the whole deployment seen
  from a browser: every service's `/readyz` as rendered text, guard refusing an
  anonymous caller, and the one API-shaped assertion, which is there because
  guard's BFF has no page and asserts the *distinction* between 401 and 503 —
  the only way to tell that guard reached identity at all.
- **`e2e/no-token-artifacts.ts` — the credential guard, and the first version of
  it was wrong.** Playwright's config sets `trace: "off"` and `video: "off"`
  because a trace is a full request log and four of this suite's requests carry
  `Authorization: Bearer <identity session token>`. A setting is not a
  guarantee, so the global teardown walks every file the run produced and fails
  if one contains a token the run actually minted — recording tokens to a
  `0o600` file in the OS temp directory, never to the repository and never to
  the artifact directory, and destroying it on every path. The first version
  compared raw bytes and reported *"6 files scanned, none found"* on a run that
  had just written six traces each containing the full bearer header: a trace's
  network log is NDJSON **inside** a deflated zip, so the needle was not in the
  bytes of the `.zip`. It now reads archive members (`unzip`, declared a
  prerequisite rather than assumed) and deletes the offending files before
  failing, because a red run that leaves traces full of live tokens on disk has
  fixed the badge and left the problem where somebody's bug report will find
  it.
- **`tests/assert-e2e-ran.mjs` — the tier cannot pass by not running.** Fails
  when the JSON report says fewer than `MINIMUM_TESTS` passed, when anything was
  skipped, and when anything only passed on retry. It is the guard-05 mechanism
  (a gated tier that exits 0 having verified nothing) applied to a tier built so
  it cannot skip at all: there is no `test.skip`, no `test.fixme` and no
  environment variable that turns it off.
- **`.github/workflows/e2e.yml`** — the tier's own workflow and its own job, not
  `continue-on-error`. It checks out `identity` and `guard` beside this
  repository (the stack builds their images from there), installs `goose` pinned
  to an exact version, runs `./bin/e2e`, uploads the JSON report, and then runs
  the report check again with `if: always()` so the count is in the log whatever
  happened. No secrets: the fixture database, its credentials and its volumes
  are throwaway.
- **`tests/validate-ci.sh` — fifteen more checks, and the self-test grows from
  sixteen breakages to thirty-four.** The new ones are all claims about whether
  the end-to-end tier can be green without having run: it has its own workflow,
  it is not in `ci.yml` or `bin/prime`, the job calls `./bin/e2e`, it cannot be
  soft-failed, and it calls the report check. Plus the config invariants —
  `trace` and `video` off, `retries: 0`, no `test.skip` anywhere in `e2e/` — and
  the topology: every published port a substitution, inside `16000-16099`,
  colliding with nothing this workspace already owns (the observability stack's
  `15xxx`, the identity-07 worker's `5437`, darkroom's `55432`, the standard
  service ports), matching the fallbacks in `playwright.config.ts`; every image
  pinned to an exact tag; and every service carrying a `healthcheck` or a
  `FINDING` in its own block. Three of the new checks were wrong before they
  were right and the self-test is what said so — they are written up where they
  live.
- **Measured, on an M-series laptop with OrbStack: a cold `./bin/e2e` is 5m 08s
  (3m 23s of it building three images from three toolchains) and a warm one is
  1m 31s, of which 4.3s is the six specs.** The specs are 3% of a warm run. The
  stack is the cost, which is the argument for the tier not being in
  `bin/prime`, and the warm number is the one a self-hoster needs.
  `COMPOSE_PARALLEL_LIMIT` defaults to 1 because three toolchains building at
  once took the container runtime down on this machine and the error named a
  socket rather than a cause.
- **`e2e/` layout**, all documented in the files themselves: `docker-compose.yml`
  (topology, port block and readiness, with where the topology came from and
  what it cost), `edge.conf` and `proxy-headers.conf` (the same-origin edge),
  `session-tokens.ts` (the one place a token is written down and the one place
  it is destroyed), `no-token-artifacts.ts` (the teardown).

- `.github/workflows/ci.yml` — three jobs. `ci` calls kit's reusable workflow
  at `cafaye/kit/.github/workflows/ci.reusable.yml@master` with
  `language: node`, so the shared install/lint/test contract lands here
  without a copy. `prime` runs `./bin/prime` — the command a developer runs —
  and then `git diff --exit-code -- package-lock.json`. `build` deletes
  `.next`, runs `npm run typecheck`, runs `npm run build` with the two
  build-time `NEXT_PUBLIC_*` values set, and asserts that
  `.next/standalone/server.js` and `.next/BUILD_ID` exist, because those are
  what the Dockerfile copies and nothing else notices when they are missing.
- `tests/validate-ci.sh` — the half of the gate that checks the gate. Eighteen
  checks over the runtime pin, the lockfile contract, the gate command, the
  npm scripts the workflow calls, and the agreement between `package.json`,
  `mise.toml`, the workflow and `cafaye.yml`. `--self-test` breaks a
  throwaway copy 16 ways and asserts each one goes red, plus the opposite
  case: a comment that merely *mentions* `npm install` must not fail the check
  that forbids it. It reads the workflow as text with anchored greps, so it
  needs no PyYAML, no yq and no jq.
- The runtime pin, in `package.json`: `engines.node` 22.22.2 and
  `packageManager` npm@10.9.7. There was no `engines` and no `packageManager`
  before, so nothing in the repository pinned the runtime — `mise.toml` did,
  but mise is a workstation tool and a CI runner never reads it. The same
  `npm ci` on the machine this was written on ran on Node 22.12.0 one directory
  away from the pin.
- `.npmrc` with `engine-strict=true`, so the pin is a gate. Verified both ways
  on a throwaway package: with it, `npm ci` exits nonzero (`npm error engine
  Unsupported engine … Required: {"node":"99.0.0"} / Actual: {…,"node":"v12.0.0"}`);
  without it, the same command prints `npm warn EBADENGINE` and installs.
- `bin/prime` gained a third command, `bash tests/validate-ci.sh
  --self-test`. It was `npm ci` then `npm test`. A developer running the gate
  should get the same three checks CI does; otherwise the CI half is a variant,
  and a variant is the thing this removes. The two original commands are
  unchanged and still the reproduction check.

### Fixed

- **The floors in `gate.yml` and the floors this repository's self-test breaks
  things against are now asserted to be the same numbers.** `gate.yml` said so
  itself, at the `suite` proof: there is no ratchet test here, so "raising this
  number when the suite grows is a thing a human has to remember until MD12's
  machinery lands." That remembering is now a control — `control 3` reads both
  files and compares, statically, and costs nothing.

  Added because this is the **third repository in this batch** where a floor and
  a second copy of that floor drifted apart. In `billing` the copy sat inside a
  case that reported a green while proving nothing. In `caf` the merge itself
  made the floor wrong, and correcting it turned the self-test's stand-in red
  because the stand-in carried its own `432`. Here the copy is in five `printf`
  fixtures and one `sed` edit, and every failure mode is loud rather than
  silent — a stale literal makes that `edit` a no-op, which leaves the gate
  green, which the `expect_red` beneath it reports as a failure. Loud is better
  than billing's, but it is still a number held in two files by a comment, and a
  comment is not a check. Verified in both directions: green at 377, and red
  naming the proof when the floor is moved to 378 and the script is not.

- **The escape tolerance that was a workaround for a core defect is deleted,
  and the deletion is a tightening.** `core-13` (`c63af27`) landed MD17:
  `harness/gate_check.py` strips ANSI escape sequences from the gate's captured
  output in exactly one place — `prove()`, where the output is read — before it
  applies any `proof[].match`. The `suite` proof no longer needs the
  `(?:[ ]|\x1b\[[0-9;]*m)*` runs it carried for that gap, and they are gone:

      - match: '^(?:[ ]|\x1b\[[0-9;]*m)*Tests(?:[ ]|\x1b\[[0-9;]*m)*([0-9]+)[ ]+passed(?!(?:[ ]|\x1b\[[0-9;]*m)*\|)'
      + match: '^[ ]*Tests[ ]+([0-9]+)[ ]+passed(?![ ]*\|)'

  The runs could match *nothing*, and that is the half that made them a liability
  rather than only an inconvenience: on the stripped bytes
  `      Tests377 passed (377)` the old pattern matched and read 377 off it, and
  the new one refuses the line. `vitest` always prints a space between the label
  and the count, so a line without one is not a summary a floor should be read
  from. Both verdicts are asserted on the same fixture in
  `tests/gate-declaration-self-test.sh`, so the tightening is measured rather
  than argued.

  The negative lookahead `(?!…\|)` is kept untouched — it has nothing to do with
  colour, and it is what makes a suite that *skipped* a test
  `gate.proof-missing` instead of a smaller green. Every other group stays
  `(?:…)`: the floor is read from exactly one capture group, and there is now a
  case for what happens when there are two.

  Three new cases and one new assertion guard the deletion rather than trusting
  a comment: `no-separator` (a summary whose label and count are not separated
  by a space is refused), `no-separator-under-the-old-pattern` (the same line is
  accepted under the deleted tolerance, which is what makes the first case mean
  something), `floor-with-two-capture-groups` (a second group beside the first
  is `gate.proof-invalid`, not a smaller pattern), and a static check that fails
  if **any** `match:` in `gate.yml` names a terminal escape, in any spelling and
  raw ESC included. Putting the tolerance back is now a red, not a question for
  the next reviewer.
- **`ci.yml`'s `run: |` block, which was the same kind of workaround, is gone
  too.** `core-12` (`63fd319`) fixed `workflow_run_lines()` so a one-line
  `run: <command>` is read rather than invisible to `gate.ci-disagrees`, so the
  `prime` job spells the gate invocation the ordinary way again. Two cases pin
  it: `ci-disagrees` rewrites the one-line command in place, and the new
  `ci-step-deleted` removes the step entirely — so "the checker can see this
  step" is asserted from both sides instead of assumed from a green control.
- **The self-test's second control now guards `core`'s stripper rather than this
  repository's pattern, and says which it is guarding.** With stripping in
  place, control 1 cannot be made red by colour at all, so the `FORCE_COLOR=1`
  control is the only case that would go red if `core` ever stopped stripping.
  The `prefix-pattern-colour` case used to SKIP once core learned to strip; it
  now asserts which side of MD17 the repository is on and prints which answer it
  got, because "the pre-fix pattern is green *because* core strips" is a fact
  worth stating rather than a case with nothing left to say.

- **A gate proof that could not see coloured output, so a green run was
  reported as `gate.proof-missing`.** The `suite` proof reads the vitest
  summary, and the pattern it used — `^[ ]*Tests[ ]+([0-9]+) passed` — is
  correct for the output a human sees and wrong for the bytes the checker
  reads. `vitest` decorates that line, and with `FORCE_COLOR=1` in the
  environment the gate is captured in, the bytes on disk are
  `\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m377 passed\x1b[39m…` — a line that
  begins with an escape, not with a space, so `^[ ]*` cannot match it. The
  checker reported `gate.proof-missing` about a gate that had proved, in the
  same log, that it ran 377 tests, and three other cases failed the same way:
  fixtures that should have been caught by `gate.floor` were caught by
  `gate.proof-missing` instead, because a floor is never read when the proof
  never matched. The pattern now carries no escape handling at all:
  `core` strips the escapes before it matches, and the space between the
  label and the count has to be a real space.
- **A suite that *skipped* a test satisfied the suite proof.** `vitest` writes
  `Tests  2 passed | 1 skipped (3)`, and the old pattern matched that line and
  read 2 off it. The proof now refuses any line where a `|` follows `passed`,
  so a skip is `gate.proof-missing` rather than a smaller green — the rule
  AGENTS.md already states for the end-to-end tier, applied to the suite. This
  half is a tightening and is not about colour: **keep it** when the escape
  tolerance is deleted.
- **A control that could only pass on a machine whose tools do not colourise.**
  `tests/gate-declaration-self-test.sh` ran its control once, against whatever
  bytes the local toolchain happened to produce, so the pattern above was
  green here and red on the manager's. The control now runs **twice**: once as
  before, and once with `FORCE_COLOR=1` in the environment the checker captures
  the gate in. A self-test's own control going red is no longer a finding to
  disclose at the end of a report — it blocks the packet (D13).
- **A breakage that stopped applying still reported "goes red".** The script
  broke its sandboxes with a Python edit that fails loudly when the text it is
  replacing is not there, but on failure it carried on, so a case whose setup
  had gone stale would go red for an unrelated reason and be reported as
  catching the finding it was written for. An un-applied breakage is now a
  `FAIL` in its own right, and every expectation refuses to run without it.
- **A step that ran the gate was invisible to `core`'s gate checker.** (Carried
  over from the previous packet, which was not landed; re-recorded here because
  the change ships in this one.) `harness/gate_check.py`'s
  `workflow_run_lines()` collects a workflow's `run: |` block bodies and
  nothing else: its `RUN_KEY` is `^(\s*)run:\s*([|>][-+]?)?\s*$`, which a
  one-line `run: <command>` does not match. `ci.yml`'s `prime` job ran
  `./bin/prime` on one line, so `gate.ci-disagrees` reported that CI does not
  run the gate when CI does run it — on a declaration that was entirely true.
  The same reader also misses `run: git diff --exit-code` in **`core`'s own**
  `ci.yml`, so the gap is in the checker and not in this workflow. The step is
  now a block scalar, which changes what the step does not at all, and the
  reason is written above it so nobody tidies it back. The fix belongs in
  core's `workflow_run_lines`.

### Changed

- **`docker build` works, and the three faults that stopped it are fixed.** It
  could not build on `master` when this packet started; the CHANGELOG recorded
  why, and this is what changed. The `deps` stage no longer inherits
  `NODE_ENV=production` into a production-only install (`npm ci --include=dev`,
  which is what puts `@tailwindcss/postcss` and `typescript` back); `.npmrc` is
  copied into the build context, so `engine-strict=true` is enforced there and
  not only on the host; the base is `node:22.22.2-slim`, the pin
  `package.json` declares, rather than `node:22-slim` which resolved to
  22.23.3 and would have shipped a different runtime than the suite verifies
  on; and the runner no longer copies a `/app/public` this repository does not
  have. Verified by `bin/e2e`, which builds the image and runs a browser
  against it. The three were found by the previous packet and left deliberately
  — it was scoped to CI and the image is a deployment surface — and the
  end-to-end packet could not exist without them.
- `mise.toml` — no version changed. A comment now says it mirrors
  `package.json` and that the gate fails when the two disagree.
- `README.md` and `AGENTS.md` — the pin is described as living in
  `package.json` with three mirrors rather than as living in `mise.toml`, and
  both gained a CI section. The old AGENTS.md line said "Node is pinned in
  `mise.toml` … do not add a second pin", which was true when written and
  wrong the moment the pin had to be readable by npm and by CI.

- `src/lib/roles.ts` — the role vocabulary and the capability matrix, transcribed
  from identity's tenancy authorization: the order and the three names from
  `AllRoles` and `Role.AtLeast`, the matrix from `registerTenancyRoutes`, and the
  rule that splits inviting a member (admin) from handing out admin (owner) from
  `Service.InviteRole`. Plus a mirror of the service's `Slugify` and
  `ValidateName`, so a name that cannot make a handle is refused before a round
  trip. The service is the authority; this is a copy, and a reason not to offer a
  button rather than a reason to believe it would work.
- The tenancy surface on `src/lib/identity.ts` — the ten account routes:
  `POST`/`GET /v1/accounts`, `GET`/`PATCH`/`DELETE /v1/accounts/{id}`,
  `GET /v1/accounts/{id}/members`, `POST /v1/accounts/{id}/invitations`,
  `POST /v1/invitations/accept`, and
  `PATCH`/`DELETE /v1/accounts/{id}/members/{userId}`. Shapes are transcribed
  from the service's handler, not from its OpenAPI document — see "Known gaps".
- `src/lib/accounts.ts` — React Query bindings for the tenancy surface. The token
  is part of every query key, and the overlapping invalidation sets live in one
  place. `retry: false` throughout: the screens each render an explicit retry,
  and a 401/403/404/409/410/422 is the service's answer rather than a hiccup.
- `/accounts` — the accounts you belong to, and the create form. The one
  conflict `POST /v1/accounts` declares (the derived handle is taken) is placed
  on the name field, because the handle is derived from the name.
- `/accounts/[accountId]` — facts, the member panel, rename, invite, leave and
  delete. A control is offered only when the service's role table permits it: an
  admin is offered neither a rename-forbidden nor an "invite another admin"
  option, and an owner is offered neither "leave" nor a usable "remove" on
  themselves, because the service will refuse both.
- `/invitations/[token]` — redeeming an invitation, with the three answers the
  service separates kept apart: 404 unrecognised, 410 no longer usable, 409
  already a member. It does not accept on load, because the token travels in the
  URL and an email preview or a link scanner would otherwise join somebody to a
  workspace they never opened. `robots: noindex, nofollow`, since a one-time
  token in a URL is a credential.
- `src/lib/money.ts` — integer minor units in, a price out. The currency's
  exponent is read from the platform's own data through `Intl`, so 1900 minor
  units is $19.00 in USD, ¥1,900 in JPY and 12.345 KWD is not 123.45. It is the
  only division in the codebase and the last one before a number reaches a person.
- `src/lib/billing.ts` — a typed client for the five billing endpoints the
  contract declares, with its own `BillingError` because billing is a separate
  service. `POST /v1/customers` sends an `Idempotency-Key`, which the contract
  asks the client to choose. Cursors are passed back verbatim and never parsed.
- `/billing/plans` — the plan catalogue, with real cursor paging that
  accumulates. It offers nothing to buy, and says in its framing sentence that
  billing does not record a current plan, because there is no
  `/v1/subscriptions` on master.
- `/billing/customers` — billing's customer records, labelled as the whole
  platform's list, because the service scopes this collection by nothing.
- `src/components/ui/state.tsx` — `LoadingState`, `ErrorState`, `EmptyState`,
  `Panel`, `RoleBadge` and `DescriptionList`. `Panel` takes a required
  `headingId`, because a region with no accessible name is a dead end in the
  landmarks list.
- `src/components/ui/select.tsx` — a native `<select>`, so the role picker gets
  keyboard behaviour and the right thing on a phone without a hand-rolled
  listbox. `Field` accepts it, so no call site hand-wires `aria-describedby`.
- Header navigation. The plan catalogue is offered to a signed-out visitor
  because it is the one screen that needs no account; the accounts list is not,
  because it would be a dead end.

### Known gaps

These are gaps in the *services*, found while building against them. Each one is
recorded so it is not rediscovered from a UI symptom.

- **A browser cannot call `identity` from this app: `identity` serves no CORS
  headers.** Measured on a running stack, and it is the first thing this
  repository's end-to-end tier found. The client bundle does the fetching
  (`src/lib/identity.ts`, base URL from `NEXT_PUBLIC_IDENTITY_URL`), so the
  caller is the user's browser on the app's origin; `identity/internal/` sets no
  `Access-Control-Allow-*` anywhere, and `OPTIONS /v1/session` answers `405`
  because the route implements `POST` and a preflight is not that. The preflight
  fails, the response is unreadable, and the sign-in form renders "Something
  went wrong. Try again." — on a stack that came up completely green and whose
  `/readyz` said `ok` on every service.

  377 unit tests cannot see it, and the reason is structural: every one of them
  injects a stub transport and never opens a socket, so the browser's
  same-origin policy is never in the path.

  Two fixes, both in other repositories, neither landed:
  `identity` could grow a CORS policy for the origins it is embedded in, or
  `parlor` could grow the same-origin BFF route `AGENTS.md` already schedules —
  the packet that also moves the session token out of `localStorage`. The
  end-to-end harness supplies the second shape with an nginx in front of the
  app and identity's `/v1` (`e2e/edge.conf`), because a tier that documents a
  bug instead of asserting it is not a tier. **DECISION NEEDED: which of the two
  owns it, and what the CORS allowlist is if it is the first.** Until one lands,
  this is a one-line change to `e2e/docker-compose.yml` away from being a real
  deployment failure rather than a test-harness note.

- **`identity/openapi/v1.yaml` does not describe the tenancy surface.** The
  document was last changed before the packet that added the implementation was
  merged, so `POST /v1/accounts` and its nine siblings exist in the service, in
  its routes and in its authorization tests, and not in the published contract.
  The client is written against the handler, which is the stricter authority, but
  it is the client half of a contract nobody has written down. A draft document
  exists on the `worker/identity-04-contract` branch; merging it is the fix.
- **A member list carries no member identity.** `membershipResponses` builds each
  row as `{Role: m.Role}` and `MemberSummary` carries no user id to copy, so
  `GET /v1/accounts/{id}/members` returns rows with an empty `user_id` and a
  zero `created_at` — and the per-member routes have nothing to address. The
  member panel says so and shows the role distribution, and the per-member
  controls render the moment an id is present.
- **billing declares no authentication.** `security: []`, no `securitySchemes`,
  and the service's own header records it as a gap: `GET /v1/customers` "returns
  every customer, because there is no account to scope it by". `/billing/customers`
  is therefore labelled as a platform-wide list rather than a personal one, and
  no identity session token is sent to billing.
- **No subscription surface exists.** billing's master contract has no
  `/v1/subscriptions*` and `Customer` has no plan field, so "you are on X",
  upgrade, downgrade, cancel and the five subscription states cannot be built.
  This is `parlor-04`, once billing-04's contract is merged.
- **No `GET /v1/invitations/{token}`.** An invitation cannot be read before it is
  redeemed, so the accept page cannot show which account the invitation is for,
  who sent it or what role it grants. It says so rather than implying it knows.
- **410 conflates two states.** The service maps both an expired invitation and
  an already-accepted one to 410 with the code `gone`, separated only by prose in
  `detail`. The accept page renders one state for both, which is all the status
  supports.

### Changed

- `src/lib/identity.ts` — a typed client for the four identity endpoints fixed by
  contract: `POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`,
  `GET /v1/me`. Base URL from `NEXT_PUBLIC_IDENTITY_URL`, defaulting to
  `http://localhost:8080`. The transport is a parameter, so tests inject a
  stub and the browser gets `fetch`; there is no msw and no request
  interception. Failures arrive as an `IdentityError` carrying the status, the
  reserved `code`, the `trace_id`, and the per-field `{field, code}` list from a
  422 — read from RFC 9457 problem+json, or from the `{error:{…}}` envelope the
  identity-02 brief describes, since the two disagree and neither has shipped.
- `src/lib/token-store.ts` — the session token in `localStorage` under
  `parlor.session.token`, with a subscribe hook for React. A value that does not
  parse reads as signed out rather than throwing.
- `src/lib/auth.tsx` — session state. The token is the React Query cache key
  (`["session", token]`), so a cached user can never be served to a different
  session than the one it was fetched for. A 401 forgets the token; a failure
  that is not a 401 leaves it and reads as signed out.
- `src/app/providers.tsx` — the provider stack (React Query, then auth),
  mounted once from `layout.tsx`. Both the identity client and the token store
  are injectable.
- `/register` — email and password, local validation before the request, and a
  422 placed on the field it belongs to. A 409 says the address is taken, which
  is the one place the answer is safe to give. On success the account is
  confirmed and the password leaves the screen; nothing signs anyone in, because
  `POST /v1/users` returns no token.
- `/login` — the same two fields, and one generic sentence for every refused
  sign in. A wrong password and an unknown address produce byte-identical
  output, and neither is reported on a field, so the screen cannot be used to
  find out who has an account. A service failure does not borrow that sentence:
  it says something went wrong rather than sending someone to reset a password
  that was fine.
- `src/components/shell/header.tsx` — the session-aware shell. Signed in: the
  address and a sign out control. Signed out: sign in and create account. While
  a stored token is being exchanged it renders neither, so a reload does not
  paint a sign-in link over a live session (verified against the prerendered
  HTML, which contains neither state).
- `src/components/ui/{button,input,field}.tsx` — hand-rolled primitives in
  shadcn's shape, one per file, exported from the existing barrel. `Field` owns
  the label/description/invalid wiring so a call site cannot get it half right.
  Every colour is a token from `src/styles/tokens.css`.
- `@tanstack/react-query` as a runtime dependency (the only one this packet
  adds).

### Changed

- `layout.tsx` mounts `Providers` and the shell header above the route content.
- `src/test/setup.ts` clears `localStorage` after every test. The token is read
  synchronously on render, and one test's session leaking into the next would
  make an auth suite pass for the wrong reason.

### Notes for the next packet

- The session token lives in `localStorage` because the cookie identity sets is
  `HttpOnly` and unreachable from the browser bundle. A BFF route in front of
  identity reverses this and makes the cookie the only authority. See README,
  "Sessions".
- No CORS headers, no cookie proxying, no CSRF token: the browser talks to
  identity directly, and that is a later packet.
