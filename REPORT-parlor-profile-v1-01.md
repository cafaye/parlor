# REPORT — parlor-profile-v1-01

Branch `worker/parlor-w21-profilev1`. The screen is built, on the four
capabilities the API actually supports, and nothing else. 868 tests pass, the
floor in `gate.yml` is raised to 868 in the same commit, and `bin/prime` is
green.

This packet builds what `REPORT-parlor-profile-01.md` §4 measured as reachable.
The sections that report found no route for are still absent, and §1 below says
which identity route each one is waiting on.

---

## 1. What is on the screen, and what is still waiting

`/settings`, reachable from the shell header's nav once there is a session
(`src/routes/settings.tsx` → `src/app/settings/page.tsx`). Four controls:

| Control | Route it calls | Client method |
|---|---|---|
| Verification badge | `GET /v1/email-verification` | `verificationStatus` |
| Resend verification email (unverified only) | `POST /v1/email-verifications` | `requestEmailVerification` |
| Sign out | `DELETE /v1/session` | `logout` |
| Session expiry line | none — `expires_at` from login | — |

**No route was added to `src/lib/upstream.ts`.** All four were already in the
table (`upstream.ts:411-417` for the verification pair, `:334` for the session
delete). The table is byte-identical apart from nothing — see §4.

### Sections that await an identity route

Each is **absent** — not disabled, not "coming soon".

| Section | Awaiting | On the service side |
|---|---|---|
| Display name, read and write | `PATCH /v1/me` and a `name` on `GET /v1/me`'s response | `users.Store` has no `UpdateName`; the `User` struct has no name column. `report-01` §2.2 |
| Other sessions, listed | `GET /v1/sessions` | `sessions.Store` has `Create`, `ByToken`, `Revoke`, `RevokeAllForUser` and no `List`. `report-01` §2.3 |
| Revoke one other session | `DELETE /v1/sessions/{id}` | `Revoke(ctx, q, id)` exists in the store and no HTTP route exposes it. `report-01` §2.4 |
| Delete this account | `DELETE /v1/me` | `users.Store` has no `Delete`. `report-01` §2.5 |
| Second factor | `/v1/mfa/*` | Refused by the forwarder on purpose — reaching MFA from a browser turns a second factor into something this origin can drive. Widening the table is a capability decision, not this packet's |
| API tokens | `/v1/accounts/{id}/api-keys` | Refused by the forwarder; not in `src/lib/identity.ts` |

The `identity-w17-sessions` worktree, named in `report-01` §3 as the packet that
would close the two session gaps, had no commits beyond master when this was
written. That packet unblocks two of these six rows and no others.

---

## 2. THE BRIEF WAS WRONG ABOUT ONE OF ITS FOUR CONTROLS, AND THE FIX WAS SMALLER THAN EXPECTED

**`expires_at` was NOT already in the token store.** The brief said so, and
`REPORT-parlor-profile-01.md` §4.5 repeated it: *"`expires_at` is already in the
token store (`src/lib/token-store.ts`) from login. Display it; no route
involved."*

Both are wrong. `identity.ts:77` types `Session = { token: string; expires_at:
string }`, so login **does** receive the instant — but `token-store.ts` stored
`JSON.stringify({ token })` and read back only `parsed.token`. The field was
dropped on the way to `localStorage` and nothing in the app held it. The brief's
own note about the fourth control being free turned out to be the one part of the
packet that needed a code change.

The fix is the shape the store's own comment had predicted since it was written:
> *"A JSON envelope, so a later packet can add `expires_at` next to the token
> without a second key and a second migration."*

`set` takes an optional second argument, `getExpiry()` reads it back, and both go
through one private `read()` so they cannot disagree about whether an entry is
readable. `expires_at: undefined` is dropped by `JSON.stringify`, so a session
with no expiry to report writes **exactly the envelope the old code wrote** —
one shape for readers and migrators, not two. `auth.tsx` passes `expires_at` at
login and at `adoptSession`, and exposes it as `expiresAt` on the context beside
`token`.

Three consequences worth stating:

- **Null is a real answer.** A session stored by an older build is valid and has
  no expiry to report; the screen says **"Not recorded"**. A reconstructed
  instant would be a claim nothing in the app can support.
- **An unparseable value is not rendered as a date.** `toLocaleString` on an
  invalid date returns the literal string `"Invalid Date"`, which would put the
  word "Invalid" in front of somebody as though it were their session's fault.
  `formatInstant` returns null instead, so the screen reads "Not recorded".
- **Clearing the token clears the expiry**, and the 401 path in `auth.tsx`
  already goes through `store.set(null)`, so a rejected token takes its expiry
  with it rather than leaving a stale instant beside a new session.

---

## 3. What the tests hold, and what they refuse to hold

`src/app/settings/page.test.tsx`, 23 tests. Beyond the three the brief asked for:

- **`controlNames()` asserts `["Resend verification email", "Sign out"]` and
  nothing else.** This is the "absent means absent" assertion, and it is
  mechanical: every other method on `stubIdentity` rejects loudly, so a control
  for a refused route would not render as a dead button — it would take the tree
  down with *"stub identity: … was not scripted"*. A second test walks the
  rendered text for `/display name/`, `/second factor/`, `/api (key|token)/`,
  `/delete/`, `/other sessions?/` and expects no match, so the absence is pinned
  from both directions: no control, and not even a heading that hints at one.
- **Sending a link does not flip the badge.** `POST /v1/email-verifications`
  returns a constant 202 for a registered address, an unregistered one, and one
  inside the cooldown. A badge that turned green the moment a mail left would be
  this app asserting a fact only the service knows.
- **The 409 re-reads the badge rather than contradicting it.** If the address was
  proved in another tab between load and click, the service says so and the
  screen invalidates the status query. Left alone, the screen would print "Not
  verified" directly above "already verified".
