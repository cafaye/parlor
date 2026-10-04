# HANDOFF — parlor-e2e-protect-table-01: the e2e tier was red on a Postgres role that should exist

**Branch** `worker/e2e-protect-table-01` · **Base** `3e1d3b8` · **Three commits.**
Nothing pushed, nothing merged, no other worktree touched, `tests/validate-ci.sh`,
`gate.yml` and every floor untouched.

**State, in one paragraph.** The reported failure is **fixed and the tier now
runs**: 23 tests execute, 19 pass, 4 fail for two causes that have nothing to do
with the cluster and both of which predate this packet. The role the migration
asks for now exists, is a `LOGIN`, and the row-level-security boundary it exists
to enforce is **now actually enforcing** — measured, not inferred (§3). Two of the
four failures are a pre-existing defect in **identity** that this fix *unmasked*
(§4) and one is a pre-existing defect in **parlor's own router** (§5). Neither is
fixed here, and both are written up rather than patched, because one is a sibling
repository and the other is a change to a router's composition.

---

## 1. The reproduction, with the command and its actual output

The brief asked for the narrow question first: does `identity_app` exist, and is it
a `LOGIN`. A single Postgres container answered it, and then answered the whole
question.

**Step 1 — build the cluster exactly as `e2e/docker-compose.yml` described it.**
The block under test said `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB: identity`
and mounted nothing over `/docker-entrypoint-initdb.d`:

```
$ docker run -d --name repro-a -p 16991:5432 \
    -e POSTGRES_USER=identity -e POSTGRES_PASSWORD=identity -e POSTGRES_DB=identity \
    -v repro-a-data:/var/lib/postgresql/data postgres:17-alpine

$ docker exec repro-a psql -U identity -d identity \
    -t -A -c "select rolname||' canlogin='||rolcanlogin from pg_roles where rolname like 'identity%' order by 1;"
 identity canlogin=true
```

**One role, and it is the superuser the image made.** No `identity_app`, because
nothing in the fleet's provisioning had run.

**Step 2 — run the failing migration against it.** From `../identity`, which is
identity's own documented dev procedure (`migrations/README.md`, "Running
migrations"):

```
$ cd ../identity && goose -dir migrations postgres \
    "postgres://identity:identity@127.0.0.1:16991/identity?sslmode=disable" up
…
2026/10/05 00:57:00 OK   00015_recovery_tokens.sql (6.51ms)
2026/10/05 00:57:00 goose run: ERROR 00016_account_isolation.sql: failed to run SQL migration:
failed to execute SQL query "select cafaye.protect_table('account_users');": ERROR:
cafaye.protect_table(account_users, identity_app): identity_app is not a LOGIN role on this
cluster. (SQLSTATE 42704)
```

**Byte-identical to the CI log in the brief**, including the SQLSTATE and the fact
that `00008`–`00015` apply cleanly first. That last part is why the failure read as
a fault in `00016` rather than in the harness: fifteen green migrations, then a
42704.

**Step 3 — the same migrations against a cluster provisioned by kit's script.**

```
$ docker run -d --name repro-b -p 16992:5432 \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
    -e KIT_POSTGRES_DATABASES=identity \
    -v …/kit/templates/compose/postgres/initdb:/docker-entrypoint-initdb.d:ro \
    -v repro-b-data:/var/lib/postgresql/data postgres:17-alpine

$ docker logs repro-b | grep cluster
  [cluster] provisioning identity
  [cluster] done: 1 service database(s), an owner and a non-owner login role each,
             PUBLIC holds CONNECT on none of them

$ docker exec repro-b psql -U postgres -d postgres -t -A \
    -c "select rolname||'  canlogin='||rolcanlogin||'  super='||rolsuper from pg_roles where rolname like 'identity%';"
 identity      canlogin=true  super=false
 identity_app  canlogin=true  super=false

$ goose -dir migrations postgres "postgres://identity:postgres@127.0.0.1:16992/identity?sslmode=disable" up
… OK   00016_account_isolation.sql (20.82ms)
… OK   00017_credential_audit_dependencies.sql (2.84ms)
goose: successfully migrated database to version: 17
```

