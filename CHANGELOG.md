# Changelog

All notable changes to parlor are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `.github/workflows/ci.yml` — three jobs. `ci` calls kit's reusable workflow
  at `cafaye/kit/.github/workflows/ci.reusable.yml@master` with
  `language: node`, so the shared install/lint/test contract lands here
  without a copy. `prime` runs `./bin/prime` — the command a developer runs —
  and then `git diff --exit-code -- package-lock.json`. `build` deletes
  `.next`, runs `npm run typecheck`, runs `npm run build` with the two
  build-time `NEXT_PUBLIC_*` values set, and asserts that
  `.next/standalone/server.js` and `.next/BUILD_ID` exist, because those are
  what the Dockerfile copies and nothing else notices when they are missing.
- `tests/validate-ci.sh` — the half of the gate that checks the gate. Eighteen
  checks over the runtime pin, the lockfile contract, the gate command, the
  npm scripts the workflow calls, and the agreement between `package.json`,
  `mise.toml`, the workflow and `cafaye.yml`. `--self-test` breaks a
  throwaway copy 15 ways and asserts each one goes red, plus the opposite
  case: a comment that merely *mentions* `npm install` must not fail the check
  that forbids it. It reads the workflow as text with anchored greps, so it
  needs no PyYAML, no yq and no jq.
- The runtime pin, in `package.json`: `engines.node` 22.22.2 and
  `packageManager` npm@10.9.7. There was no `engines` and no `packageManager`
  before, so nothing in the repository pinned the runtime — `mise.toml` did,
  but mise is a workstation tool and a CI runner never reads it. The same
  `npm ci` on the machine this was written on ran on Node 22.12.0 one directory
  away from the pin.
- `.npmrc` with `engine-strict=true`, so the pin is a gate. Verified both ways
  on a throwaway package: with it, `npm ci` exits nonzero (`npm error engine
  Unsupported engine … Required: {"node":"99.0.0"} / Actual: {…,"node":"v12.0.0"}`);
  without it, the same command prints `npm warn EBADENGINE` and installs.
- `bin/prime` gained a third command, `bash tests/validate-ci.sh
  --self-test`. It was `npm ci` then `npm test`. A developer running the gate
  should get the same three checks CI does; otherwise the CI half is a variant,
  and a variant is the thing this removes. The two original commands are
  unchanged and still the reproduction check.

### Changed

- `mise.toml` — no version changed. A comment now says it mirrors
  `package.json` and that the gate fails when the two disagree.
- `README.md` and `AGENTS.md` — the pin is described as living in
  `package.json` with three mirrors rather than as living in `mise.toml`, and
  both gained a CI section. The old AGENTS.md line said "Node is pinned in
  `mise.toml` … do not add a second pin", which was true when written and
  wrong the moment the pin had to be readable by npm and by CI.

- `src/lib/roles.ts` — the role vocabulary and the capability matrix, transcribed
  from identity's tenancy authorization: the order and the three names from
  `AllRoles` and `Role.AtLeast`, the matrix from `registerTenancyRoutes`, and the
  rule that splits inviting a member (admin) from handing out admin (owner) from
  `Service.InviteRole`. Plus a mirror of the service's `Slugify` and
  `ValidateName`, so a name that cannot make a handle is refused before a round
  trip. The service is the authority; this is a copy, and a reason not to offer a
  button rather than a reason to believe it would work.
- The tenancy surface on `src/lib/identity.ts` — the ten account routes:
  `POST`/`GET /v1/accounts`, `GET`/`PATCH`/`DELETE /v1/accounts/{id}`,
  `GET /v1/accounts/{id}/members`, `POST /v1/accounts/{id}/invitations`,
  `POST /v1/invitations/accept`, and
  `PATCH`/`DELETE /v1/accounts/{id}/members/{userId}`. Shapes are transcribed
  from the service's handler, not from its OpenAPI document — see "Known gaps".
