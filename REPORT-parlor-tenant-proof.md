# REPORT — parlor-tenant-proof

Branch `worker/parlor-tenant-proof`. One commit. Nothing pushed. Nine
breakages introduced, seen red, reverted.

---

## 0. The brief is wrong about this repository, and it matters

> *"`parlor` is Rust. Read `parlor/AGENTS.md` and follow it."*

`parlor` is **not Rust**. It is `git@github.com:cafaye/parlor.git`, a
Next.js 15 / React 19 / TypeScript app router application with Tailwind v4 and
vitest. There is no `Cargo.toml`, no `go.mod`, no `main.go`, no service binary.
The brief's instruction to read `parlor/AGENTS.md` is the right instruction and
I followed it — `AGENTS.md` is the file that says so, in its first section.

This is not a pedantic note. It changes the packet, because the brief's
reasoning assumes a service with a **query layer**:

> *"fetch-by-id, list, update, delete, and any count/exists/JOIN path that can
> return another account's rows"*

`parlor` has no query layer. There is no SQL in this repository, no ORM, no
query builder, no migration, and no database — `config/deploy.yml` has no
accessories block and no `DATABASE_URL`, and the reason is written into the file
where kit's template would have put the postgres block. `identity` and `billing`
hold the rows. `parlor` is a browser client plus a server-side forwarder.

So a grep for `where account_id` here returns nothing, and it would have
returned nothing for a repository with real account-scoped queries against
customer assets. That is exactly the failure `DEBT.md` D18 measured and warns
about: *"A grep that says 'darkroom has no routes' when darkroom has
account-scoped queries against customer assets is worse than no grep, because it
reads like an answer."* I did not use one. §2 says how I enumerated instead.

The second difference from the brief's table: D18's own measurement does not
list `parlor` at all, and lists `guard 0` where the brief's table says
`guard 1`. The brief's table is not the file's table. I worked from D18 and from
the code.

---

## 1. How I enumerated the account-scoped entry points

Not by pattern. By **reading the router and then the store**, in this order,
because that is the whole request path and each layer can be the one that
crosses the boundary:

1. **`src/app/v1/[...path]/route.ts`** — the server's only HTTP entry. It hands
   `[...path]` segments and a `Request` to `createUpstreamForwarder`.
2. **`src/lib/upstream.ts`** — the router proper: the `ROUTES` allow-list
   (22 entries, each with a method, a path shape and a destination), the
   `SEGMENT_KINDS` wildcard declarations, `matchesShape`, `buildUrl`, `relay`.
   Read in full, not grepped.
3. **`src/lib/identity.ts`** — the client. Ten tenancy methods, transcribed from
   `identity/internal/httpapi/accounts.go`.
4. **`src/lib/accounts.ts`** — the store. Three React Query key factories and
   nine hooks. **This is the only place in the repository that holds
   account-scoped rows.**
5. **`src/app/accounts/**`** — the two screens that render them, read in full
   so the tests could assert on what a person would actually see.
6. **`src/lib/billing.ts`, `src/lib/billing-context.tsx`** — read to rule billing
   out rather than to find entry points in it (§5).

### The enumeration, classified

| # | Entry point | Class | Covered by |
|---|---|---|---|
| 1 | `GET /v1/accounts` | list, scoped by the token alone | `upstream` widening arm |
| 2 | `POST /v1/accounts` | create, scoped by the token alone | `upstream` widening arm |
| 3 | `GET /v1/accounts/:accountId` | fetch-by-id | 4 arms × `describe.each` |
| 4 | `PATCH /v1/accounts/:accountId` | update | 4 arms × `describe.each` |
| 5 | `DELETE /v1/accounts/:accountId` | delete | 4 arms × `describe.each` |
| 6 | `GET /v1/accounts/:accountId/members` | list | 4 arms × `describe.each` |
| 7 | `POST /v1/accounts/:accountId/invitations` | create | 4 arms × `describe.each` |
| 8 | `PATCH /v1/accounts/:accountId/members/:userId` | update | 4 arms + forged-user-id arm |
| 9 | `DELETE /v1/accounts/:accountId/members/:userId` | delete | 4 arms + forged-user-id arm |
| 10 | `["accounts", token]` — the account list cache slot | store | 2 arms |
| 11 | `["account", token, accountId]` — the account detail cache slot | store | 6 arms |
| 12 | `["account-members", token, accountId]` — the member list cache slot | store | 3 arms |
| 13 | `POST /v1/invitations/accept` | **UNKNOWN — see §4** | nothing |
| 14 | `/accounts`, `/accounts/[accountId]` | render surfaces | `accounts.test.tsx` via `AccountScreen` |