All seventeen. Both containers were removed and their volumes deleted afterwards;
`docker volume ls | grep repro` returns nothing.

**Step 4 — the whole stack, through the repository's own harness** (`./bin/e2e-stack up`,
then `./bin/e2e`, both unmodified):

```
[e2e] the cluster's init script is present: …/kit/templates/compose/postgres/initdb
[e2e] applying identity's migrations (../identity/migrations) as identity
… OK   00016_account_isolation.sql (45.06ms)
[e2e] migrations applied in 1s
[e2e]   identity ready after 0s (1 polls) — http://127.0.0.1:16080/readyz
[e2e] the whole stack is ready
…
  4 failed
  19 passed (54.7s)
[e2e] the tier ran: 19 passed, 4 failed, 0 skipped, 0 retried
```

**The tier runs tests for the first time.** Before this change it never got past
`migrate`. The four failures are §4 and §5, and neither is a cluster problem.

---

## 2. Which of the three candidates it is, and the measurement that decided it

**Candidate 1 — `parlor`'s compose. That is the answer**, decided by the census in
§1 step 1: on the arrangement the file described, `pg_roles` held **one** role and
`identity_app` was not among them. The cluster was never told to create it.

Candidates 2 and 3 were ruled out by measurement rather than by reading:

**Not kit's `10-cluster.sh`.** It ran, and it did exactly what its own header
promises. Its output is in §1 step 3 — `provisioning identity`, one owner, one
non-owner login, and the closing `REVOKE` sweep. Nothing in it stopped it running
and nothing in it ran late: the roles existed **before** `goose up`, which is the
ordering `protect_table` needs, and step 3 applied all seventeen migrations on the
first pass. A cluster script that had run too late could not produce a 42704 about
a role that does not exist *yet*.

**Not the migration.** `00016_account_isolation.sql` is **identity's**, not
gateway's — the brief's attribution is wrong, and it is worth correcting because it
would have sent the fix to the wrong repository. `gateway/` has no `migrations`
directory at all:

```
$ ls ../identity/migrations/ | tail -4
00016_account_isolation.sql
00017_credential_audit_dependencies.sql
README.md
$ ls ../gateway/migrations/ 2>&1
(no such directory or answer)
```

And the migration is not asking for a role scoped to a different database. Its own
header names the five tables it protects — `account_users`,
`account_invitations`, `oidc_clients`, `api_keys`, `account_audit_log` — all of
which are identity's, and it defaults its login role to `current_user || '_app'`.
`identity_app` belongs to the **same cluster** as `identity` and is not
database-scoped; the brief's third candidate does not describe a real arrangement.

**The one thing that made `00016` look guilty**, and it is worth recording because
it is the general shape of this defect: it is the first migration in that directory
to call `cafaye.protect_table`. Nothing about it is different in kind from
`00006_account_users.sql`, which creates the table it goes on to protect. It is
simply the first to *ask for the role*.

**And the reason the whole thing was invisible until CI.** `identity`'s own
compose has mounted kit's script for a long time, so a laptop takes the production
path and nobody sees the gap. `identity` hit the identical error in its own CI and
fixed it there (`identity/CHANGELOG.md`, packet `registry-identity-down-05`,
`identity/REPORT-registry-identity-down-05.md:50` carries this exact message) —
because **its** CI used a bare `postgres:17-alpine` *service container* with no
init script. This repository's tier had the same defect one level down, in a
compose file rather than a workflow, and it is the same fix in both places: mount
the script.

---

## 3. The fix, and why it is a fix rather than a suppression

