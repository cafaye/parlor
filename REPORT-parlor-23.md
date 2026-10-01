# REPORT — parlor-23: email verification, the user-facing half

Branch: `worker/parlor-23-verify-email`
Base: `33d32e0` (the merge of parlor-22, so the forgot-password patterns and
components this packet builds on are already in the tree)

## What was built

The verification surface, in three client calls and three screens, against the
three routes identity actually declares.

| Screen | Client call | Route |
| --- | --- | --- |
| `/verify-email` (ask, and ask again) | `requestEmailVerification(email)` | `POST /v1/email-verifications` |
| `/verify-email/confirm` (spend) | `redeemEmailVerification({token})` | `POST /v1/email-verifications/confirm` |
| `/register`'s created state | both, in sequence | `POST /v1/users` then the request route |
| `/login`'s new link → `/verify-email` | — | — |
| — (read by `identity.test.ts`, not yet by a screen) | `verificationStatus(token)` | `GET /v1/email-verification` |

Plus `validatePasswordResetRequest` → `validateRecoveryEmailRequest`, shared by
both request routes, because identity declares one `emailRequest` body for both
and pins with `TestTheTwoRequestRoutesAnswerIdentically` that they answer
identically.

## The three deliverables

**1. The verify-email surface.** Two routes, because a "page you land on from
a mail" and a "form you fill in" are different jobs and the reset flow already
splits them (`/reset-password` spends, `/forgot-password` asks). The token comes
from the `token` query parameter, which is what every `RECOVERY_LINK_TEMPLATE`
example in identity spells.

**2. The anti-enumeration rule, applied again.** The acceptance sentence is one
constant string that names no address, so an address with an account and one
without render byte-identically — asserted with `toBe` on the whole live region,
not two `toContain` checks, because "identical" has to mean identical rather than
"both mention an inbox". A 422 is the only failure that names a field, and only
`email`, for the shape of what was typed. A 503 gets its own sentence, because
identity checks the mailer *before* the lookup, so 503-against-202 cannot be an
oracle while "a link is on its way" with no mail coming is the sentence that
strands somebody.

**3. The stale-token state, with a way forward.** A 404 covers four cases behind
one sentinel — never existed, expired, spent, minted for another flow — and a
link with no `token` at all is a fifth that a deployment produces by pointing the
template at a path segment. Both offer a new link. Neither names any of the four,
because naming one confirms the token was once good and turns a guess into a
probe.

## Measured against a running identity

The packet asked for the full flow against a live identity, with the token
observed the way identity's own mailer test observes it. That was done: identity
built from `../identity`, its goose migrations applied to a throwaway
`postgres:17-alpine`, and `COURIER_BASE_URL` pointed at a recording stand-in that
implements the slice of courier identity's client speaks — `GET /readyz` and
`POST /v1/messages`, the shapes transcribed from `internal/courier/courier.go`.
identity's own startup log is the first fact:

```
level=INFO msg="account recovery can send email through courier" courier=http://127.0.0.1:16999
      link_template="https://parlor.example/verify-email/confirm?token={token}"
```

| Step | Call | Answer |
| --- | --- | --- |
| register | `POST /v1/users` | `201 {id, email}` |
| state before | `GET /v1/email-verification` | `200 {"email":"…","email_verified":false}` — and **no `email_verified_at` key at all** |
| request | `POST /v1/email-verifications` | `202 {"status":"accepted"}` |
| the mail courier received | `POST /v1/messages` | `{"type":"welcome","user_id":"…","to":"…","url":"https://parlor.example/verify-email/confirm?token=SdsbwirY7NQKygXMXFT09h16XLXKCkLbelL4LCWb_20"}` |
| read the link the way the page does | `new URL(url).searchParams.get("token")` | `SdsbwirY7NQKygXMXFT09h16XLXKCkLbelL4LCWb_20` |
| redeem | `POST /v1/email-verifications/confirm` | `204`, no body |
| **land verified** | `GET /v1/email-verification` | `200 {"email":"…","email_verified":true,"email_verified_at":"2026-10-02T00:51:41.16106+03:00"}` |
| the same token again | `POST /v1/email-verifications/confirm` | `404 not_found` — the stale-token state |

Three things in that table changed the code:

- **`email_verified_at` is genuinely absent before verification**, not null and
  not the epoch. The client type keeps it optional and does not invent the key;
  `identity.test.ts` asserts the key is absent off the wire *and* off the parsed
  object.
- **courier's type is `welcome`, not `email_verification`.** identity's
  `courierTypeFor` maps `verify_email` onto courier's `welcome` because courier's
  `NotificationType` has no `email_verification`. Worth knowing, since the mail a
  user receives reads "Welcome aboard", and it is why `RECOVERY_LINK_TEMPLATE`
  cannot be inferred from the message.
