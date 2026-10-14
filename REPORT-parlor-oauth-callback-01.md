# REPORT — the oauth callback answers 404 where the forwarder contract says 502

**Packet:** `parlor-w23-oauthcallback` · **Date:** 2026-10-06 · **Branch:** `worker/parlor-w23-oauthcallback` · **Commit:** `611c3c7`

## The one-paragraph version

The packet's hypothesis is wrong, and the previous attempt's partial work was
right. The callback path **is** in the forwarder's allow-list
(`src/lib/upstream.ts:405-410`, added deliberately by `b3dc1f5`), the client
method is aligned, and the agreement test already walks both social routes. The
test was red because its own premise — "identity is unreachable" — was assumed
rather than enforced: with `IDENTITY_URL` unset, the forwarder falls back to
`http://localhost:8080`, and on a machine where anything answers there (the
e2e stack's identity; on this machine, OrbStack) the request reaches a live
service that answers the callback with **its own 404**, which the forwarder
relays. The fix pins the premise deterministically in the test file and adds
the two assertions that make a relayed upstream answer impossible to misread as
the forwarder's own failure. One file changed, no production code touched, the
502 assertion unchanged and strengthened.

## The diagnosis

### What the packet asked for, and what is actually there

The packet states the callback "apparently never made it into the table." It
has been there since `b3dc1f5` ("parlor: the social routes are reachable
through the forwarder", 2026-10-04), which added the pair as one flow:

```ts
// src/lib/upstream.ts:399-410
{
  method: "GET",
  path: ["auth", "oauth", ":provider"],
  upstream: "identity",
  browserRedirect: true,
},
{
  method: "GET",
  path: ["auth", "oauth", ":provider", "callback"],
  upstream: "identity",
  query: ["code", "state", "error"],
},
```

The client method exists and is aligned: `completeSocialLogin`
(`src/lib/identity.ts:643`) builds `GET /v1/auth/oauth/{provider}/callback`,
which is exactly the table entry. The agreement test
(`src/lib/upstream.test.ts:766-769`) calls **both** social methods through the
table and would throw if either URL were refused — it passes. The route
handler (`src/routes/v1/auth/oauth/$provider/callback.tsx:58-75`) branches on
`isDocumentNavigation`: a document defers to the router's render, everything
else is delegated to the forwarder unchanged. The delegation the packet set out
to fix is already real, and three separate tests already prove it.

### Why the test was red instead

The failing subtest asserts a **502**, and a 502 is the forwarder's answer
when its transport refuses. That makes the test's premise: *nothing is
listening on the identity address*. The test never made that true.

- `src/app/v1/[...path]/route.ts:110-113` builds the forwarder **at module
  scope**, once per process.
- `identityUrl()` (`route.ts:233-236`) reads `process.env.IDENTITY_URL` at
  that moment and falls back to `DEFAULT_IDENTITY_URL` =
  `http://localhost:8080` (`route.ts:92`) — the compose stack's address.
- So with no environment set, this suite's forwarder aims at **whatever the
  developer happens to have on 8080**.

On the packet author's machine that is the e2e stack's identity, which has no
OAuth provider configured (`registerSocialRoutes` returns before registering
either route), so it answers the callback with its own 404. On **this**
machine the listener on 8080 is OrbStack, and it answers the same path in
identity's problem+json envelope. Measured directly:

```
$ curl -s -H "accept: application/json" \
    "http://localhost:8080/v1/auth/oauth/github/callback?code=c&state=s"
{"type":"https://errors.cafaye.com/not_found","title":"Not found","status":404,
 "detail":"no route matches this request","instance":"/v1/auth/oauth/github/callback",
 "code":"not_found","trace_id":"270c5a8e-f231-4c22-9771-3fabbfd259a0"}
HTTP 404
```

The forwarder relays that 404, and the test reads `expected 404 to be 502` —
a message that points at the allow-list, where nothing is missing. The 404 was
never parlor's answer; it was an upstream's, relayed.

### The red proof, first-hand on this machine

The worktree held the previous attempt's uncommitted edit to the test file. To
judge it I restored the original from HEAD, ran it, and restored the fix:

```
AssertionError: expected 404 to be 502 // Object.is equality
      Tests  1 failed | 9 passed (10)
```

Same failure, same message the packet reported, reproduced on a machine with a
service on 8080. The mechanism is confirmed end to end.

## The fix

One file: `src/routes/v1/auth/oauth/$provider/callback.test.ts` (114
insertions, 1 deletion — the deletion is the bare status line, replaced by the
same assertion plus two more).

1. **The premise, pinned before any import.** `vi.hoisted` sets
   `process.env.IDENTITY_URL = "http://127.0.0.1:1"` ahead of the file's
   imports, because ES imports are hoisted and evaluated before any statement
   in the body — `import { Route } from "./callback"` pulls in the route
   handler, which builds its forwarder at module scope, which reads
   `IDENTITY_URL` at that instant. A line in the body would provably do
   nothing. Port 1 is privileged and unbound on every machine this runs on,
   so the refusal is `ECONNREFUSED` immediately rather than a timeout, and no
   stack configuration can make this suite talk to a real service.

2. **The 502 assertion, unchanged.** `expect(response.status).toBe(502)` is
   still there, still the proof that the delegation happened and the forwarder
   failed closed.

3. **Two assertions added, so the misdiagnosis cannot happen again.** The
   body must contain no `trace_id` (a relayed upstream answer carries one; the
   forwarder's own failures do not), and `cache-control` must be `no-store`
   (both of the forwarder's own failures set it; a relayed identity answer
   does not). This is the discriminator whose absence is exactly why a live
   identity's 404 read as a missing allow-list entry.

**This is not a weakening.** The contract under test — a programmatic request
is delegated to the forwarder, not rendered — is untouched; the document
branch, the round-trip walk, the traversal refusal and the route-source guards
are all unchanged; and the suite is strictly stronger than before, since a
relayed upstream answer now fails the test instead of masquerading as the
forwarder's 502. The other nine tests are unaffected: each builds its own
forwarder with an injected transport and an explicit `identityUrl`, and
vitest isolates per file.

**Why not the packet's proposed fix.** Adding the callback to `ROUTES` would
have produced a duplicate entry in the security table of the deployment — a
green suite bought by changing production code in response to a test that was
measuring the wrong thing. The test file's comment now records the misdiagnosis
by name so the next reader does not take the bait.

## The withheld-routes argument (read this before merging)

**The fix does not make the callback browser-reachable through the BFF. It
already is, and this packet changes nothing in `src/lib/upstream.ts`.** The
callback's presence in `ROUTES` dates from `b3dc1f5` and is a deliberate,
tested decision: the identity client can perform the operation, which is the
same bar every other entry answers to. What keeps the callback from being a
*document* hazard is not the table but the route handler, which takes
`Accept: text/html` navigations out of the forwarder's hands and renders
instead — the one-shot-code property the file header explains.

The withheld-routes argument (`upstream.ts:313-333`) is **unchanged**. The
deliberately absent surfaces — the MFA routes, API keys, OIDC clients, email
changes, `/v1/probe/{id}` — are absent for the capability reason stated there,
and the callback's presence is already accounted for in that very comment: the
consequence it names is that the callback can answer 202 with a challenge this
origin cannot finish, because the route that redeems a challenge is still
refused. A provider account with a confirmed second factor reaches a dead end
rather than a wrong answer. This packet widens nothing and narrows nothing.

## The gate

`bin/prime` — exit 0. **868 tests passed, 0 failed** (37 files), typecheck
clean, both builds succeeded, 47/47 CI-shape checks, 52/52 self-test breakages
proven able to fail.

One correction to the packet's arithmetic: it predicted "869+ passing." The
measured total is **868 passing**. The fix repairs an existing test's
environment rather than adding a test, so the count stays at 868 — the same
total master had, minus the one failure. The `gate.yml` floor (727) is
unaffected.

Verbatim output:

```text
==> npm ci
npm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for more options.

added 374 packages, and audited 375 packages in 8s

98 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
==> npm test

> parlor@0.1.0 test
> vitest run


 RUN  v5.0.2 /Users/kaka/Code/any/wt/parlor-w23-oauthcallback


 Test Files  37 passed (37)
      Tests  868 passed (868)
   Start at  22:43:41
   Duration  11.25s (environment 41%, tests 32%, import 10%, transform 10%, setup 7%)

Environment  jsdom was created 37 times · 25.35s total, 41% of tracked time
             create it once per worker with pool: 'vmThreads' (keeps per-file isolation) or isolate: false (shares it across files)
             learn more: https://vitest.dev/guide/improving-performance#test-environments

==> npm run typecheck

> parlor@0.1.0 typecheck
> tsc --noEmit

==> npm run build

> parlor@0.1.0 build
> vite build

✓ 276 modules transformed.
✓ 629 modules transformed.
dist/server/index.mjs                                       705.09 kB │ gzip: 147.70 kB

✓ built in 302ms
✓ built in 265ms
==> tests/validate-ci.sh --self-test
PASS  cafaye.yml is a document cafe can open (asked cafe, not line-matched)
PASS  ci.yml exists
PASS  calls kit's reusable workflow at the documented path
PASS  no call to the unreachable kit path
PASS  language: node matches package-lock.json
PASS  package.json pins the runtime (22.22.2)
PASS  mise.toml agrees with package.json (22.22.2)
PASS  the workflow hands kit the same pin (22.22.2)
PASS  cafaye.yml declares no node pin, so the pin stays in its three homes
PASS  package.json declares npm as the package manager, and only package.json does
PASS  no npm install in any CI path (prose ignored)
PASS  CI fails when the gate moves package-lock.json
PASS  every npm script the workflow calls exists (build build:node typecheck )
PASS  CI runs ./bin/prime
PASS  bin/prime is executable
PASS  bin/prime runs exactly npm ci, npm test, npm run typecheck, then npm run build
PASS  cafaye.yml declares no gate command, so bin/prime is the only answer
PASS  cafaye.yml declares no test command, so bin/prime is the only answer
PASS  e2e.yml exists
PASS  the end-to-end tier is not in the per-commit gate
PASS  bin/prime does not run the end-to-end tier
PASS  the e2e job runs ./bin/e2e
PASS  the e2e job cannot be a soft failure
PASS  the e2e job fails when the tier ran nothing
PASS  bin/e2e is executable
PASS  both readers of the report agree on the test floor (2)
PASS  playwright trace is off, so the run records no network traffic
PASS  playwright video is off, so the run records no network traffic
PASS  playwright retries is 0, and the tier refuses to raise it
PASS  the end-to-end tier has no skip mechanism
PASS  the whole port block is in 16000-16099 and collides with nothing reserved
PASS  every published port in the stack is a substitution (9 entries)
PASS  every image in the stack is pinned to an exact tag
PASS  playwright's port fallbacks are the compose file's
PASS  every service in the stack has a healthcheck or a stated finding
PASS  config/deploy.yml exists and declares no database
PASS  config/deploy.yml declares no build arg, so there is no Dockerfile ARG to disagree with
PASS  the service addresses are run-time env vars in config/deploy.yml (IDENTITY_URL, BILLING_URL)
PASS  no NEXT_PUBLIC_ variable reaches the browser (Dockerfile, src/)
PASS  every node base image in the Dockerfile carries the pin (22.22.2, 2 lines)
PASS  bin/deploy-config is executable
PASS  caf.dev.json exists
PASS  every entry in caf.dev.json is one cafe dev can believe
PASS  every file: dependency's integrity matches the tarball it names (0 to check)
PASS  shellcheck -S warning clean on tests/validate-ci.sh
PASS  the provenance verifier refuses a foreign or inherited stamp (12 assertions)
PASS  every tally helper this file calls is a defined function (no ok skipped )

47 checks declared, 47 passed, 0 failed, 0 skipped
  ok   the pristine copy passes
  ok   rm-workflow goes red
  ok   dead-uses-path goes red
  ok   language-bun goes red
  ok   pin-drifts-into-ci goes red
  ok   pin-drifts-in-mise goes red
  ok   manifest-reintroduces-a-node-pin goes red
  ok   an-unquoted-colon-in-the-manifest goes red
  ok   npm-install-in-ci goes red
  ok   no-lockfile-guard goes red
  ok   stale-script-name goes red
  ok   ci-does-not-run-prime goes red
  ok   npm-install-in-prime goes red
  ok   no-build-in-prime goes red
  ok   no-typecheck-in-prime goes red
  ok   manifest-reintroduces-a-gate-command goes red
  ok   no-engines-field goes red
  ok   range-instead-of-a-pin goes red
  ok   package-manager-is-not-npm goes red
  ok   manifest-reintroduces-a-test-command goes red
  ok   no-e2e-workflow goes red
  ok   e2e-in-the-per-commit-gate goes red
  ok   e2e-in-bin-prime goes red
  ok   e2e-job-does-not-run-the-tier goes red
  ok   e2e-job-is-soft-fail goes red
  ok   e2e-job-cannot-tell-nothing-ran goes red
  ok   e2e-runner-not-executable goes red
  ok   the-two-test-floors-disagree goes red
  ok   trace-on goes red
  ok   video-on goes red
  ok   retries-raised goes red
  ok   a-skip-in-the-tier goes red
  ok   a-port-on-a-colleague goes red
  ok   a-port-outside-the-block goes red
  ok   a-literal-port-in-the-stack goes red
  ok   playwright-points-at-another-stack goes red
  ok   a-service-with-no-health-and-no-finding goes red
  ok   an-unpinned-image goes red
  ok   no-deploy-config goes red
  ok   an-accessory-in-the-deploy-config goes red
  ok   a-builder-arg-without-a-dockerfile-arg goes red
  ok   a-service-address-out-of-env-clear goes red
  ok   a-service-address-back-in-the-bundle goes red
  ok   a-service-address-back-in-the-dockerfile goes red
  ok   an-unpinned-node-base goes red
  ok   the-deploy-tier-is-not-executable goes red
  ok   no-service-catalog goes red
  ok   a-misspelled-key-in-the-catalog goes red
  ok   an-entry-named-for-another-service goes red
  ok   a-catalog-entry-with-no-image goes red
  ok   a-healthcheck-with-no-test goes red
  ok   the-lockfile-does-not-know-the-tarball goes red
  ok   a-tally-helper-that-is-not-a-function goes red
  ok   a comment mentioning npm install does not go red
  ok   a file: dependency whose integrity is right does not go red
self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine
```

(The build's full chunk listing and the Vite config-loader / font-resolution
warnings are omitted above; they are unchanged from master and carry no
signal. The complete log is at `/tmp/prime-output.log` on the machine that
ran the gate.)

## The previous attempt's partial work

The worktree held one uncommitted change: the test file this packet is about,
114 insertions and 1 deletion. I judged it rather than trusted it: read the
diff, checked every claim in it against the source (the `ROUTES` entry, the
module-scope forwarder, the `DEFAULT_IDENTITY_URL` fallback, the agreement
test's coverage), reproduced the red on the original file, and ran the fix.
It was correct, so I kept it and committed it as `611c3c7`. Nothing was
discarded.

## Files

- `src/routes/v1/auth/oauth/$provider/callback.test.ts` — the fix (committed).
- `REPORT-parlor-oauth-callback-01.md` — this report.
- No production code changed. `identity/`, `courier/`, `billing/` untouched.