Four files. **`e2e/docker-compose.yml`** — mount kit's initdb directory over
`/docker-entrypoint-initdb.d`, `POSTGRES_USER`/`POSTGRES_DB` become `postgres`,
`POSTGRES_PASSWORD` becomes `postgres`, `KIT_POSTGRES_DATABASES: identity`, and
identity's `DATABASE_URL` carries that password. **`bin/e2e-stack`** — the migrate
DSN follows the password, and a new `check_cluster_initdb`. **`.github/workflows/e2e.yml`**
— a fourth checkout for `cafaye/kit`, and an assertion for it.
**`AGENTS.md`** — what the tier now requires and why.

### Why `POSTGRES_USER` had to change, not just the mount

The image creates `POSTGRES_USER` as a **superuser before initdb runs**, and kit's
script then does `CREATE ROLE <name>` for every name in `KIT_POSTGRES_DATABASES`.
Leaving `POSTGRES_USER: identity` would have found the role already there:

```
ERROR:  role "identity" already exists
initdb: /docker-entrypoint-initdb.d/10-cluster.sh: …: exit 3
```

Measured by putting the mount back with the old `POSTGRES_USER` — the container
exits during initdb and never opens a socket. `postgres` is the one role name that
is not in `KIT_POSTGRES_DATABASES`, which is what makes it the one name available
to be the cluster's administrator.

### The part that matters: this changed what `identity` IS

This is the security-relevant half and it was not in the brief.

Before, `identity` was a **superuser**. kit's script creates it `NOSUPERUSER
NOCREATEDB NOCREATEROLE NOREPLICATION`. **A superuser bypasses row-level security
entirely**, so the old arrangement had the policies and **no enforcement** — which
is the same defect as having no policies, and harder to notice because
`relrowsecurity` and `relforcerowsecurity` both read `true` in the catalog.

Measured on the tier's own running cluster (`./bin/e2e-stack host-port
identity-postgres` → 16001):

```
   rolname    | rolcanlogin | rolsuper | rolcreatedb | rolcreaterole
--------------+-------------+----------+-------------+---------------
 identity     | t           | f        | f           | f
 identity_app | t           | f        | f           | f
 postgres     | t           | t        | t           | t

       relname       | rls | force
---------------------+-----+-------
 account_audit_log   | t   | t
 account_invitations | t   | t
 account_users       | t   | t
 api_keys            | t   | t
 oidc_clients        | t   | t

 datname  | public_connect | identity_connect
----------+----------------+------------------
 identity | f              | t
 postgres | f              | f
```

`identity` is no longer a superuser. `PUBLIC` holds no `CONNECT` on any database.
`FORCE` is set, so the owner is subject to its own policies.

### The boundary, measured — and how two of the measurements were made wrong first

Seed two accounts with one membership each, then read as the **owner** (over TCP as
`identity`, so the role is real and not a superuser bypassing everything):

```
  owner as A, all rows: 1 of 2
  owner as B, all rows: 1 of 2
  owner,     no identity: 0 of 2
  owner as B, asks for A:  0 of 2
  login (identity_app), no identity: 0 of 2
  login as B, asks for A: 0 of 2      login as B, asks for B: 1 of 2