- **A 503 never borrows the acceptance sentence.** `Service.RequestVerification`
  calls `deliverable` *before* the lookup, so it is a fact about the deployment
  and not an existence oracle; "check your inbox" when nothing will arrive is the
  sentence that strands somebody.
- **Sign-out is asserted on the store, not the screen,** and through `waitFor`,
  because the local half happens in a `finally` inside the mutation rather than
  synchronously in the click. A screen that merely hid its controls would pass a
  "signed out" query, and a reload would still be signed in. Also asserted on the
  refused path: somebody who asked to leave is not held hostage to a service that
  is already down.
- **Two dates a year apart.** The badge's "Verified on" and the panel's expiry
  are both rendered instants. Asserting a bare year against one of them passes
  whichever rendered first, so the fixtures are 2025 and 2026 and each assertion
  is about its own row.

### The anti-enumeration argument, and why it does not carry over unchanged

`/verify-email` is reachable by a signed-out visitor who typed somebody else's
address, and its test compares two renderings **byte for byte** to prove the
screen never says which addresses have accounts. That screen names nothing.

This resend **can** name the address, because the address is
`session.user.email` from `GET /v1/me`, for the token the screen already holds —
and the shell header is printing it on the same page. There is nothing to
protect by hiding it. What did carry over unchanged is the failure copy. Both
arguments are written into `settings-screen.tsx`'s header rather than left as an
implicit "we were careful".

---

## 4. Two edits outside the screen, both forced by existing guards

**`src/lib/telemetry.server.ts` — one line, `"/settings"` added to
`ROUTE_TEMPLATES`.** `telemetry.server.test.ts` walks
`routeTree.gen.ts`'s generated `fullPaths` and fails if any route has no
template, because the failure that guards is a route silently emitting
`http.route: "unmatched"`. That test caught this, which is what it is for.

**`gate.yml` — the suite floor, 837 → 868**, with the arithmetic written out
beside the existing ones per `AGENTS.md`. 868 IS 837, plus 31: 23 in
`page.test.tsx`, 6 in `token-store.test.ts`, 2 in `header.test.tsx`.

`src/routeTree.gen.ts` is regenerated and committed — it is the tree's one
deliberate generated-file exception, per `.gitignore`.

`src/components/shell/header.tsx` gained one `<NavLink>`, gated on the same
`authed` condition as Accounts. `header.test.tsx` gained two tests for it: the
link appears with a session and is hidden without one. A nav link to a page that
can only say "Sign in" is a dead end, and the Accounts row already argued that.

---

## 5. `bin/prime`, and one finding about this machine

Green, output pasted in the handoff. **`bin/prime` run bare on this machine fails
one test, and it is not this packet's** — worth recording, because the cause is
not obvious from the failure:

```
FAIL src/routes/v1/auth/oauth/$provider/callback.test.ts > a programmatic
     request to the callback > is delegated to the forwarder rather than rendered
AssertionError: expected 404 to be 502
```

That test's stated premise is in its own comment: *"with no reachable identity
the forwarder answers its own 502."* **On this machine there is a reachable
identity.** `DEFAULT_IDENTITY_URL` is `http://localhost:8080` and OrbStack is
listening there:

```
$ lsof -nP -iTCP:8080 -sTCP:LISTEN
OrbStack  828 kaka  86u  IPv4 0x60d84618936326d9  0t0  TCP *:8080 (LISTEN)

$ curl -s http://localhost:8080/v1/auth/oauth/github/callback -H 'accept: application/json'
{"type":"https://errors.cafaye.com/not_found","title":"Not found","status":404,
 "detail":"no route matches this request", ...}
```

So the forwarder does its job — it reaches the service and relays its status
faithfully — and the **real** identity answers 404, because that state is
unknown to it. The test is asserting an environmental fact, not a property of the
code, and it is right on any machine where port 8080 is free.

Proof it is unrelated to this packet: `git stash -u` to HEAD, and the same test
fails identically. Pointed at a dead port, the whole file passes:

```
$ IDENTITY_URL=http://127.0.0.1:16999 npx vitest run src/routes/v1/auth/oauth/$provider/callback.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

The pasted `bin/prime` output is the run with that variable set, and that is the
**only** difference from a bare run. Nothing else in the suite reads
`process.env.IDENTITY_URL`, and the full gate passes on both the other 867 tests
and all 47 shape checks without it.

**The finding, stated rather than left to be rediscovered:** a render-suite test
in this tree asserts on the *absence* of a reachable service, and this repository's
default identity address is a port real developers run things on. That is a latent
flake for anyone with a local identity up, and CI will never see it. It was not
fixed here — touching that test is outside this packet's scope, and the honest
version of the fix (inject the forwarder into the route, or assert on the hop
rather than on a status code) is its own piece of work.

---

## 6. Out of scope, and deliberately so

- **No forwarder table edit.** Verified by `git diff src/lib/upstream.ts`: empty.
- **No change to `identity/`, `courier/`, `billing/`, or any other repository.**
- **No existing test weakened, skipped, or deleted.** The 22 tests in the six
  files this touches all still pass, and the suite grew by 31.
- **No confirmation dialog on sign-out.** The header offers it with none, and it
  is the control a person uses every time they leave; a dialog here and not there
  would make one action mean two things. It is also the only control on the
  screen whose effect takes one click to undo.

## 7. What a reviewer should look at first

1. `settings-screen.tsx`'s header — the four controls, and **why** each is here.
2. The `controlNames()` test. If that assertion is ever loosened to
   `toContain`, the screen's whole claim is gone.
3. `token-store.ts`'s `read()`. Two getters sharing one reader is what stops the
   token and the expiry disagreeing about whether an entry is readable.