- **A token of the wrong length is a 404, not the 422 the document declares.**
  `{"token":"too-short"}` answers `404 not_found`, because
  `RedeemVerification` goes straight to `tokens.Live(sessions.Digest(...))` and
  `tokenRequest` validates nothing. The first draft of this packet carried a 422
  branch on the strength of `minLength: 43` in `RecoveryTokenRequest`; the live
  run disproved it, the branch is gone, and a truncated link is now one of the
  four cases behind `ErrTokenNotFound`. Recorded in CHANGELOG "Known gaps".

The enumeration properties, measured:

| Address | `POST /v1/email-verifications` |
| --- | --- |
| has an account, never verified | `202 {"status":"accepted"}` |
| no account | `202 {"status":"accepted"}` — **byte-identical** |
| has an account, already verified | `409 conflict` |
| malformed | `422 validation_failed` + `{email, invalid_format}` |
| mailer stopped, account exists | `503 service_unavailable` |
| mailer stopped, no account | `503 service_unavailable` — **byte-identical** |

## The one judgement call: the 409

`Service.RequestVerification` orders `user.IsVerified()` after the account lookup
and before the cooldown, so an address that is already proved answers 409 where
every other address answers 202. That *does* tell a prober that an address has an
account — and it is the one place the verification request route is not the
constant the reset route is.

It is rendered, not flattened. Flattening it would have been easy and would have
made the route a constant; it was rejected because identity declares the 409
deliberately, in the contract, to stop a client rendering "check your inbox" on
an address nothing will ever be sent to. Overriding a published, reasoned
contract decision to buy a stronger property here would be this client unmaking
the service's call, and the price is a person told to wait for a mail that is not
coming.

What the screen guarantees instead is that it never *widens* the disclosure:

- the 409 sentence names the state, never the address;
- it never renders the service's `detail`, which names the column and the user id;
- it is a `Callout tone="note"` (`role="status"`), not a critical alert, because an
  address that is already verified is an answer rather than something the person
  did wrong.

The 202 branch — which is the branch a stranger is actually probing, since an
unregistered address and an unverified one both answer it identically — stays
completely constant.

**DECISION NEEDED, for the manager:** whether the constant-202 defence
`requestPasswordReset` gets should extend to this route, or whether the 409 is the
intended trade. Either answer is implementable here; the current one is the one
that respects the service's published contract.

## A second service-side gap: one link template for two link kinds

Measured: `internal/courier`'s `RecoveryMailer` holds a **single**
`linkTemplate` field and renders it for both the `password_reset` and the
`verify_email` message. A reset link and a verification link therefore resolve to
the *same configured URL* with different tokens, and the mail body is courier's
`welcome` template, which says nothing about which flow the link belongs to.

So a deployment cannot route both mails correctly today: point
`RECOVERY_LINK_TEMPLATE` at `/reset-password` and every verification link lands
on a screen that answers "cannot be used"; point it at `/verify-email/confirm` and
every reset link does the same.

The fix belongs in `identity` (per-kind templates, or a landing screen that can
redeem either kind) and this repository may not edit a sibling. **DECISION
NEEDED.** What was done here instead: both landing screens exist, each offers the
right way forward for its own flow, and each behaves correctly when a deployment
points the template at it. Recorded in CHANGELOG "Known gaps".

A note on what was deliberately *not* built: a cross-flow affordance on either
stale-link state ("if you came here to reset your password…"). It would help
exactly one configuration, it makes each screen's purpose muddy, and it is
guesswork about a configuration a deployment may never choose. Reporting the gap
is the honest move; papering over it client-side would hide a decision that is
not this app's.

## Tests

**623 unit tests, up from 554.** `bin/prime` exits 0. Every new test was written
before its implementation and watched fail; the one test that was wrong (an
assertion that `"email_verified_at" in status` should be `true`, when the
stronger and correct property is that the key is *absent*) was fixed rather than
the implementation bent to match it. The signed-in branch of the confirmation
screen was verified by breaking `signedIn = session.status === "authed"` to
`false` and watching exactly the two tests that cover it go red.

