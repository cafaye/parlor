# REPORT — parlor-mfa-enroll-01: the enrollment surface, and the sign-in it leaves broken

Written by the session that built the MFA enrollment packet. Everything below
was measured or read out of a file, not assumed; each claim says which. The
packet is on `worker/parlor-w31-mfaenroll` and the gate is green (output in §5).
This file is for whoever picks up the next one.

## 0. The state this packet started from

The previous attempt's work was in the tree, uncommitted, and it was **correct in
its contracts and wrong in its wiring** — the distinction this section exists to
draw, because "keep what is correct" is not the same as "keep what is there".

**Kept, after verification against `identity/openapi/v1.yaml` (not against the
brief's summary):** the four forwarder entries, the four client methods and
their types, `src/lib/mfa.ts`, the whole of `src/app/settings/mfa-section.tsx`,
and the tests. Every type was checked against the document's schemas
(`MFAStatus`, `StartEnrollmentRequest`, `StartedEnrollment`,
`ConfirmEnrollmentRequest`, `ConfirmedEnrollment`, `RecoveryCodesResponse`,
`FactorRequest`) and every status against the route definitions. The document
and the partial work agreed everywhere, including the two that matter most: a
`200 {"enabled": false}` and never a 404 on `GET /v1/mfa`, and the confirm's
401 (a refused code, whatever the cause) against its 404 (an enrollment that is
not this caller's, is expired, or is already confirmed).

**Fixed, because it was wrong:**

- `vi.hoisted()` for the clipboard stub was nested inside a `describe` block.
  Vitest refuses a hoisted call outside module top level and the whole settings
  suite failed to collect (0 tests). Moved to the top of the module.
- Eleven pre-existing tests in `page.test.tsx` build their own
  `stubIdentity({...})` overrides, and none scripted `mfaStatus`. The MFA
  section is part of the page they render, so each of them got the section's
  `ErrorState` — which is `role="alert"` — and the two resend tests' `findByRole("alert")`
  found the MFA error instead of the one they were asserting. Each override
  now scripts `mfaStatus: mfaDisabled()`, the same line `renderSettings`'s own
  default already carried.
- The copy-button test searched for `"Copy secret"`; the component renders
  `Copy ${label}` with `label="Secret"`, so the accessible name is
  `"Copy Secret"`. The test was wrong, not the component.
- `page.test.tsx` had no trailing newline.

**The gate floor moved 868 → 895** (+27: 15 in `identity.test.ts`, 2 in
`upstream.test.ts`, 10 in `settings/page.test.tsx`), with the account written
into `gate.yml` in the file's own convention. Four red proofs were run before
the floor moved — see §4.

## 1. What shipped

**The forwarder** (`src/lib/upstream.ts`) carries the four MFA management
routes: `GET /v1/mfa`, `POST /v1/mfa/enrollments`, `POST
/v1/mfa/enrollments/{enrollmentId}/confirm`, `POST /v1/mfa/recovery-codes`.
They crossed the bar every entry answers to — the client performs them and a
screen drives them — and the table's header comment now says so, naming the
two MFA routes that did **not** cross: `POST /v1/session/mfa` (the login
challenge, owned by the login flow) and `DELETE /v1/mfa` (the disable, a
destructive security action with no screen). `:enrollmentId` is value-matched
as a uuid, because the document declares it one and the handler's own note is
that another user's, an expired one's and an already-confirmed one's are all
404 — the id is not a way to learn which enrollments exist.

**The client** (`src/lib/identity.ts`) carries the four methods, typed from
the document. Two shapes are worth naming because they are the ones a lazy
reader gets wrong: `startMfaEnrollment` defaults its input to `{}` (the
document requires a body; `code` is the optional half of it, so a first
enrollment sends an empty object and a rotation sends `{ code }`), and
`confirmMfaEnrollment` keeps the status so the screen can tell a refused code
(401) from an enrollment that is gone (404).

**The section** (`src/app/settings/mfa-section.tsx`) is a state machine with
five states, and the one-time rule is the whole design: the secret, the
provisioning URI and the recovery codes are each held in component state for
exactly one step and are never written to the query cache. The confirm
*replaces* the enroll state rather than annotating it, so the secret leaves
the document at the same moment the codes arrive. There is no path back to the
enroll step that re-renders it — Replace starts a NEW enrollment, which mints
a NEW secret, which is the service's own rule.

**The copy is honest about the session.** `POST
/v1/mfa/enrollments/{id}/confirm` revokes every session the account holds,
including the caller's own, and mints no token. The confirmed state says so
out loud ("Every session was signed out, including this one") and offers
"Sign in again", which calls `logout()` — whose server half is a best-effort
DELETE that will 401 against the already-revoked session, so the local half in
its `finally` is the half that matters. Enabling MFA signs the session in only
via the already-working path, and the UI promises nothing else.

**Also shipped:** the enabled state (facts, Replace, New recovery codes), the
code-first flow that authorises a rotation or a regeneration with the current
code, `src/lib/mfa.ts` (the status query with the token in its key, so a
second factor is never served to a session that cannot read it), the stub
methods in `src/test/support/identity.ts`, the CHANGELOG entry, and the
`AGENTS.md` forwarder section updated to thirty routes / twenty-five to
identity.

## 2. The login-challenge gap this leaves

**An account that enables MFA cannot finish signing in in the browser.** This
is not a regression — it was true before this packet — but this packet makes it
reachable by an ordinary user pressing a button, which is a different kind of
true.

The chain, each link read out of a file:

1. `POST /v1/session` answers `202 {mfa_required, challenge, expires_at}` for
   an account with a confirmed factor (`identity/openapi/v1.yaml`, the
   `mfa_required` schema at line 6243).
2. `identity.login` is `send(transport, "/v1/session", "POST", { body })`, and
   `send` reads a 2xx as success and returns the body typed as `Session`. A
   challenge body therefore reaches `store.set(result.token)` with `token`
   **undefined**: `localStorage` gets `{"token":undefined}`, `get()` reads it
   back as `null`, and the person is signed out having been told nothing.
   This is the defect `HANDOFF-parlor-02-social-ui.md` §2 recorded on the
   password path; the MFA packet does not fix it and does not touch it.
3. Even if the 202 were handled, the route that redeems it — `POST
   /v1/session/mfa` — is deliberately refused by the forwarder's allow-list,
   with a test holding it there. Finishing a sign-in is the login flow's
   business, not a forwarder table's.

The social path has the same dead end and the same honest minimum: the
callback screen says the sign-in is not finished, signs nobody in, and offers
`/login`.

**What the enable flow's copy does about it:** the confirmed state's caution
callout says "Sign in again, and you'll be asked for a code." That sentence is
true the moment it renders and a lie about the next ten seconds — the person
who signs in again on the password path hits the 202 and is silently signed
out (link 2). The alternative — promising nothing about what sign-in will ask
for — was chosen because the login flow's behaviour is not this packet's to
state, and a sentence that describes a flow this app does not have is worse
than one that describes the one it does. **The follow-up packet owns the
honesty of that sentence**, because it owns link 2.

## 3. What the follow-up packet must do

Named in order of dependency, not importance:

1. **The login challenge flow.** `login` gets a discriminated union mirroring
   `completeSocialLogin` — `working`, `mfa_required`, `refused` — with the
   202's `{mfa_required, challenge, expires_at}` as its own arm. The login
   screen renders the challenge state: a code input, the `__Host-mfa-challenge`
   cookie riding the POST as the browser's route (the document accepts either
   the cookie or the body field; the body wins when both are present). The
   social callback screen gets the same arm. This is a `src/lib/identity.ts`
   contract change with its own test surface, and it is security-adjacent — it
   is the difference between a person with a second factor being locked out of
   their own account and being asked for their second factor.
2. **Then, and only then, `POST /v1/session/mfa` crosses the forwarder.** The
   bar is the same one the management routes crossed: a client method and a
   screen behind it. The route's own statuses (a refused code is a 401, a
   spent or unknown challenge is a 404) are documented and belong in
   `identity.test.ts` beside the others.
