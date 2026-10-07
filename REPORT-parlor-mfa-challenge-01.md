# REPORT — parlor-mfa-challenge-01: the second-factor login challenge (the sign-in dead end)

Written by the session that finished this packet. Everything below was measured
or read out of a file, not assumed; each claim says which. The packet is on
`worker/parlor-w55-mfachallenge` and the gate is green (output in §5). This file
is for whoever picks up the next one.

## 0. The state this packet started from

The previous attempt died when the model endpoint failed, not on a defect, and
its work was in the tree, uncommitted. I read every file before keeping any of
it. The judgement, file by file:

**Kept, after verification against the brief and the surrounding code:** all of
it, with four exceptions noted below. The client leg (`LoginResult` as a
discriminated union, `completeSecondFactor`, the `retryAfter` field on
`IdentityError`), the forwarder entry plus the `retry-after` response header,
the login prompt with its four failure arms, the auth-context change, and the
tests are the previous attempt's and they are correct. I re-derived each
contract fact from the files the brief names (`identity/internal/httpapi/auth.go`
line references, `identity/openapi/v1.yaml:817`, `:1300-1310`) as restated in
the brief, and the partial work agreed with all of it.

**Fixed, because it was wrong or stale:**

- Four existing tests asserted the OLD contract and were updated to the new
  one, not weakened. `login` now returns a `LoginResult`, so the 200-arm
  assertion in `identity.test.ts` reads the token inside the `session` arm; the
  `acceptsLogin` stub in `page.test.tsx` resolves the union shape; and the
  response-header test in `upstream.test.ts` now sends `Retry-After` and
  asserts its value crosses, not just its name. Each update preserves what the
  test was proving — the token still lands, the header still crosses — and each
  is named in the commit message.
- Two comments had been left describing a tree that no longer exists:
  `send`'s "register and login must arrive with no Authorization header" (the
  second leg also sends none) and the social callback screen's "deliberately
  absent from the forwarder's table" (the route is forwarded now; the screen
  still cannot answer a challenge, which the comment now says honestly).

**The gate floor moved 940 → 964** (+24: 10 in `identity.test.ts`, 2 in
`upstream.test.ts`, 12 in `login/page.test.tsx`), with the account written into
`gate.yml` in the file's own convention. Six red proofs were run before the
floor moved — see §4.

## 1. What the 202 / `mfa_required` arm is, and how it is modelled

`POST /v1/session` does not always mint a session. For an account with a
confirmed second factor it answers `202 {mfa_required, challenge, expires_at}`
and sets a `__Host-mfa-challenge` cookie; the session is minted only by the
second leg, `POST /v1/session/mfa`. identity's own document says so
(`identity/openapi/v1.yaml:817`).

**The 202 is a SUCCESS, modelled as a result and not a throw.** `login` returns

```ts
type LoginResult =
  | { kind: "session"; session: Session }
  | { kind: "mfa_required"; challenge: string; expiresAt: string };
```

A discriminated union rather than a `Session` with an optional field, because
the whole risk on this route is reading the wrong one of two mutually exclusive
bodies: the 202 arm carries NO `token` — not an empty one, no field at all —
and a caller that defaulted a missing `token` to `""` would be inventing a
signed-in state the service never minted. Modelling the 202 as a failure would
also put an ordinary half-done sign-in in the same arm as a refused one, and
the login screen would render "Invalid email or password" for a person whose
password was just accepted.

**The second leg is `completeSecondFactor({ challenge, code })`, performing
`POST /v1/session/mfa` and returning `Session`.** The challenge rides in the
body even though the service also accepts the cookie: the explicit body value
wins when both are present, and a value this app sends is a value this app
controls. The call takes NO bearer token — the challenge in the body IS the
credential — so it goes through `send` with no `token` and no `Authorization`
header goes out at all, the same shape as the anonymous recovery pair. The
request body is `{challenge, code}`; `code` is either a six-digit TOTP code or
a recovery code, in one field, because the service accepts either shape.

**The forwarder carries the route.** `{ method: "POST", path: ["session",
"mfa"], upstream: "identity" }` sits in `ROUTES` beside the four MFA management
entries, which is the bar it answers to: the client can perform it and the
login screen drives it. The two doc comments that declared it deliberately
refused now say it crossed, and name the one MFA route that still has not —
`DELETE /v1/mfa`, the disable, a destructive security action with no screen
behind it. `retry-after` was added to `FORWARDED_RESPONSE_HEADERS`, for one
route and one status: the 423 lockout window is a fact about the ANSWER, and
without the header the client sees a bare 423 and the screen can only say "try
again" — which sends a person to retry forever against a lock that ignores them
for fifteen minutes.

## 2. How the prompt renders, arm by arm