| File | What it holds |
| --- | --- |
| `src/lib/identity.test.ts` (+16) | The three routes: URLs, bodies, the no-`Authorization`-header rule on the two anonymous POSTs, the absent timestamp, the 409, the 404, and the measured length/404 finding |
| `src/lib/credentials.test.ts` (+2) | One validator for both request routes, and that it does nothing about whether an address has an account |
| `src/app/verify-email/page.test.tsx` (+16) | The anti-enumeration property, the 409, the 503, the 422, a network failure, and the form being replaced |
| `src/app/verify-email/confirm/page.test.tsx` (+20) | No redeem on load, the 204 destination for both session states, the stale-token state, the missing token, the truncated token, a network failure, and the token never entering the rendered page |
| `src/app/register/page.test.tsx` (+16) | The second call, and that no failure of it can un-say "account created" |
| `src/app/login/page.test.tsx` (+2) | The affordance, and that it says nothing about the address |

**23 end-to-end tests, up from 17.** `./bin/e2e` exits 0, whole stack, real
identity over HTTP. The six new ones cover the 503 that a courier-less
deployment must not dress as a sent mail, a real 404 for a token nobody minted,
the link with no code in it, the register screen refusing to un-say that the
account was created, the sign-in affordance, and the byte-identical rendering of
a request for an address with an account and one without.

Three pre-existing specs failed on the first run and all three were my
regression: two of them assert the register screen's confirmation text, and
parlor-22's copy changed. Rather than delete those assertions, the created-state
sentence was changed to carry the address in **every** branch — "Account created
for {email}." leads it whether or not the mail request succeeded. That is
consistent with the asymmetry this packet establishes (name an address you just
created, never one you were handed) and it preserves what those specs actually
prove: that `POST /v1/users` reached a real service and a real database.

## The gate declaration, and an inherited defect

Raising `minimum:` in `gate.yml` is half of a rule the repository enforces in two
places. `tests/gate-declaration-self-test.sh` holds a second copy of every floor
in its stand-in gates, its control 3 compares the two files statically, and its
fixtures are byte-for-byte transcriptions of a real green run — so a floor that
moves without the fixtures being re-captured turns every green-expecting case red
for a reason that has nothing to do with the pattern under test.

**This was already broken before this packet.** At `33d32e0`, `gate.yml` declared
`554` and the self-test mentioned only `377`, so control 3 and the `colour-green`
canary were both red on arrival — verified against `git show HEAD:` rather than
assumed. Fixed here rather than worked around: the floors are now `623`/`35`/`34`
in both files, the fixtures are re-captured from a real `FORCE_COLOR=1` run of
this repository's own gate (`Tests  623 passed (623)`, `Test Files  26 passed
(26)`), and `bash tests/gate-declaration-self-test.sh` exits 0 with all 34
breakages red and both controls green — including the control under colour, which
is the one that would go red if `core` stopped stripping ANSI.

Two things that were found on the way and are worth naming, because both would
have been silent:

- **`git ls-files` lists tracked files only**, so the self-test's sandbox is
  missing any untracked new file. Unstaged, it reported 587 tests (623 minus the
  36 in the two new files) and its controls went red for a reason that had nothing
  to do with anything. New files have to be staged before that self-test means
  anything.
- The self-test is deliberately **not** in `bin/prime` (it runs the whole gate per
  case and needs `core` beside the repository), so a green `bin/prime` does not
  cover it. Run it by hand when a floor moves.

## Not built, and why

- **A signed-in "your address is not verified" banner.** `/v1/me` projects exactly
  `id` and `email`, so that state needs `GET /v1/email-verification`, which is
  session-only — it can only be reached by somebody already signed in. That is why
  the verification entry point is a *link from `/login`* rather than a banner: a
  banner cannot be seen by the person who most needs it, having signed up and
  closed the tab. Reading the state into the account screen is the next packet.
  `verificationStatus` is in the client and covered by tests so that packet has
  it waiting.
- **The email-change surface.** `/v1/email-changes` needs settings screens that do
  not exist, and identity answers 503 on it until courier's vocabulary grows.
- **Courier in the end-to-end stack.** `e2e/docker-compose.yml` names courier as
  one of the services it does not have yet, and adding it plus a mail-capture
  service to a topology file that says "READ THIS BEFORE ADDING A SERVICE" is a
  harness decision, not a packet one. So the completed verification is *not* in
  the e2e tier, for the same reason the completed password reset is not: a real
  token needs a real mail. It was proven by hand instead, against a running
  identity, as the table above records — which is a weaker guarantee than a spec
  that runs every time, and the honest description of that is a gap rather than a
  result.
- **`/v1/email-changes`**, and every other identity screen that has no state to
  render from.

## The rule for the next packet

The verification surface's own rule, which is the one worth carrying: **a screen
may name an address it just created, and never one it was handed.** `/register`
echoes back what was typed thirty seconds ago and the service has just made a row
for it; `/verify-email` is reachable by a stranger who typed somebody else's. Both
rules are the same rule, which is why they live in one file's header rather than
being rediscovered as two.