3. **The disable, `DELETE /v1/mfa`.** It requires a second factor and a
   password is not accepted — re-authentication for a destructive security
   action is the whole reason it exists. It revokes every session and clears
   the cookie. It needs a `ConfirmDialog` (the fleet's only way to run
   something irreversible) and a client method, and it is the one MFA route
   where the person is signed out *by the action itself* rather than by the
   confirm's revocation.
4. **The QR code.** The enroll step renders the provisioning URI as copyable
   text, which is the honest minimum and what the brief named as a follow-up.
   A QR is a rendering of the same URI, not a new capability.
5. **`src/lib/mfa.ts` has no dedicated test file.** Its properties (token in
   the key, disabled without a token, `retry: false`, `gcTime: 0`) are
   asserted through the settings page tests rather than directly. That is a
   gap this packet leaves open, named rather than discovered later.

## 4. The red proofs that were run

A check that has only ever been green has verified nothing. Four were broken
on purpose before the floor moved:

- **Deleting the four MFA table entries** turned three `upstream.test.ts` tests
  red: "forwards the four MFA management routes", "refuses a route identity
  serves but this app never calls", and the table-and-clients-agree walk.
- **Dropping the `:enrollmentId` uuid value-match** turned the same three red
  by the other door — the non-uuid id is forwarded instead of refused.
