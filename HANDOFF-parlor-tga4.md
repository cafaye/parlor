# HANDOFF — TG-A4 / parlor tenancy declaration

`tenancy/parlor-tga4`. Two commits, nothing pushed, nothing merged.
Working tree clean at exit.

```
bash /Users/kaka/Code/any/moon/cafaye/core/harness/bin/tenancy-check .
  ->  OK .../parlor-tga4: 0 failure(s), 2 warning(s) — exit 0
```

The declaration is `tenancy.yml` at the root; the ratchet is
`src/test/tenancy-declaration.test.ts`. Both are green, both are proved
able to fail (see the commit messages for the red proofs).

---

## 1. The answer to the question the packet asked

**Parlor holds no customer rows of its own, and that is measured rather
than assumed.**

| how | result |
| --- | --- |
| `find . -name '*.sql' -not -path './node_modules/*'` | **nothing** |
| driver import in `src/` or `package.json` | none of pg/postgres/mysql/sqlite/mongoose/redis/prisma/drizzle/kysely |
| `config/deploy.yml` | no accessories block, no `DATABASE_URL` |
| `src/lib/identity.ts`, `src/lib/billing.ts` | HTTP clients transcribing wire contracts |

So `accountScoped: false`, `entryPoints: []`,
`rls.databaseEnforced: false`, `rls.tables: []` — the honest zero, in the
shape muse and gateway already declare.

**What parlor does hold, and why neither is a row store:**