- `src/lib/accounts.ts` — React Query bindings for the tenancy surface. The token
  is part of every query key, and the overlapping invalidation sets live in one
  place. `retry: false` throughout: the screens each render an explicit retry,
  and a 401/403/404/409/410/422 is the service's answer rather than a hiccup.
- `/accounts` — the accounts you belong to, and the create form. The one
  conflict `POST /v1/accounts` declares (the derived handle is taken) is placed
  on the name field, because the handle is derived from the name.
- `/accounts/[accountId]` — facts, the member panel, rename, invite, leave and
  delete. A control is offered only when the service's role table permits it: an
  admin is offered neither a rename-forbidden nor an "invite another admin"
  option, and an owner is offered neither "leave" nor a usable "remove" on
  themselves, because the service will refuse both.
- `/invitations/[token]` — redeeming an invitation, with the three answers the
  service separates kept apart: 404 unrecognised, 410 no longer usable, 409
  already a member. It does not accept on load, because the token travels in the
  URL and an email preview or a link scanner would otherwise join somebody to a
  workspace they never opened. `robots: noindex, nofollow`, since a one-time
  token in a URL is a credential.
- `src/lib/money.ts` — integer minor units in, a price out. The currency's
  exponent is read from the platform's own data through `Intl`, so 1900 minor
  units is $19.00 in USD, ¥1,900 in JPY and 12.345 KWD is not 123.45. It is the
  only division in the codebase and the last one before a number reaches a person.
- `src/lib/billing.ts` — a typed client for the five billing endpoints the
  contract declares, with its own `BillingError` because billing is a separate
  service. `POST /v1/customers` sends an `Idempotency-Key`, which the contract
  asks the client to choose. Cursors are passed back verbatim and never parsed.
- `/billing/plans` — the plan catalogue, with real cursor paging that
  accumulates. It offers nothing to buy, and says in its framing sentence that
  billing does not record a current plan, because there is no
  `/v1/subscriptions` on master.
- `/billing/customers` — billing's customer records, labelled as the whole
  platform's list, because the service scopes this collection by nothing.
- `src/components/ui/state.tsx` — `LoadingState`, `ErrorState`, `EmptyState`,
  `Panel`, `RoleBadge` and `DescriptionList`. `Panel` takes a required
  `headingId`, because a region with no accessible name is a dead end in the
  landmarks list.
- `src/components/ui/select.tsx` — a native `<select>`, so the role picker gets
  keyboard behaviour and the right thing on a phone without a hand-rolled
  listbox. `Field` accepts it, so no call site hand-wires `aria-describedby`.
- Header navigation. The plan catalogue is offered to a signed-out visitor
  because it is the one screen that needs no account; the accounts list is not,
  because it would be a dead end.

### Known gaps

These are gaps in the *services*, found while building against them. Each one is
recorded so it is not rediscovered from a UI symptom.

- **`identity/openapi/v1.yaml` does not describe the tenancy surface.** The
  document was last changed before the packet that added the implementation was
  merged, so `POST /v1/accounts` and its nine siblings exist in the service, in
  its routes and in its authorization tests, and not in the published contract.
  The client is written against the handler, which is the stricter authority, but
  it is the client half of a contract nobody has written down. A draft document
  exists on the `worker/identity-04-contract` branch; merging it is the fix.
- **A member list carries no member identity.** `membershipResponses` builds each
  row as `{Role: m.Role}` and `MemberSummary` carries no user id to copy, so
  `GET /v1/accounts/{id}/members` returns rows with an empty `user_id` and a
  zero `created_at` — and the per-member routes have nothing to address. The
  member panel says so and shows the role distribution, and the per-member
  controls render the moment an id is present.
- **billing declares no authentication.** `security: []`, no `securitySchemes`,
  and the service's own header records it as a gap: `GET /v1/customers` "returns
  every customer, because there is no account to scope it by". `/billing/customers`
  is therefore labelled as a platform-wide list rather than a personal one, and
  no identity session token is sent to billing.