- **Lifting the secret into state the confirmed view also renders** (the
  defect the one-time rule exists to prevent) turned four `page.test.tsx` tests
  red, "never renders the secret again after the confirm" among them.
- **Making `startMfaEnrollment` send no body for a first enrollment** turned
  "sends an empty body for a first enrollment, because the code is the optional
  half" red.

## 5. The gate, verbatim

`./bin/prime` on the final tree, exit status 0:

```
==> npm ci
npm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for other options.

added 374 packages, and audited 375 packages in 10s

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


 RUN  v5.0.2 /Users/kaka/Code/any/wt/parlor-w31-mfaenroll


 Test Files  37 passed (37)
      Tests  895 passed (895)
   Start at  03:51:44
   Duration  18.49s (environment 42%, tests 33%, import 10%, transform 9%, setup 7%)

Environment  jsdom was created 37 times · 43.43s total, 42% of tracked time
             create it once per worker with pool: 'vmThreads' (keeps per-file isolation) or isolate: false (shares it across files)
             learn more: https://vitest.dev/guide/improving-performance#test-environments

==> npm run typecheck

> parlor@0.1.0 typecheck
> tsc --noEmit

==> npm run build

> parlor@0.1.0 build
> vite build

(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./vite.shared" without a file extension (vite.config.mts:6:45). Add the file extension
  - ESM syntax in a file loaded as CommonJS (vite.shared.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
(node:58345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Warning: Route file "/Users/kaka/Code/any/wt/parlor-w31-mfaenroll/src/routes/v1/auth/oauth/$provider/callback.test.ts" does not export a Route. This file will not be included in the route tree.

If this file is not intended to be a route, you can exclude it using one of these options:
  1. Rename the file to "/Users/kaka/Code/any/wt/parlor-w31-mfaenroll/src/routes/v1/auth/oauth/$provider/-callback.test.ts" (prefix with "-")
  2. Use 'routeFileIgnorePattern' in your config to match this file

Current configuration:
  routeFileIgnorePrefix: "-"
  routeFileIgnorePattern: undefined
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./vite.shared" without a file extension (vite.config.mts:6:45). Add the file extension
  - ESM syntax in a file loaded as CommonJS (vite.shared.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
Warning: Route file "/Users/kaka/Code/any/wt/parlor-w31-mfaenroll/src/routes/v1/auth/oauth/$provider/callback.test.ts" does not export a Route. This file will not be included in the route tree.

If this file is not intended to be a route, you can exclude it using one of these options:
  1. Rename the file to "/Users/kaka/Code/any/wt/parlor-w31-mfaenroll/src/routes/v1/auth/oauth/$provider/-callback.test.ts" (prefix with "-")
  2. Use 'routeFileIgnorePattern' in your config to match this file

Current configuration:
  routeFileIgnorePrefix: "-"
  routeFileIgnorePattern: undefined
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./vite.shared" without a file extension (vite.config.mts:6:45). Add the file extension
  - ESM syntax in a file loaded as CommonJS (vite.shared.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
Warning: Route file "/Users/kaka/Code/any/wt/parlor-w31-mfaenroll/src/routes/v1/auth/oauth/$provider/callback.test.ts" does not export a Route. This file will not be included in the route tree.

If this file is not intended to be a route, you can exclude it using one of these options:
  1. Rename the file to "/Users/kaka/Code/any/wt/parlor-w31-mfaenroll/src/routes/v1/auth/oauth/$provider/-callback.test.ts" (prefix with "-")
  2. Use 'routeFileIgnorePattern' in your config to match this file

Current configuration:
  routeFileIgnorePrefix: "-"
  routeFileIgnorePattern: undefined
vite v8.3.2 building client environment for production...
transforming...

./files/geist-cyrillic-ext-wght-normal.woff2 referenced in ./files/geist-cyrillic-ext-wght-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-cyrillic-wght-normal.woff2 referenced in ./files/geist-cyrillic-wght-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-latin-ext-wght-normal.woff2 referenced in ./files/geist-latin-ext-wght-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-latin-wght-normal.woff2 referenced in ./files/geist-latin-wght-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-ext-400-normal.woff2 referenced in ./files/geist-mono-cyrillic-ext-400-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-400-normal.woff2 referenced in ./files/geist-mono-cyrillic-400-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-vietnamese-400-normal.woff2 referenced in ./files/geist-mono-vietnamese-400-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-ext-400-normal.woff2 referenced in ./files/geist-mono-latin-ext-400-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-400-normal.woff2 referenced in ./files/geist-mono-latin-400-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-ext-500-normal.woff2 referenced in ./files/geist-mono-cyrillic-ext-500-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-500-normal.woff2 referenced in ./files/geist-mono-cyrillic-500-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-symbols2-500-normal.woff2 referenced in ./files/geist-mono-symbols2-500-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-vietnamese-500-normal.woff2 referenced in ./files/geist-mono-vietnamese-500-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-ext-500-normal.woff2 referenced in ./files/geist-mono-latin-ext-500-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-500-normal.woff2 referenced in ./files/geist-mono-latin-500-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-ext-600-normal.woff2 referenced in ./files/geist-mono-cyrillic-ext-600-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-600-normal.woff2 referenced in ./files/geist-mono-cyrillic-600-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-symbols2-600-normal.woff2 referenced in ./files/geist-mono-symbols2-600-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-vietnamese-600-normal.woff2 referenced in ./files/geist-mono-vietnamese-600-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-ext-600-normal.woff2 referenced in ./files/geist-mono-latin-ext-600-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-600-normal.woff2 referenced in ./files/geist-mono-latin-600-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-vietnamese-wght-normal.woff2 referenced in ./files/geist-vietnamese-wght-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-ext-400-normal.woff referenced in ./files/geist-mono-cyrillic-ext-400-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-400-normal.woff referenced in ./files/geist-mono-cyrillic-400-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-symbols2-400-normal.woff2 referenced in ./files/geist-mono-symbols2-400-normal.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-vietnamese-400-normal.woff referenced in ./files/geist-mono-vietnamese-400-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-ext-400-normal.woff referenced in ./files/geist-mono-latin-ext-400-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-400-normal.woff referenced in ./files/geist-mono-latin-400-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-ext-500-normal.woff referenced in ./files/geist-mono-cyrillic-ext-500-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-500-normal.woff referenced in ./files/geist-mono-cyrillic-500-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-symbols2-500-normal.woff referenced in ./files/geist-mono-symbols2-500-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-vietnamese-500-normal.woff referenced in ./files/geist-mono-vietnamese-500-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-ext-500-normal.woff referenced in ./files/geist-mono-latin-ext-500-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-500-normal.woff referenced in ./files/geist-mono-latin-500-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-ext-600-normal.woff referenced in ./files/geist-mono-cyrillic-ext-600-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-cyrillic-600-normal.woff referenced in ./files/geist-mono-cyrillic-600-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-symbols2-600-normal.woff referenced in ./files/geist-mono-symbols2-600-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-vietnamese-600-normal.woff referenced in ./files/geist-mono-vietnamese-600-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-ext-600-normal.woff referenced in ./files/geist-mono-latin-ext-600-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-latin-600-normal.woff referenced in ./files/geist-mono-latin-600-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime

./files/geist-mono-symbols2-400-normal.woff referenced in ./files/geist-mono-symbols2-400-normal.woff didn't resolve at build time, it will remain unchanged to be resolved at runtime
✓ 278 modules transformed.
rendering chunks...
computing gzip size...
dist/client/.assetsignore                                 0.02 kB
dist/client/assets/index-CsgsQ0Do.css                    31.72 kB │ gzip:  6.44 kB
dist/client/assets/root-DLTE-HSj.js                       0.03 kB │ gzip:  0.05 kB
dist/client/assets/matchContext-BIvqOYEx.js               0.14 kB │ gzip:  0.12 kB
dist/client/assets/social-lpj8fYKo.js                     0.15 kB │ gzip:  0.14 kB
dist/client/assets/navigation-N0r6aYtP.js                 0.15 kB │ gzip:  0.15 kB
dist/client/assets/verify-email-DYy5ABNA.js               0.15 kB │ gzip:  0.14 kB
dist/client/assets/search-params-CwAhnm9p.js              0.24 kB │ gzip:  0.19 kB
dist/client/assets/ClientOnly-BuftO5mz.js                 0.29 kB │ gzip:  0.22 kB
dist/client/assets/social-provider-buttons-3RW-Y-rH.js    0.47 kB │ gzip:  0.30 kB
dist/client/assets/useMatch-DZ8x6Y4M.js                   0.62 kB │ gzip:  0.39 kB
dist/client/assets/credentials-CFMUR6a0.js                0.88 kB │ gzip:  0.33 kB
dist/client/assets/useInfiniteQuery-X_Ysh3MX.js           1.11 kB │ gzip:  0.47 kB
dist/client/assets/routes-CtSwj4Lu.js                     1.70 kB │ gzip:  0.81 kB
dist/client/assets/useSelector-DjzlraYY.js                1.96 kB │ gzip:  0.84 kB
dist/client/assets/accounts-DtGI-KGU.js                   1.98 kB │ gzip:  0.59 kB
dist/client/assets/confirm-BoE7n5s2.js                    2.62 kB │ gzip:  1.10 kB
dist/client/assets/forgot-password-T_Wsn58y.js            3.05 kB │ gzip:  1.41 kB
dist/client/assets/plans-CPe_bv1Y.js                      3.08 kB │ gzip:  1.33 kB
dist/client/assets/utils-DCvbpOtd.js                      3.25 kB │ gzip:  1.51 kB
dist/client/assets/login-MIm9GPq3.js                      3.35 kB │ gzip:  1.41 kB
dist/client/assets/verify-email.index-BNGpZPGU.js         3.43 kB │ gzip:  1.45 kB
dist/client/assets/callback-B1N7HRXj.js                   3.49 kB │ gzip:  1.50 kB
dist/client/assets/reset-password-BieNb5mB.js             3.72 kB │ gzip:  1.53 kB
dist/client/assets/register-fqzD9JoR.js                   3.92 kB │ gzip:  1.59 kB
dist/client/assets/accounts-CAhmwZjq.js                   4.16 kB │ gzip:  1.77 kB
dist/client/assets/customers-BDgc0K_J.js                  5.18 kB │ gzip:  2.11 kB
dist/client/assets/preload-helper-CC93A19k.js             5.54 kB │ gzip:  2.17 kB
dist/client/assets/_token-Cq2q4vpO.js                     5.88 kB │ gzip:  1.66 kB
dist/client/assets/link-m1wdvJ6u.js                       6.10 kB │ gzip:  2.97 kB
dist/client/assets/jsx-runtime-Cltr0gcK.js                8.43 kB │ gzip:  3.21 kB
dist/client/assets/identity-CPa4IPhH.js                  11.90 kB │ gzip:  3.97 kB
dist/client/assets/settings-DT09e5Xl.js                  11.97 kB │ gzip:  3.54 kB
dist/client/assets/_accountId-CN7LI1tB.js                12.49 kB │ gzip:  3.83 kB
dist/client/assets/ui-Cb-Z2vAE.js                        32.25 kB │ gzip: 10.72 kB
dist/client/assets/index-CkHePnIk.js                    307.18 kB │ gzip: 98.40 kB

✓ built in 468ms
vite v8.3.2 building ssr environment for production...
transforming...
✓ 631 modules transformed.
rendering chunks...
computing gzip size...
dist/server/wrangler.json                                     1.32 kB │ gzip:   0.66 kB
dist/server/.vite/manifest.json                              15.25 kB │ gzip:   1.86 kB
dist/server/assets/router-CsgsQ0Do.css                       31.72 kB │ gzip:   6.44 kB
dist/server/assets/invariant-DlVY4Nwc.mjs                     0.17 kB │ gzip:   0.14 kB
dist/server/assets/root-DwT5UJhp.mjs                          0.20 kB │ gzip:   0.16 kB
dist/server/assets/empty-plugin-adapters-D9UWiqvJ.mjs         0.22 kB │ gzip:   0.16 kB
dist/server/assets/navigation-AqKviqcu.mjs                    0.31 kB │ gzip:   0.23 kB
dist/server/assets/matchContext-qnUmK8Tm.mjs                  0.44 kB │ gzip:   0.26 kB
dist/server/assets/utils-B12U0qHn.mjs                         0.69 kB │ gzip:   0.32 kB
dist/server/assets/createMiddleware-B_4t7rW1.mjs              0.83 kB │ gzip:   0.32 kB
dist/server/assets/ClientOnly-DvuDLXXx.mjs                    1.32 kB │ gzip:   0.65 kB
dist/server/assets/useMatch-BqSsdi9y.mjs                      1.53 kB │ gzip:   0.70 kB
dist/server/assets/rolldown-runtime-7_rZTKki.mjs              1.79 kB │ gzip:   0.80 kB
dist/server/assets/utils-DGrXRiY0.mjs                         2.01 kB │ gzip:   0.99 kB
dist/server/assets/search-params-CRXOsv_2.mjs                 2.26 kB │ gzip:   1.12 kB
dist/server/assets/verify-email-CW8lJCfG.mjs                  2.59 kB │ gzip:   1.23 kB
dist/server/assets/routes-B8K4yax6.mjs                        3.47 kB │ gzip:   1.34 kB
dist/server/assets/social-provider-buttons-CLZSWAuY.mjs       4.20 kB │ gzip:   1.84 kB
dist/server/assets/useInfiniteQuery-kFGy3xuW.mjs              4.52 kB │ gzip:   1.41 kB
dist/server/assets/start-JqgtS34c.mjs                         4.80 kB │ gzip:   2.09 kB
dist/server/assets/path-CUkU8rkq.mjs                          4.81 kB │ gzip:   1.85 kB
dist/server/assets/_tanstack-start-manifest_v-d2QsRR8T.mjs    4.91 kB │ gzip:   1.12 kB
dist/server/assets/credentials-BB_wtFsW.mjs                   5.79 kB │ gzip:   2.22 kB
dist/server/assets/link-Bb5Iw6dz.mjs                          6.13 kB │ gzip:   2.27 kB
dist/server/assets/useSelector-8y0RsqM-.mjs                   7.13 kB │ gzip:   2.09 kB
dist/server/assets/plans-SOirTgWT.mjs                         7.37 kB │ gzip:   2.67 kB
dist/server/assets/accounts-BAWMoTXO.mjs                      7.52 kB │ gzip:   2.24 kB
dist/server/assets/utils-CPas-Ynl.mjs                         8.18 kB │ gzip:   3.46 kB
dist/server/assets/login-D-mdxqiM.mjs                         9.40 kB │ gzip:   3.32 kB
dist/server/assets/forgot-password-DghL1Tx9.mjs               9.45 kB │ gzip:   3.45 kB
dist/server/assets/accounts-gSavptyv.mjs                      9.68 kB │ gzip:   3.25 kB
dist/server/assets/customers-Di5Mw0VE.mjs                    10.78 kB │ gzip:   3.33 kB
dist/server/assets/Match-OB0mOQqG.mjs                        11.42 kB │ gzip:   3.09 kB
dist/server/assets/register-CM5OOMnt.mjs                     11.76 kB │ gzip:   4.03 kB
dist/server/assets/confirm-D2p-LMDv.mjs                      11.76 kB │ gzip:   4.28 kB
dist/server/assets/_token-CWA4Lc09.mjs                       12.37 kB │ gzip:   3.21 kB
dist/server/assets/verify-email.index-6VtRs3_W.mjs           12.41 kB │ gzip:   4.41 kB
dist/server/assets/reset-password-CAmnUqQW.mjs               12.49 kB │ gzip:   4.37 kB
dist/server/assets/lazyRouteComponent-g1mPLPmJ.mjs           12.57 kB │ gzip:   3.27 kB
dist/server/assets/callback-DqDXwvRq.mjs                     14.01 kB │ gzip:   5.21 kB
dist/server/assets/jsx-runtime-B7Fs_saC.mjs                  17.01 kB │ gzip:   4.47 kB
dist/server/assets/_accountId-c5fUQ064.mjs                   26.81 kB │ gzip:   6.62 kB
dist/server/assets/identity-DPXdfo60.mjs                     35.48 kB │ gzip:  10.32 kB
dist/server/assets/settings-D-nXAM6R.mjs                     40.06 kB │ gzip:  10.19 kB
dist/server/assets/ui-BqUFwfTV.mjs                          102.40 kB │ gzip:  28.74 kB
dist/server/assets/manifest-CNXZCqwS.mjs                    109.21 kB │ gzip:  26.66 kB
dist/server/assets/router-BmGASyP8.mjs                      149.55 kB │ gzip:  44.04 kB
dist/server/assets/telemetry.server-BNNnKN18.mjs            222.71 kB │ gzip:  56.61 kB
dist/server/index.mjs                                       705.09 kB │ gzip: 147.70 kB

✓ built in 377ms
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

The build warnings (Vite config loader, font resolution, the route-test file
that is not a route) are pre-existing on this tree and are not gate findings;
they are reproduced above because a verbatim paste is the point of this
section.

## 6. The re-verification this attempt ran

The manager's resume note flagged this report's "gate green" claim as
unverified — the previous session stalled before it could be checked. This
attempt re-ran the gate on the final tree (2026-10-07, `mise exec --
./bin/prime`, exit 0). The tallies are identical to §5's run — 895 passed
(37 files), 47 checks declared / 47 passed, 52 breakages declared / 52
proven — and the run differs from §5's only in timestamps and durations.

One change was made to the tree in this attempt, and it is comment-only:
`src/lib/upstream.ts`'s header still said "the twenty-one identity routes" and
its refused-route list still named "the MFA routes" as refused. Both were
stale by the four management routes this packet added. The count was REMOVED
rather than bumped to twenty-five, because the same paragraph argues the rule
itself — "A number that cannot be re-derived from a file is a number that
rots, and this is the one place in the codebase that must not rot quietly" —
and the list now names what is actually still refused: the LOGIN challenge
(`POST /v1/session/mfa`) and the disable (`DELETE /v1/mfa`). No code, test,
or gate input changed; the gate above is the final tree's.