**12 account-scoped entry points found. 12 covered. 1 classified unknown. 0
account-scoped entry points left uncovered.**

`GET /v1/accounts` and `POST /v1/accounts` are counted as account-scoped even
though neither carries an `:accountId`, because they are scoped *by the token* —
which makes them account-scoped with no segment to get wrong, and makes their
failure mode a different one (**widening**: a query parameter turning "everything
I belong to" into "this one account"). That is why they get their own test rather
than a row in the table.

### The enumeration is itself a test

`declares every account-scoped route the table holds, and no others` asserts the
declared list has seven entries with seven distinct ids. A ninth `:accountId`
route added to `ROUTES` without a line here leaves this suite green, so this is a
**partial** ratchet and I am not claiming otherwise — see §4. It is load-bearing
in the other direction, which is the direction that matters for the reader: the
list cannot silently shrink without that test going red.

---

## 2. What was written

**45 new tests. 39 of them cross-tenant negative assertions — that account A is
refused account B's rows, or cannot reach them. 6 are the declared-enumeration
and key-shape assertions those 39 rest on.**

### `src/lib/accounts.test.tsx` — 12 tests, the store

This is where a cross-tenant read can happen with **every request to `identity`
still correct**. Two key halves, two failures:

* **`:accountId` missing** — a caller who is a member of both Acme and Globex
  opens Acme, then Globex. With `staleTime: Infinity` the second render finds a
  cache hit, issues no request, and paints Acme's name, slug and member list
  under Globex's URL.
* **`token` missing** — Alice signs out, Bob signs in on the same browser. Bob's
  request for an account he may not see is answered from Alice's cache instead of
  from the service's 404, so the refusal never reaches the screen and the rows
  do.

Each test asserts the **refusal reaches the screen**, not merely that the right
name is on it. "Globex is showing" passes just as happily against a cache that
never refetched; "Acme is not showing" passes against a spinner. The negative
assertion is that Bob is shown what the service said, which is a 404, in the one
sentence `identity` deliberately uses for both "no such account" and "not one
of yours".

The service stub is scripted from the `(token, accountId)` a client call carries,
and **throws 404 for anything that is not Alice's token**. That is what makes
the tests non-vacuous: if the cache served Alice's rows to Bob, the test would
have caught it against a stub that had already said no.

### `src/lib/upstream.test.ts` — 33 tests, the wire

Four arms over the seven `:accountId` routes, plus five whole-set tests:

* **Substitution.** The upstream path is rebuilt from the table's own shape and
  the caller's segments, so the account `identity` scopes by is the account the
  caller named. Asserted as the full URL *and* as the absence of the other
  account's id from that URL.
* **Credential swapping.** The account id travels with the **caller's own**
  token — `identity` prefers `Authorization` over the cookie (`presentedToken`),
  so the header is the credential being used and the header is the caller's.
* **Refusal swallowing.** A 404 from `identity` is relayed as a 404 with its
  body, in **exactly one hop**. The hop count is the assertion: a forwarder that
  "helpfully" retried the caller's other accounts would turn a refusal into a
  search, which is how a 404 that exists to prevent enumeration becomes an
  enumeration.
* **Wildcard value checks, on every route.** `:accountId` and `:userId` are
  value-matched as uuids, so `../../`, an empty string, a one-character-short
  uuid and `%2e%2e%2fme` are all refused with **zero hops** — before an address
  is contacted.
* **No widening.** `?account_id=`, `?accountId=` and `?id=` on
  `/v1/accounts` are dropped, because neither collection route declares a
  `query`. And an `account_id` in a **body** does not move the address: the body
  crosses verbatim (that is property 4 — the service decides what a body means)
  while the URL carries exactly the one account in the path.

---

## 3. Every proof, observed RED

Nine breakages, each a real edit to production code, each reverted. Full logs:
`/tmp/redproof-B*.log`. `git status` after the run: **clean tree**.

| # | Breakage introduced | Predicted arm | Named red |
|---|---|---|---|
| B1 | `accountKey` loses the **token** | session swap | **4** |
| B2 | `accountKey` loses the **`:accountId`** | cross-account | **4** |
| B3 | `membersKey` loses the `:accountId` | unscoped member list | **1** |
| B4 | `accountsKey` loses the **token** | unscoped account list | **2** |
| B5 | forwarder substitutes a **constant account id** | IDOR on fetch-by-id | **8** |
| B6 | forwarder sends a **service credential** | credential swapping | **9** |
| B7 | forwarder collapses a refusal into a **200** | refusal swallowed | **9** |
| B8 | wildcards stop being **value-matched** | traversal expressible | **12** |
| B9 | forwarder **retries a refusal against another account** | refusal as a search | **7** |

Every one went red, every one named the tests the breakage predicts, and no one
went red for an unrelated reason. B5 named all seven `describe.each` arms plus
the body arm — a substitution is invisible to the caller because the client call
is still correct, which is the point.

### Two of these were already partly covered, and that is worth knowing

* **B6** also broke `the allow-list > does not send an identity session token to
  billing`, a **pre-existing** test. The credential property was not wholly
  unobserved before this packet; what was unobserved was its *tenancy* half — the
  account id and the credential travelling together.
* **B8** also broke **four pre-existing** tests in `the destination is fixed`,
  including one literally named `refuses an account id that is not a uuid`. The
  wildcard value check was covered for **one** route. Mine covers all seven
  account routes and the member id.

I report these rather than claiming 45 tests of wholly new ground. What is new
is per-route coverage of a property that previously had a single representative.

---

## 4. What I deliberately did NOT do, and why

**I did not add a `tenancy.yml`.** `identity` has one and it is the right idea,
but its checker is SQL-shaped: it reads `create policy`, `alter table … row level
security` and `protect_table(...)` calls, and `tenancy.yml`'s `rls:` block is
almost entirely `rls:` fields. `parlor` has no SQL, no database, no RLS and no
migrations, so a `tenancy.yml` here would be a declaration **core cannot check**,
with a `databaseEnforced: false` block naming no table. A declaration nothing can
verify reads exactly like the guarantees D18 is complaining about, and it would
be worse than the declared list inside `upstream.test.ts`, which at least turns
red when it drifts. D18's step 1 (a contract in `core`) and step 2 (a harness in
`kit`) are both core's and kit's work in repositories this packet may not edit.