```

Each account sees its own membership and not the other's; no identity means no
rows; and the login role cannot alter the arrangement:

```
$ psql -U identity_app -d identity -c "alter table account_users disable row level security;"
ERROR:  must be owner of table account_users
$ psql -U identity_app -d identity -c "drop policy account_users_cafaye_select on account_users;"
ERROR:  must be owner of relation account_users
$ psql -U identity_app -d postgres -c "select 1;"
FATAL:  permission denied for database "postgres"
DETAIL:  User does not have CONNECT privilege.
```

**Two of those numbers were wrong before they were right, and both wrongnesses
looked exactly like a passing result.** Recording them because a boundary that
cannot fail is not a boundary:

1. The first seed used `docker exec` **without `-i`**, so stdin never arrived.
   Nothing was inserted. The read that followed reported `0 of 2` — a perfect
   boundary result — because **there was nothing to deny**. It was verified
   afterwards by a `postgres`-superuser census, which bypasses RLS and showed the
   table empty.
2. The first owner pass was measured as `postgres`, which is a **superuser and
   bypasses RLS**. It reported `owner as A: 2 of 2` and `owner as B: 2 of 2` — every
   account seeing every row, i.e. the boundary absent. Re-measured over TCP as
   `identity` the same query returns 1 of 2.

A second seed then failed on `account_users_user_id_fkey` (a membership needs a
`users` row) and again the read reported zeros. Every number above is quoted
against a census of what exists, and the census is what caught both.

### Why this is not a suppression

The three available suppressions each disable the thing this tier exists to test,
and all three were rejected on that ground rather than on taste:

- **Pass an explicit login role, or skip the `protect_table` call in `00016`** —
  makes the migration succeed without the policies. The suite goes green with the
  RLS boundary absent, which is precisely the failure the shared-cluster work
  (`6173f32`, `c00406f` in `site`) was done to make detectable.
- **Catch the exception in a `DO` block** — same outcome, quieter: the migration
  reports success and leaves four of five tables ungoverned.
- **Create `identity_app` from a hand-written initdb in `e2e/`** — a copy of a
  script this repository does not own, which is a second opinion about the
  isolation contract and stops being true silently the moment kit's changes. This
  is also the shape `site` deleted (`e2e/postgres-initdb/`, deleted there for the
  same reason: it would have created the role twice and taken the cluster down at
  initdb).

Provisioning the role the fleet contract already specifies is the only one of the
four that leaves the boundary **standing and enforced** — which is what §3
measures, and what the run in §4 then exercised for real.

### `../kit` is now required, and it is not a sibling

Nothing is built from it, nothing is pushed from it, and it is **not** in
`SIBLING_SERVICES` — adding it there would send `publish_siblings` to its `*)` arm
with `no build recipe for sibling kit` on the default path, in CI.

It is required because of the bind mount, and Docker mounting a **missing bind
source as an empty directory** is what makes that requirement silent: initdb runs
no script, the cluster comes up with the superuser and nothing else, `pg_isready`
says healthy, and the failure surfaces sixty seconds later as a 42704 about a
*role*. So it is asserted in two places that would otherwise look redundant — the
job's presence step, and `bin/e2e-stack`'s preflight, which **reads the mount out
of the compose document** so the two cannot drift into disagreeing about where the
script lives.

`check_cluster_initdb` is deliberately **not** folded into the sibling preflight.
A missing `../identity` is caught by `docker build` naming a path that is not
there; a missing `../kit` is caught by nothing at all, which is the entire reason
the function exists. All four of its branches were run against a real compose
document, and each fails naming its own cause:

| case | exit | message names |
|---|---|---|
| kit present | 0 | `the cluster's init script is present: …/kit/…/initdb` |
| bind source absent | 1 | the source, and that it is a `../kit` checkout |
| directory present but empty | 1 | that it was *created* rather than found |
| mount removed from the file | 1 | that nothing will provision the cluster, and that `00016` will then fail at `protect_table` |

---

## 4. Found, and NOT fixed: two e2e failures this change unmasked

**This is the honest cost of the fix and it belongs here rather than in a footnote.**
The tier could not run before, so nothing downstream of `migrate` had been
exercised. Fixing the cluster ran 23 tests for the first time and two of them fail
on a **real defect in `identity` that the superuser had been hiding.**

`ListMine` — the query behind `GET /v1/accounts` and therefore behind the
`/accounts` screen — reads `account_users` through a **bare pool**, not through
`TxRunner`:

```go
// identity/internal/accounts/service.go:259
func (s *Service) ListMine(ctx context.Context, userID id.UUID) ([]MemberSummary, error) {
	…
	return s.store.ListForUser(ctx, s.read.Queryer(), userID)
}
```