- `src/lib/accounts.ts` — the React Query cache. Account-keyed
  (`accountsKey`, `accountKey`, `membersKey`, each carrying the token for
  the reason the file's own header gives), but a **client-side memo of
  rows the caller's own credential already fetched**. It cannot serve
  account B's rows to account A except from a cache entry account B's own
  token created in the same browser. That is a real property, guarded by
  `src/lib/accounts.test.tsx` (12 tests) and by the nine red proofs in
  `REPORT-parlor-tenant-proof.md` §3 — but it is cache correctness about
  the caller's own browser, not a boundary over customer data. `gateway`
  makes the same call about its account-keyed rate limiter and vouches it
  as a nonRowSite.
- `src/lib/upstream.ts` — the forwarder's `ROUTES` allow-list. Seven
  entries carry `:accountId`, value-matched as a uuid and substituted
  verbatim. The account is **selected by the caller and forwarded**;
  identity refuses the cross-account read. Nothing is read on this side of
  the socket.

Both are named in the declaration's header rather than declared as entry
points, so a reader is not left to discover them.

---

## 2. THE BLOCKER FOR TG-B1 — read this before anything else

**`schemas/tenant-isolation.schema.json`'s `PATH_PATTERN` cannot express a
bracketed path, and that makes the honest zero unreachable for any
TypeScript router tree.**

The pattern, shared by `nonRowSites[].file`, `enforced.file` and
`negative.cases[].file`, is:

```
^[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+$
```

It admits no `[` and no `]`. TanStack Start — like Next.js, SvelteKit and
Remix — puts a route parameter in the **directory name**. This repository
has three:

```
src/app/accounts/[accountId]/
src/app/invitations/[token]/
src/app/v1/[...path]/
```

**Measured consequence:** with `scope.sources: [src]`, the scanner finds 19
key-carrying lines. Nine of them are under `src/app/invitations/[token]/`
and **cannot be named in a declaration**, so they cannot be vouched for,
so they are `tenancy.honest-zero` — a FAILURE with no legal fix. I
reproduced it: `FAIL tenancy.schema: scope/nonRowSites/8/file: pattern a
repository-relative path` for every bracketed entry.

No other service in the fleet has hit this: identity/courier/darkroom/muse
are Go/Python/Rust/Elixir, and gateway deleted its `src/` tree in `f87c891`
so its `test/` has no bracketed paths. **Parlor is the first
TypeScript-router service to declare, and it is red on arrival.**

**What parlor did about it (the part to review):** `scope.sources`
enumerates all 24 paths under `src` and `e2e` that the schema CAN express,
leaving `src/app/invitations/[token]/` outside the scan. That is a legal
declaration — the checker's own `notEnforced` entry says the scan reads
exactly the declared paths — but it is a hole, so it is closed from this
side by `src/test/tenancy-declaration.test.ts`, which walks the tree,
recomputes nameability, and fails if a key-carrying file is ever outside
both the declared sources and the one named exception.

**The fix core needs:** add `[` and `]` to the `file` character class in
all three `$defs` (`nonRowSite.file`, `located.file`, `enforced.file`,
`negative.cases[].file` — check which share the pattern), and to
`tenancy_check.py`'s `PATH_PATTERN` re-implementation in
`_validate_non_row_sites` / `_validate_paths`. **The checker's
re-implementation must move with the schema or the two disagree**, which is
the same failure mode `bin/prime`'s `validate-ci.sh` exists to catch.
Once it lands, this repository's source list collapses back to `[src]`,
the nine bracketed vouches become expressible, and the ratchet test's
"bracketed exception is exactly two files" assertion becomes the natural
place to notice.

---

## 3. What is half-done, and what a successor should do first

1. **`scope.sources` is 24 entries where `[src]` would be one.** It is
   fragile in a way the current ratchet only partly catches: a NEW
   directory under `src/app/` that is nameable but not added to the list
   is caught by "covers every nameable file that carries the key" — but
   only if it carries the key. A new directory that carries nothing is
   invisible. That is acceptable for a zero (nothing to scope), and the
   alternative is a declaration that cannot reach 0 failures.
2. **`accountId` is not the declared key.** It is parlor's own
   source-language spelling and appears on 196 lines — route segments,
   function parameters, cache-key halves, `routeTree.gen.ts`. The checker
   reads ONE declared key at a time, so declaring `account_id` leaves
   those unguarded. Gateway makes the same trade (21 camelCase lines
   unvouched beside its 17 snake-case vouches). Vouching 196 sites is
   legal (`maxItems: 256`) and would tighten the guard; it was not done
   because 196 hand-written reasons in the remaining clock would have been
   worse than 18 that were read. **This is the obvious next improvement.**
3. **The `account_scope.yml` legacy file is still at the root and is now
   demonstrably stale** — its `src/app/...` paths predate the TanStack
   Start move to `src/routes/`. It is a different format checked by a
   different checker (`account-scope-check`), so it is out of scope here,
   but somebody should retire it or fix its paths.
4. **`REPORT-parlor-tenant-proof.md` §4's reason for not writing a
   `tenancy.yml`** — *"a declaration core cannot check"* — is obsolete and
   the declaration's header says so. That section should be updated in a
   docs pass.

---

## 4. Decisions, and why

- **Honest zero, not declared entry points.** The React Query cache and
  the forwarder were considered as `entryPoints`. Rejected: neither reads
  a row this service owns, `operation: call` closes nothing and would land
  in `enumeration-partial` anyway, and `subject` is a table or method name
  — a browser cache is neither. Declaring them would have pointed three
  denial arms at tests that assert something else (that a 404 reaches the
  screen), which is the defect the format exists to prevent.
- **`account_id`, not `accountId`, as the key.** It is the fleet's tenancy
  vocabulary (D7) and the claim name identity actually scopes by. It is
  also what gateway declares.
- **`rls.sources: [src]` and NOT `[src, e2e]`, deliberately asymmetric with
  `scope.sources`.** `e2e/docker-compose.yml` quotes the *sibling's*
  boundary (`protect_table('account_users')`, `ALTER TABLE … DISABLE ROW
  LEVEL SECURITY`) in the comments that explain the whole-stack tier.
  Naming it earns `tenancy.rls-unreadable` and a sentence claiming
  parlor's own database half is unproven — a false claim about a service
  with no database. Measured: `rls-unreadable` fired at
  `e2e/docker-compose.yml:279` when tested.
- **No change to production code.** The declaration and its ratchet touch
  nothing under `src/` except the new test file. No test was weakened,
  deleted or stubbed; the ratchet is new and additive.

---

## 5. What was deliberately NOT done

- **Did not touch `core/harness/tenancy_check.py`,
  `core/schemas/*.json` or `core/harness/tenancy_findings.json`.** That is
  TG-B1's surface. §2 is the report of what I found there.
- **Did not add a YAML dependency.** `js-yaml` is in `node_modules` as a
  transitive dep but undeclared, and adding a dependency needs manager
  approval (PLAN.md §5). The ratchet uses a ~60-line line reader for the
  six fields it needs, and it **throws** rather than reading nothing — a
  parser that quietly read nothing would make every assertion vacuously
  green.
- **Did not run `./bin/prime` or `bin/e2e`.** The full vitest suite was run
  (1105 tests, 48 files, all pass) and `tsc --noEmit` passes, but the gate
  script itself was not: it is the whole-fleet tier and this packet's
  verification is the narrow one the brief named. `bin/e2e` needs Docker
  and three sibling checkouts and is untouched by this diff.
- **Did not retire `account_scope.yml`** or edit any `REPORT-*.md`. The
  legacy checker is a separate packet's decision, and editing a report to
  agree with a later finding is how a report stops being a measurement.
- **Did not declare `website`'s future.** The fleet is consolidating on
  `website` as the one frontend (`30e73c4`, `9e7f978` on this branch), and
  the declaration says so — but it declares what parlor holds today, which
  is nothing, rather than a forecast.

---

## 6. The sunset note, flagged as the brief asked

**Yes — parlor is being sunset.** `30e73c4` on this branch is the note
itself: *"website is the customer-facing frontend, parlor's code stays
public and free"*, and `9e7f978` audited every screen family against
`website` and found them all already there with nothing to move. This
does not change the declaration: a service being retired still has to say
what it holds today, and the smaller truth is that it holds nothing. The
declaration's header records the consolidation and notes that if it
completes, `tenancy.yml` retires with the tree rather than needing a
rewrite.