The 202 swaps the password form for a code prompt — a separate form, not a
field that appears inside the password one, because the two have different
submit buttons, different failures and different things to protect. The
challenge lives in component state for the span of the prompt and is never
rendered, never stored, never logged; there is a test that asserts the page
does not contain it.

On the 200 the sign-in finishes exactly the way the password path finishes it:
`adoptSession` writes the token to the same store the login mutation writes,
which changes the query key, starts the `me` fetch and re-renders the header,
and the navigation is the same `void` push for the same reason — a failed
navigation is not a refused sign-in. The tests assert the same signed-in
outcome the password path asserts (token in the store, header signed in,
navigation home), because a second factor must not be a worse sign-in than a
password.

The honest failures, each the one thing a person needs to know from it:

- **401 — refused.** ONE sentence, "That code was not accepted.", for a wrong
  TOTP code, a spent recovery code, a code whose step was already used, a
  malformed value and a rotated-away secret alike. The service answers all five
  with the same 401 and the same body on purpose, so an attacker cannot tell
  which to keep trying; the screen reads the status and nothing else and does
  not undo that collapse by guessing. A test feeds three different service
  details and asserts the sentence is identical for all three.
- **423 — locked.** The wait from `Retry-After`, in the unit a person would
  say it in: "Too many attempts. Try again in 15 minutes." A 423 with no
  header falls back to "Too many attempts. Try again later." — null is the
  honest reading of a value that is not there, and a screen that invented a
  number would be worse than the bare sentence it replaces.
- **503 — the deployment cannot verify a second factor** (`MFA_ENCRYPTION_KEY`
  unset). "This deployment cannot verify a second factor right now. Try again
  later." Presenting it as a wrong code would send somebody to check an app
  that is producing perfectly good codes.
- **A recovery code is typed into the SAME field.** The service accepts either
  shape; a second form would be a distinction the service does not make.

The prompt is reachable without a reload (the 202 is the next step of the same
sign-in, not a new page) and abandonable: a Back button returns to the password
form with the email and password intact, because a person who cannot complete
the second factor — no phone, no recovery codes — is otherwise stuck on a page
with no exit. The challenge is abandoned, not spent, which is the honest
reading of a credential this app never presented.

## 3. What I ruled out

- **A separate recovery-code form.** The service accepts a TOTP code and a
  recovery code in one field, and `RegenerateRecoveryCodesInput` already
  follows that one-field rule. A second form would invite a caller to put the
  wrong shape in the wrong place and be told it was malformed rather than not
  accepted — and it would be a distinction the service does not make. The
  field's hint names both shapes.
- **Modelling the 202 as a thrown error.** See §1: it would put a half-done
  sign-in in the failure arm and the screen would render the wrong sentence
  for it.
- **`DELETE /v1/mfa` (the disable).** Deliberately not added. It is a
  destructive security action with no screen behind it (`FEATURE-PARITY.md`
  §7a); this packet is the login challenge only. The forwarder's comment names
  it as the one MFA route still withheld.
- **A second source of truth for the session.** The token remains the React
  Query cache key; the second leg finishes through the same `adoptSession`
  write the social path uses, so there is still one writer of "who is signed
  in".
- **Distinguishing the five 401 causes in the UI.** The service collapses them
  on purpose; the screen keeps the collapse.

## 4. Red proofs

Six, each run before the floor moved, each restored afterwards:

1. Deleting the table entry turns three tests red — the forward, the 423 relay,
   and the table-and-clients-agree walk.
2. Dropping `retry-after` from the response allow-list turns the 423 relay and
   the header-list test red.
3. Routing the 202 through the failure path (throwing instead of returning)
   turns the three login-arm tests red.
4. Rendering the challenge in the prompt turns "never renders the challenge"
   red.
5. Varying the 401 sentence by the service's detail turns "the same sentence
   for every cause" red.
6. Skipping the `adoptSession` write turns the completion, header-signed-in
   and recovery-code tests red.

## 5. The gate

`mise exec -- ./bin/prime` — exit 0. The suite reports `Tests  964 passed
(964)` across 37 files, typecheck and build clean, `47 checks declared, 47
passed, 0 failed, 0 skipped`, and the self-test's breakages all go red. The
verbatim output is in the manager's capture (`/tmp/gate2.log` on the worker
machine); the floor in `gate.yml` was raised to 964 in the same commit.

## 6. What is deliberately still not done

- **A social sign-in that lands on the challenge still cannot finish.** The
  route is forwarded and the password path's prompt drives it, but the social
  callback screen has no form to answer a challenge with; its sentence says so
  and points at the password path. That is `HANDOFF-parlor-02-social-ui.md`'s
  finding, unchanged by this packet.
- **The challenge cookie.** identity sets `__Host-mfa-challenge` on the 202 and
  the second leg accepts the challenge from the body OR the cookie. This app
  sends it in the body, which wins; the cookie is never read, never stored and
  never rendered.