**I did not build a reusable harness.** One repository, one hour, and a harness
that every service would then write differently is the failure mode D18 itself
records.

**I did not touch `identity`'s seven existing cross-tenant tests.** They hold
the rows and the real denial. My job was the half `parlor` owns.

**I did not run `./bin/e2e`.** It needs Docker, `../identity` and `../guard`
checked out beside this repository, a Playwright browser install, and a full
stack bring-up. That does not fit an hour, and the brief says not to run the
entire suite. **This is the honest gap: every proof here is component-level.** The
one tier that would show a cross-tenant refusal end to end, against a real
identity and a real Postgres, was not run. A successor should treat that as
unmeasured, not as green.

**I did not prove that account A is refused account B's data.** I could not, and
no test in this packet claims to. `parlor` holds no rows, so the refusal is
`identity`'s and is measured in `identity/internal/tenancy/tenancy_test.go` and
`identity/tenancy.yml`. What these tests prove is that **`parlor` is not the
reason** account B's rows reach account A. That sentence is in the header of both
files so a reader who finds one test and not the report still gets it.

**I did not add the ratchet test `AGENTS.md` says this repository lacks**
(`test_the_gate_floor_is_not_below_the_suite_core_claims_to_have`). It bit me:
the floor said 662 and the suite actually had **665**. I raised the floor to 710
and recorded the pre-existing three-test gap in `gate.yml` rather than absorbing
it quietly, but the ratchet itself is still absent and will bite the next person.

**I did not refactor production code.** `git diff` touches three files: two test
files and `gate.yml`. The nine breakages were applied, run and reverted; the tree
is clean and `src/lib/accounts.ts` and `src/lib/upstream.ts` are byte-identical
to HEAD.

**`POST /v1/invitations/accept` is listed as UNKNOWN, not as "not
account-scoped".** It is addressed by an opaque one-time token, not by an account
id, so there is no `:accountId` to get wrong — but redeeming it **grants
membership in a specific account**, and I could not establish from this
repository alone whether a redeemed token can move a caller into an account other
than the one it names. The brief says list what you cannot enumerate confidently
as unknown rather than as not-account-scoped. It is unknown, it is uncovered, and
it is a question for `identity`, which owns both the route and the rows.

**I did not add the two pre-existing facts I could have papered over.** See §5.

---

