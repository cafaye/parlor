# REPORT — parlor `m86a`: the manifest half (`exposes.api`)

**Base commit:** `aef25b3` (parlor master at dispatch).
**Branch:** `worker/parlor-w86-http-surface`.
**Packet:** `m86a-parlor-exposes-api-01.md` — the manifest half of the old `m86`.

## What was already in the worktree

The predecessor had committed three commits before being killed:

- `699fdd8` — `openapi/v1.yaml` (1084 lines), `src/lib/openapi-document.test.ts`
  (363 lines), and the `ROUTES`/`Route` export from `src/lib/upstream.ts`.
- `ec45ca6` — `cafaye.yml` declares `exposes.api: openapi/v1.yaml`; the
  omission block replaced; the `dependencies` comment corrected.
- `6f81ac0` — README and CHANGELOG updated; AGENTS.md route count corrected.

One uncommitted fix was in the working tree: the document's gap note said
"fourteen identity POSTs" where the harness reports thirteen (fourteen is
every POST in the document including billing's, and billing's is the one that
does declare the header). Committed as `3679318`.

## What I found and fixed

### The drift test did not typecheck

`npm run typecheck` failed with five errors in `src/lib/openapi-document.test.ts`:

1. `YamlNode` did not include `null`, but the parser assigns `null` for a key
   with no value and no nested block (line 178).
2. `byPathAndMethod` was typed to the narrow `{ path, method }` shape, so
   `pathParams`, `queryParams` and `tags` were invisible on lookup (lines 318,
   332, 345, 346).

Fixed by adding `| null` to `YamlNode` and making `byPathAndMethod` generic
(`<T extends { path: string; method: string }>`). The test still passes and
still fails in both directions. Committed as `d3dd008`.

### A README typo

`/healthz`//`readyz` — a stray double slash. Fixed and committed as `4d5edec`.

## The two-direction drift test — both red proofs

The test (`src/lib/openapi-document.test.ts`) holds `openapi/v1.yaml` and
`ROUTES` in agreement in both directions. Both were proved red before green:

**Direction 1 — a document-only entry.** Added `/v1/secret-admin-route` (a GET
the table does not allow) to the document. The test failed:

```
FAIL src/lib/openapi-document.test.ts > describes no route the table does not allow
  - Expected: []
  + Received: [{ path: "/v1/secret-admin-route", method: "get", ... }]
```

**Direction 2 — a missing document entry.** Removed `/v1/sessions/{sessionId}`
from the document (a route the table allows). The test failed:

```
FAIL src/lib/openapi-document.test.ts > describes every route the table allows
  - Expected: []
  + Received: [{ path: "/v1/sessions/{sessionId}", method: "delete", ... }]
```

Both restored; the test passes green (7 tests).

## The harness result

Command: `../core/harness/bin/cafaye-contract --core ../core .`

**Before (base commit `aef25b3`):** `cafaye.yml` had no `exposes` key. The
harness reported the `openapi.no-document` warning (the manager's measurement,
confirmed by the base commit's manifest having no `exposes` block).

**After (current HEAD):** The `openapi.no-document` warning is **gone**. The
harness exits 0 and reports **16 violations**, all in the three categories the
document's header records:

| Rule | Count | What |
|---|---|---|
| `openapi.idempotency-key` | 13 | identity's thirteen POSTs. identity does not implement the header; declaring it would tell a client its retry is safe when it is not. |
| `openapi.page-envelope` | 2 | `GET /v1/plans` and `GET /v1/customers`. The `{data, page}` envelope is billing's contract, not parlor's. |
| `openapi.errors-are-problems` | 1 | the social start leg's 302. A redirect is not a problem document. |

No other violations. The document's header states all three gaps and why they
are honest partials rather than omissions.

## What the document describes, and what it leaves to the upstreams

**Describes:** every path and method `ROUTES` permits (35 routes: 30 identity,
5 billing), which upstream owns each route, the path/query parameters the
forwarder passes through, and parlor's own error responses (502, 413, 503, 409).

**Leaves to the upstreams, deliberately:**

- **Request and response bodies.** They are identity's and billing's contracts.
  A relative `$ref` across repositories does not resolve; copying their schemas
  here would be a second copy that drifts.
- **The exact success status.** The `2XX` wildcard — the forwarder passes the
  upstream's status through unchanged.
- **The health probes** (`/healthz`, `/readyz`). A probe is infrastructure, not
  contract — the courier/muse practice, and what keeps core's
  `openapi.paths-are-versioned` rule satisfiable.
- **No `servers` block.** parlor is same-origin; the origin is a deployment
  fact, not a contract fact.
- **No `security` scheme.** parlor authenticates nothing; it forwards the
  caller's credentials to identity, which is the platform's only issuer.

## The gate

`bin/prime` (run in the background, `mise exec -- ./bin/prime`):

- **Exit code: 0**
- **Tests: 961 passed** (37 test files)
- **CI shape checks: 47 declared, 47 passed, 0 failed, 0 skipped**
- **Self-test: 52 breakages declared, 52 proven able to fail, 0 unprovable**

## Files changed (full packet, base `aef25b3` → HEAD)

| File | Change |
|---|---|
| `openapi/v1.yaml` | New. OpenAPI 3.1 transcription of the allow-list (1084 lines). |
| `src/lib/openapi-document.test.ts` | New. Two-direction drift test (363 lines). |
| `src/lib/upstream.ts` | `ROUTES` and `Route` exported; comment updated. |
| `cafaye.yml` | `exposes.api: openapi/v1.yaml`; omission block replaced; `dependencies` comment corrected. |
| `README.md` | HTTP contract section; forwarder row updated. |
| `CHANGELOG.md` | Manifest change entry. |
| `AGENTS.md` | Route count corrected (30 → 35). |

## Out of scope (not done, by design)

- The chart, the Ingress, `app.cafaye.com` — that is `m86b`.
- `chart/templates/application.yaml` — `m86b`.
- Other repositories.