`Direct.Queryer()` returns the **pool** (`identity/internal/platform/db/tx.go:35`),
and `TxRunner.Do` is the thing that calls `cafaye.begin_account`. So this read
runs with **no account identity set** — and `protect_table`'s policy is
`account_id = (select cafaye.current_account_id())`, which is false for NULL. With
`FORCE` in place and `identity` no longer a superuser, the answer is **zero rows**.

Reproduced by hand, against the running tier, through the tier's own edge:

```
$ curl -X POST http://127.0.0.1:16000/v1/users -d '{"email":"rlstest-…@example.test","password":"…"}'
status=201

$ psql -U postgres -d identity -c "select u.email, a.name, a.personal, au.role
    from account_users au join accounts a on a.id=au.account_id join users u on u.id=au.user_id
    where u.email='rlstest-…@example.test';"
              email              |        name        | personal | role
---------------------------------+---------------------+----------+-------
 rlstest-1791154055@example.test | rlstest-1791154055 | t        | owner
(1 row)

$ psql -U identity -d identity -c "select count(*) from account_users au
    join accounts a on a.id=au.account_id where au.user_id=(select id from users where email='…');"
 visible_without_identity
--------------------------
                        0

$ psql -U identity -d identity -c "begin; select cafaye.begin_account('<its own account>');
    select a.name, au.role from account_users au join accounts a on a.id=au.account_id
    where au.user_id=(select id from users where email='…'); commit;"
        name        | role
--------------------+------
 rlstest-1791154055 | owner
(1 row)
```

**Registration works. The account and the owner membership are both created, and
the row is readable the moment an account identity exists.** What is broken is a
read with no identity, on a table the substrate protects — which is `identity`'s
defect, in `identity`'s repository, and this packet may not edit it.

The two failing tests are `session.e2e.spec.ts:150` ("the session survives a page
load…", `toHaveCount(1)` → received 0) and `design-system.e2e.spec.ts:399` (same
`"Your accounts"` list, `element(s) not found`).

**Why it was invisible, and why that is not an argument for the old shape.**
`identity`'s own CI also uses `POSTGRES_USER: identity` on a bare service container
(`identity/.github/workflows/ci.yml:216`), so `identity` is a **superuser** there
and RLS is bypassed in identity's 1732 database-tier tests too. The defect is
real in both repositories and the superuser was hiding it in both. This is the
argument for the fix rather than against it: a tier that cannot fail when the
isolation is absent is a tier whose green means nothing. **DECISION NEEDED** for
whoever owns `identity`: the honest repair is a `begin_account` on this read path
(a transaction, or the credential-style resolution `00016` already uses for
`api_keys`), and it needs an owner of that repository.

---

## 5. Found, and NOT fixed: `/verify-email/confirm` serves the wrong screen

The other two failures are **parlor's own**, pre-existing, and unrelated to the
database.

```
Error: expect(locator).toBeVisible() failed
Locator: getByRole('button', { name: 'Verify my email' })
… element(s) not found
```

Both screens share the `<h1>Verify your email</h1>`, which is why the rendered page
reads plausibly in a snapshot, so the distinguishing paragraph is the evidence:

```
$ curl -s "http://127.0.0.1:16000/verify-email/confirm?token=abc" | grep -o "Tell us the address[^<]*\|Confirming your address[^<]*"
Tell us the address on the account and we will send a link to verify it.
```

That is the **index** screen's paragraph. The confirm screen renders
`Confirming your address does not change your password or sign you out.` So
`/verify-email/confirm` is served the index screen's body.

**Cause, confirmed rather than inferred:** `src/routes/verify-email.tsx` declares
`component: VerifyEmail` and renders **no `<Outlet />`**, and the generated tree
nests the child under it:

```js
const VerifyEmailConfirmRoute = VerifyEmailConfirmRouteImport.update({
  id: '/confirm', path: '/confirm', getParentRoute: () => VerifyEmailRoute,
} as any)
```

A child route whose parent has a component and no `Outlet` never renders.

