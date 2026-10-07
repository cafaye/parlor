# REPORT — parlor-profile-v2-01

Branch `worker/parlor-w26-profilev2`. The three sections
`REPORT-parlor-profile-v1-01.md` §1 listed as waiting on identity routes are
built: display name, other sessions, and account self-deletion. 913 tests pass
(the floor in `gate.yml` is 868 and is NOT raised by this packet — see §6), and
`bin/prime` is green.

All three routes were verified on identity's master before building:
`git -C ../identity show master:openapi/v1.yaml` carries `PATCH /v1/me` and
`GET /v1/me`'s `display_name` (merge `8a1c03e`), `GET /v1/sessions` and
`DELETE /v1/sessions/{session_id}` (merge `680972e`), and `DELETE /v1/me`
(`deleteCurrentUser`). The deletion route is present, so the deletion section
is built rather than recorded as waiting.

---

## 1. What shipped

### Display name — `PATCH /v1/me`

`GET /v1/me` answers `display_name` only when one is set; the field is omitted
rather than sent as `null`, so "no name" and "never asked" are the same answer
and the client type carries it as optional (`User.display_name?: string`).
`MAX_DISPLAY_NAME_LENGTH = 64` mirrors the route's `maxLength` so a refusal is
told before the round trip; the service remains the authority and the 422 path
still handles it.

### Sessions — `GET /v1/sessions`, `DELETE /v1/sessions/{session_id}`

The list renders the service's answer raw: user agent unparsed (a device label
this app invents is a label that can be wrong), the address as recorded at
sign-in, both instants formatted for a reader, and the service's own `current`
mark for "This device". Nothing on a row is a credential — the service sends no
token and no digest of one, and the screen adds nothing that could become one.
A per-row Revoke calls the delete; the row leaves with the click that revoked
it rather than after a refetch (`useDropSession`), because the 204 already
said the session is gone.

**Revoking the session you are using** is allowed by the service, and the 204
sets no `Set-Cookie` — the browser keeps a credential that is now dead. The
screen handles it the way the login flow handles a dead session: `forgetSession()`
clears the local half (the token store and the query cache) and the person is
routed to `/login`. The same `forgetSession` is what a successful account
deletion uses.

### Delete account — `DELETE /v1/me`

Built, because the route is on identity master. See §3.

### Forwarder table

Four entries added to `src/lib/upstream.ts`, following the existing entries'
shape: `PATCH /v1/me`, `DELETE /v1/me`, `GET /v1/sessions`, and
`DELETE /v1/sessions/{session_id}` (with `sessionId` value-matched as a uuid, like
every other id in the table). The two-lookup rule in `forward` is what tells
the three `/v1/me` methods apart. The withheld list is untouched: MFA routes,
api-keys, OIDC clients, email changes, introspections and `/v1/probe/{id}` are
still refused, and no control pretends otherwise.

---

## 2. The display name's set-or-clear, and the decision

`PATCH /v1/me` has exactly one field and **no "leave unchanged" to express**: an
omitted `display_name` and an empty string decode the same way upstream, so
every commit is either "this is my name now" or "nothing". The client method
therefore takes a REQUIRED `display_name` — a method taking
`{ display_name?: string }` would offer a third answer the route does not have.

The UI makes the two meanings visible instead of hiding one in a no-op:

- The input always holds the CURRENT name, so an empty input means "no name"
  and never "I have not decided yet".
- **Save name** is disabled while the input equals the stored name, so it can
  never be a no-op commit — and, while a name is set, an empty input is not a
  saveable state at all.
- **Clear name** is the explicit affordance for the one change Save cannot
  express, rendered only while there is something to clear.

The surprise this prevents: select-all, delete, save — expecting nothing to
happen, and the name is gone instead. Clearing is one named button, and it is
the only way in.

---

## 3. The delete flow

**The confirm is type-to-confirm, matching the reference product.** The person
types the PERSONAL account's name — the one `DELETE /v1/me` removes — read from
the accounts list, so a rename is respected. `ConfirmDialog` gained a
`requireTyping` prop for this: the expected value is shown, the confirm stays
disabled until the input matches exactly, and the typed value resets when the
dialog reopens. The panel's own Delete button stays disabled until the accounts
list resolves, because a confirm name guessed is a name that could be wrong on
the one control where being wrong is irreversible.

**What the route answers, and what the UI does with each:**

- **204, no body, no `Content-Type`.** Every credential is ended in the same
  transaction, so the token in `localStorage` is dead the moment it lands. The
  service cannot clear the cookie — it was never told which session the request
  arrived on — so the local half is the only half left to clear:
  `forgetSession()` then a route to `/register`. A deleted account has nowhere
  else to go.
- **409 `account_ownership_conflict`** — the one answer that is not constant. A
  caller who is the SOLE owner of a team account is refused, and the problem
  document's `detail` names each account by name and slug precisely so the
  caller can act. That detail is the service's own user-facing sentence, not an
  internal code, host or port, so it is rendered verbatim. A team account the
  caller merely belongs to never blocks them.
- **Anything else** is the one plain sentence, never the service's detail — a
  proxy's 502 carries a host and a port.

The double-submit guard is the `inFlight` ref in `destroyAccount` (the same
ref-not-state split the rest of the screen makes): the disabled button is a
frame too late, and a closure read of `pending` is stale in exactly the frame
the second click lands in.

---

## 4. What still awaits an identity route

Each is **absent** — not disabled, not "coming soon" — the same form v1 chose.

| Section | Status |
|---|---|
| Second factor UI | **Withheld by decision, not by a gap** — FEATURE-PARITY §7a. The forwarder refuses `/v1/session/mfa` and `/v1/mfa/*` on purpose: reaching them from a browser turns a second factor into a thing this origin can drive. The identity API exists; building the UI is a capability decision, not this packet's. |
| API tokens | Awaits `/v1/accounts/{id}/api-keys`, refused by the forwarder for the same reason. |
| Password change | Not a gap: identity has no authenticated password-change route at all (only the reset flow). Absent means absent, not greyed out. |

---

## 5. The one test that was wrong, and what it taught

`src/app/settings/page.test.tsx` → "does not delete twice on a double submit"
failed with `expected vi.fn() to be called 1 times, but got 0 times`. The
previous attempt's diagnosis — the confirm button still disabled at click time
— was **wrong**, and the measurement is worth keeping: the button is enabled at
click time, `onConfirm` fires, and `destroyAccount` runs with `inFlight =
false`. The defect is in the test's timing: React Query's `mutateAsync` does
not call the mutationFn synchronously — the dispatch is a microtask after the
click — so a synchronous `expect` reads the call count before the first
dispatch lands and reports the guard as broken when it is the assertion that
is early. The fix is `await waitFor(...)`, with the reasoning written into the
test. The guard itself is proven by the same assertion: three clicks, one call.

---

## 6. The gate floor

`gate.yml` declares `minimum: 868` for the suite. This packet adds 45 tests
(913 total) and does NOT raise the floor. The floor is a decrease-detector, not
a budget — it catches a test being deleted, and a packet that adds tests is
not the case it exists for. Raising it is the next packet's decision, made
deliberately, with the number read out of a real run.

---

## 7. Gate output

`bin/prime` exits 0. Verbatim:

```
==> npm ci
==> npm test
 Test Files  37 passed (37)
      Tests  913 passed (913)
==> npm run typecheck
==> npm run build
==> tests/validate-ci.sh --self-test
47 checks declared, 47 passed, 0 failed, 0 skipped
self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine
```