- **No subscription surface exists.** billing's master contract has no
  `/v1/subscriptions*` and `Customer` has no plan field, so "you are on X",
  upgrade, downgrade, cancel and the five subscription states cannot be built.
  This is `parlor-04`, once billing-04's contract is merged.
- **No `GET /v1/invitations/{token}`.** An invitation cannot be read before it is
  redeemed, so the accept page cannot show which account the invitation is for,
  who sent it or what role it grants. It says so rather than implying it knows.
- **410 conflates two states.** The service maps both an expired invitation and
  an already-accepted one to 410 with the code `gone`, separated only by prose in
  `detail`. The accept page renders one state for both, which is all the status
  supports.

### Changed

- `src/lib/identity.ts` — a typed client for the four identity endpoints fixed by
  contract: `POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`,
  `GET /v1/me`. Base URL from `NEXT_PUBLIC_IDENTITY_URL`, defaulting to
  `http://localhost:8080`. The transport is a parameter, so tests inject a
  stub and the browser gets `fetch`; there is no msw and no request
  interception. Failures arrive as an `IdentityError` carrying the status, the
  reserved `code`, the `trace_id`, and the per-field `{field, code}` list from a
  422 — read from RFC 9457 problem+json, or from the `{error:{…}}` envelope the
  identity-02 brief describes, since the two disagree and neither has shipped.
- `src/lib/token-store.ts` — the session token in `localStorage` under
  `parlor.session.token`, with a subscribe hook for React. A value that does not
  parse reads as signed out rather than throwing.
- `src/lib/auth.tsx` — session state. The token is the React Query cache key
  (`["session", token]`), so a cached user can never be served to a different
  session than the one it was fetched for. A 401 forgets the token; a failure
  that is not a 401 leaves it and reads as signed out.
- `src/app/providers.tsx` — the provider stack (React Query, then auth),
  mounted once from `layout.tsx`. Both the identity client and the token store
  are injectable.
- `/register` — email and password, local validation before the request, and a
  422 placed on the field it belongs to. A 409 says the address is taken, which
  is the one place the answer is safe to give. On success the account is
  confirmed and the password leaves the screen; nothing signs anyone in, because
  `POST /v1/users` returns no token.
- `/login` — the same two fields, and one generic sentence for every refused
  sign in. A wrong password and an unknown address produce byte-identical
  output, and neither is reported on a field, so the screen cannot be used to
  find out who has an account. A service failure does not borrow that sentence:
  it says something went wrong rather than sending someone to reset a password
  that was fine.
- `src/components/shell/header.tsx` — the session-aware shell. Signed in: the
  address and a sign out control. Signed out: sign in and create account. While
  a stored token is being exchanged it renders neither, so a reload does not
  paint a sign-in link over a live session (verified against the prerendered
  HTML, which contains neither state).
- `src/components/ui/{button,input,field}.tsx` — hand-rolled primitives in
  shadcn's shape, one per file, exported from the existing barrel. `Field` owns
  the label/description/invalid wiring so a call site cannot get it half right.
  Every colour is a token from `src/styles/tokens.css`.
- `@tanstack/react-query` as a runtime dependency (the only one this packet
  adds).

### Changed

- `layout.tsx` mounts `Providers` and the shell header above the route content.
- `src/test/setup.ts` clears `localStorage` after every test. The token is read
  synchronously on render, and one test's session leaking into the next would
  make an auth suite pass for the wrong reason.

### Notes for the next packet

- The session token lives in `localStorage` because the cookie identity sets is
  `HttpOnly` and unreachable from the browser bundle. A BFF route in front of
  identity reverses this and makes the cookie the only authority. See README,
  "Sessions".
- No CORS headers, no cookie proxying, no CSRF token: the browser talks to
  identity directly, and that is a later packet.