**It is pre-existing and this packet did not cause it.** The route tree arrived in
`9701cbf`; `git log --all -S Outlet -- src/routes/verify-email.tsx` has **no
commits** — no version of that file ever rendered an `Outlet`; and
`git diff --name-only origin/master -- src/` is **empty**, so this change touched no
file under `src/`.

Not fixed here on purpose: it is a change to a router's composition, it belongs to
whoever owns the screens, and it is unrelated to the cluster. Two tests:
`email-verification.e2e.spec.ts:129` and `:163`.

---

## 6. Also found

- **`identity`'s `DATABASE_URL` names the owner, not `identity_app`** — the process
  serving the browser holds the one privilege the substrate exists to remove, and
  could `ALTER TABLE … DISABLE ROW LEVEL SECURITY`. What `FORCE` still buys is real
  and measured (§3: owner as A sees 1 of 2, owner as B sees 1 of 2). The residual
  gap needs a change in **identity's** repository. **DECISION NEEDED.**
- **`tests/validate-ci.sh` greps all of `e2e/` for `test.skip`, so Playwright's own
  `e2e/.artifacts/` output from a failing run turns the NEXT run's gate red.** It
  reported `FAIL the end-to-end tier has no skip mechanism`, citing
  `e2e/.artifacts/…/error-context.md:84` — a line of prose in the spec's own header
  that the grep read out of a *copy* of it. The gate is right about its subject and
  wrong about this directory. `rm -rf e2e/.artifacts` restored 47/47. The fix is a
  `.gitignore` entry or a narrower grep, and it belongs to whoever owns that file —
  which this packet was told not to touch.
- **`BILLING_URL` names a service that is not in the stack** (`e2e/docker-compose.yml`,
  `http://billing:3000`). Carried forward from the sibling-checkouts packet and
  still true; the billing screens' behaviour when billing is absent is not this
  repository's decision.

---

## 7. What a run must still settle

1. **Whether `identity` should connect as `identity_app`.** DECISION NEEDED, in
   `identity`. This is the difference between "the policies hold" and "the
   application cannot remove the policies". §3 measures what holds today.
2. **Whether `ListMine` is repaired, and how.** DECISION NEEDED, in `identity`. It
   is the one of the four failures that is a real boundary-adjacent defect rather
   than a screen-composition defect (§4). Until it is, `/accounts` is empty for a
   person who registered, and two e2e tests say so.
3. **`/verify-email/confirm`'s missing `<Outlet />`.** §5. parlor's own, cheap, and
   untaken deliberately.
4. **A clean full-stack CI run.** The run in §1 step 4 was on this machine with
   `E2E_BUILD_SIBLINGS` unset, so it built `identity` and `gateway` from the local
   checkouts and pushed them — it tested **working trees**, not the published `:e2e`
   artifacts. CI checks out the same three repositories at `master`, so the
   sibling images will differ, and a red that only CI produces is exactly what this
   tier exists to find.
5. **A run where `kit` is genuinely absent.** `check_cluster_initdb`'s absent and
   empty branches were exercised by pointing the mount at paths that do not exist
   and at an empty directory, which is the same condition Docker produces — but a
   real checkout-less runner has not been observed. The two assertions should be
   redundant by design: the job catches it in CI, the preflight catches it on a
   laptop before four minutes of building.
6. **Whether the `2 failed / 19 passed` count is the whole story.** 23 tests ran with
   0 skipped and 0 retried, and both readers of the report agree on the floor of 2,
   so the tier is not green-over-nothing. But "19 passed" is a count against a
   suite that has never run before, so it is a baseline rather than a result.

## 8. Reproducing this

```sh
npm ci                                  # the tier's browser step needs it; without
                                        # it `npx playwright` cannot resolve @playwright/test
./bin/e2e-stack publish-siblings       # seeds the registry, or ./bin/e2e does it
./bin/e2e                               # up, suite, report, down
```

`../identity`, `../gateway` and `../kit` must all be checked out beside the
repository. `goose` must be on `PATH` (`identity`'s documented install).