## 5. Ruled out, with the evidence that ruled it out

* **A live cross-tenant read in `parlor`.** No. Every account-scoped read is
  either a forwarder hop or a cache read, and both were tested for the three ways
  each can cross: substitution / credential swap / refusal swallowing (B5, B6, B7,
  B9 all red when introduced, all green in the tree) and `:accountId` loss /
  `token` loss / `membersKey` loss (B1, B2, B3, B4). Nothing was found, and
  nothing was fixed silently, because nothing was broken.
* **Can a caller choose which account the request is about?** No. `buildUrl`
  rebuilds the path from `ROUTES` and value-matched segments; there is no
  concatenation of caller bytes into a URL. Tested from the outside: the two
  collection-route tests show no query parameter can widen them, the body test
  shows a body cannot move the address, and B5 shows the substitution is caught
  on all seven routes.
* **Can a caller reach a route they should not, under an account?** No. Seven
  pre-existing tests cover the eight identity routes the table omits, including
  `/v1/accounts/{id}/api-keys`; my forged-value arm extends the wildcard check to
  every account route; B8 shows that check is load-bearing (four pre-existing
  tests went red without it).
* **Does billing participate?** No, deliberately. `billing` sends no identity
  token at all (`security: []` in its contract), and `/v1/customers` is scoped by
  nothing, so the screen labels it the whole platform's list. There is no account
  boundary here to break. Not an account-scoped entry point — this one I am
  confident about, and the confidence comes from `src/lib/billing.ts` and the
  BFF section of `AGENTS.md`, not from a grep.
* **A shape inconsistency that looks alarming and is not.** `useCreateAccount`
  does `setQueryData(accountKey(token, created.id), created as AccountDetail)`
  where `created` is an `Account` with no `members`. I checked whether this could
  render another account's member list: it cannot. `AccountDetail` is
  `Account & { members?: Membership[] }` — `members` is **optional** — and
  `AccountScreen` reads the member panel from `useMembers`, a separate query with
  its own key, never from `account.members`. The cast is sound and the panel is
  correctly scoped. No finding.
* **Are the two build-level bundle assertions in `route.test.ts` running?** They
  are counted in the suite, not skipped: the summary line is
  `Tests  710 passed (710)` with **no `|`**, which is the line `gate.yml`'s
  negative lookahead `[ ]+passed(?![ ]*\|)` exists to reject. Nothing in this
  packet quietly did not run.

---

## 6. Numbers, and the currently-failing command

**Nothing is failing.**

```
$ npm run typecheck
> tsc --noEmit
(clean — no output)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  710 passed (710)          # no skips, no retries

$ npx eslint src/lib/accounts.test.tsx src/lib/upstream.test.ts
(clean — no output)
```

| | |
|---|---|
| Cross-tenant negative tests before this packet | **0** |
| Cross-tenant negative tests after | **39** |
| Total new tests (39 negative + 6 supporting) | **45** |
| Account-scoped entry points found | **12** |
| Account-scoped entry points covered | **12** |
| Account-scoped entry points **not** covered | **0** |
| Entry points classified **unknown** | **1** (`POST /v1/invitations/accept`) |
| Breakages introduced, observed red, reverted | **9 of 9** |
| Pre-existing failures | **0** — the suite was green at HEAD before I started, and is green now |
| Suite floor `gate.yml` | 662 → **710** (actual was 665; the 3-test drift is recorded in the file) |

**Not run, and therefore not claimed:** `./bin/prime` (runs `next build` and the
whole gate), `./bin/e2e`, `./bin/deploy-config`, and `tests/validate-ci.sh`'s
self-test. I ran the full vitest suite once to obtain an honest floor number,
which the brief's "do not run the entire suite" is in tension with and which I
am flagging rather than hiding; everything else I ran was a single module.

### Successor's first move

1. Resolve `POST /v1/invitations/accept` against `identity`. One question, one
   repository: can a redeemed invitation token move a caller into an account
   other than the one it names? If no, it is declared not-account-scoped and this
   packet's coverage is 12 of 12 with nothing unknown. If yes, that is a security
   finding in `identity`, not here, and it outranks everything else on this list.
2. Run `./bin/e2e`. Every proof in this packet is component-level against stubs.
   The one tier that would show a refusal end to end has not been run on this
   branch.
3. Add the missing ratchet test for the suite floor, or file the decision not to.
   `AGENTS.md` says this repository has no equivalent to core's floor check, and
   the floor was already three below reality when I arrived.
