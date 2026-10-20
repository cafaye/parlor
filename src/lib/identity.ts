/**
 * Typed client for the identity service.
 *
 * The endpoints this file speaks are fixed by contract:
 *
 *   POST   /v1/users     201 {id,email} | 422 | 409
 *     carrying the `{timestamp, signature}` pair `POST /v1/signup-timestamp`
 *     mints (200, public and unauthenticated, exactly as registration is) —
 *     a missing, forged, instant or expired pair is refused with the same
 *     generic 422 before any row is created
 *   POST   /v1/session  200 {token,expires_at} | 202 {mfa_required,challenge,expires_at} | 401
 *   POST   /v1/session/mfa  200 {token,expires_at} | 401 | 423 | 503
 *   DELETE /v1/session  204
 *   GET    /v1/me        200 {id,email,display_name?} | 401
 *   PATCH  /v1/me        200 {id,email,display_name?} | 422 | 401
 *   DELETE /v1/me        204 | 401 | 409
 *   GET    /v1/sessions  200 {sessions:[SessionSummary]} | 401 | 403
 *   DELETE /v1/sessions/{session_id}  204 | 401 | 403 | 404
 *
 * plus the two password-reset routes below, the tenancy surface the same
 * service exposes under /v1/accounts and /v1/invitations, the four MFA routes
 * under /v1/mfa, and the two social routes under /v1/auth/oauth — which are
 * the only two whose request is made by the browser rather than by this
 * client. See "The tenancy surface" below for where the tenancy shapes come
 * from, which is not the place you would expect; the social and MFA shapes
 * come from `identity/openapi/v1.yaml`, which does describe them.
 *
 * Two decisions are worth stating up front, because both will look like
 * accidents otherwise.
 *
 * 1. Errors are parsed from RFC 9457 problem+json, as `core` requires every
 *    cafaye service to answer (core/docs/openapi-conventions.md). The brief
 *    for identity-02 writes the failure body as `{error:{…}}`, which is a
 *    different shape for the same thing. Until the manager picks one, both are
 *    read and both produce the same `IdentityError`. See `parseError`.
 *
 * 2. The transport is a parameter, not `fetch`. Every caller in this repo
 *    injects one — a stub in tests, the real one in the browser — so a test
 *    can never reach the network by accident, and the BFF proxy is a
 *    different transport rather than a rewrite of every screen.
 *
 * 3. The base URL is the app's OWN ORIGIN, and it is a constant rather than a
 *    variable. The browser used to call identity directly, at an address the
 *    build substituted into the client bundle — `NEXT_PUBLIC_IDENTITY_URL`,
 *    inlined by `next build`, neither of which this repository runs any more —
 *    and identity serves no CORS headers, so a deployed sign-in could not
 *    complete. `src/app/v1/[...path]/route.ts` now forwards the same paths
 *    to identity from the server, and every URL in this file is relative to this
 *    origin. The address of identity is a server-only variable
 *    (`process.env.IDENTITY_URL`) and is not in this bundle at all: a value the
 *    browser can read is a value the browser can change, and for a forwarder
 *    that is the difference between a fixed destination and an attacker's.
 *
 *    The substitution that would put it there does not exist in this build.
 *    `package.json` `scripts.build` is `vite build`, whose only route to a
 *    variable in client code is `import.meta.env` — its `VITE_` prefix by
 *    default — plus whatever a `define` in the config names. `vite.config.mts`
 *    declares neither, and `grep -rn "import.meta.env" src/` is empty.
 */

import { MAX_NAME_LENGTH, type Role } from "@/lib/roles";

/**
 * The origin every call in this file is made against.
 *
 * The empty string, deliberately: a relative URL resolved by `fetch` against the
 * document is same-origin by construction, and there is nothing in the bundle
 * that could say otherwise. The previous value was a compile-time constant read
 * from the environment, which is a place a deployment mistake becomes a runtime
 * failure nobody can see — a wrong build arg produces a page that loads, builds
 * and renders its generic error rather than a build error.
 */
export const IDENTITY_BASE_URL = "";

/**
 * Client-side mirror of `users.MinPasswordLength` in the identity service.
 *
 * This exists so a person is told the rule before a round trip, not instead of
 * one. The service is the authority: if the two ever disagree, the service is
 * right and this constant is the bug.
 */
export const MIN_PASSWORD_LENGTH = 8;

export type Credentials = { email: string; password: string };

/**
 * A minted signup timestamp pair, as `POST /v1/signup-timestamp` answers it.
 *
 * Transcribed from `SignupTimestamp` in `identity/openapi/v1.yaml` and the
 * `signup.Pair` it renders. `timestamp` is a Unix integer in seconds — the
 * signature is over the exact bytes of its decimal string, so the message has
 * exactly one canonical form — and `signature` is the base64url (no padding)
 * HMAC-SHA256 over it, keyed with a server secret this app never holds. The
 * pair is a bearer credential with a one-hour window: a timestamp younger
 * than two seconds is refused as bot-like, because a person needs seconds to
 * fill a form and a bot submits instantly.
 */
export type SignupTimestamp = { timestamp: number; signature: string };

/**
 * The body of `POST /v1/users`.
 *
 * The credentials plus the minted pair plus the request-only honeypot.
 * Identity verifies the pair after the honeypot check and before any row is
 * created, and every rejection — forged, instant, expired, future, or simply
 * absent — is the same generic 422, so a registration that does not carry one
 * cannot succeed against a live service.
 *
 * `website` is the honeypot field: the register form renders it empty, a
 * person never fills it, and a non-empty value is refused with the same
 * generic 422 before any row is created. An OMITTED trap is not refused —
 * the service defaults it to empty, and a direct `POST /v1/users` with a
 * valid pair and no `website` answers 201 — so this is hardening rather
 * than the fix for any observed failure. It is request-only — no response in
 * this file carries it — and deliberately absent from the OpenAPI document, a
 * honeypot that is documented is one the next bot skips. It is REQUIRED here
 * rather than optional so no caller can send a body the form never would:
 * every registration this app makes carries the trap, empty for a person.
 */
export type Registration = Credentials & SignupTimestamp & { website: string };

/**
 * The authenticated user, as `GET /v1/me` and `PATCH /v1/me` answer it.
 *
 * `display_name` is OPTIONAL and its absence is the whole fact: identity omits
 * the field rather than sending `null` when no name is set, so "no name" and
 * "a name this service has never heard of" are the same answer and a client
 * cannot tell a user with no name from a user whose name was never asked for.
 * A client that defaulted it to `""` would be inventing a value the service
 * never sent.
 */
export type User = { id: string; email: string; display_name?: string };
export type Session = { token: string; expires_at: string };

/**
 * What `POST /v1/session` can answer: a session, or a second factor owed.
 *
 * A DISCRIMINATED union rather than a `Session` with an optional field, because
 * the whole risk on this route is reading the wrong one of two mutually
 * exclusive bodies. The 202 arm carries NO `token` — not an empty one, no
 * field at all — and a caller that defaulted a missing `token` to `""` would
 * be inventing a signed-in state the service never minted. `kind` makes the
 * caller state which it got.
 *
 * The 202 is a SUCCESS rather than a thrown error, and that is the service's
 * own stance: 202 means "accepted for processing", the credentials were correct
 * and the authentication is not finished. Modelling it as a failure would put
 * an ordinary half-done sign-in in the same arm as a refused one, and the
 * login screen would render "Invalid email or password" for a person whose
 * password was just accepted.
 */
export type LoginResult =
  | { kind: "session"; session: Session }
  | { kind: "mfa_required"; challenge: string; expiresAt: string };

/**
 * The body of `POST /v1/session/mfa`.
 *
 * `challenge` is sent in the body even though the service also accepts it in
 * the `__Host-mfa-challenge` cookie: the explicit body value wins when both
 * are present, and a value this app sends is a value this app controls rather
 * than one a browser's cookie jar happens to hold.
 *
 * `code` is either a six-digit TOTP code or a recovery code in the
 * `XXXX-XXXX-XXXX-XXXX` form. One field, because the service accepts either
 * shape and a second field would invite a caller to put the wrong shape in the
 * wrong place and be told it was malformed rather than not accepted — the same
 * one-field rule `RegenerateRecoveryCodesInput` follows.
 */
export type CompleteSecondFactorInput = { challenge: string; code: string };

/**
 * Client-side mirror of the `display_name` bound in `PATCH /v1/me`'s request
 * schema (`maxLength: 64` in `identity/openapi/v1.yaml`).
 *
 * The same trade as `MIN_PASSWORD_LENGTH`: the bound is here so a person is
 * told the rule before a round trip, not instead of one. The service is the
 * authority — the 422 path below still handles a refusal, and if the two ever
 * disagree the service is right and this constant is the bug.
 */
export const MAX_DISPLAY_NAME_LENGTH = 64;

/**
 * One entry of `GET /v1/sessions` — a session the caller can recognise.
 *
 * Transcribed from `SessionSummary` in `identity/openapi/v1.yaml`. The four
 * facts a person needs are when it started, when it dies, what it presented
 * and from where, plus the row's id. **Nothing here is a credential**: there is
 * no `token` and no digest of one, because a digest is one SHA-256 away from a
 * live session and would make anybody holding a log of this response a holder
 * of one.
 *
 * `user_agent` and `ip` are evidence, not identity — both are caller-supplied
 * or best-effort, and behind a proxy `ip` is frequently the proxy's address.
 * They are rendered raw and unparsed: a device label this app invents is a
 * label that can be wrong, and React escapes the text, which is the whole of
 * the untrusted-header defence at this layer.
 *
 * `current` marks the session the listing request arrived on. It is the one
 * field a client cannot compute for itself — the browser holds a cookie and
 * this is a list of row ids — and it is what lets a screen say "this device"
 * without asking the user to guess which row is theirs.
 */
export type SessionSummary = {
  id: string;
  created_at: string;
  expires_at: string;
  user_agent: string;
  ip: string;
  current: boolean;
};

/**
 * The 200 from `GET /v1/sessions`.
 *
 * An object with a named field rather than a bare array, so a `total` or a
 * cursor can be added later without a second breaking change. Empty is
 * `{"sessions": []}` and never `null`, and expired rows are omitted — every
 * entry is a credential that still works and a button that does something.
 */
export type SessionList = { sessions: SessionSummary[] };

// ---------------------------------------------------------------------------
// The tenancy surface
//
// These shapes are transcribed from the service's own handler — the `json:` tags
// on accountResponse, accountListItem, membershipResponse, invitationResponse
// and the five request bodies in `identity/internal/httpapi/accounts.go` — and
// the status codes from its `registerTenancyRoutes` and `writeTenancyError`.
//
// They are NOT transcribed from `identity/openapi/v1.yaml`, because that
// document does not describe any of them. The document was last changed before
// the packet that added the tenancy implementation was merged, so the routes
// exist in the service and in its tests but not in the published contract. The
// handler is the stricter authority anyway — a struct tag is the wire, and a
// document is a description of one — but the gap is real and is the first thing
// that should be closed on the service side. Until it is, this file is the
// client half of a contract that has not been written down yet.
// ---------------------------------------------------------------------------

/**
 * An account, as the caller sees it.
 *
 * `role` is the CALLER's role in this account and not a property of the
 * account, which is why it travels on every response: without it a client
 * cannot decide whether to render a settings form, and answering that needs a
 * round trip for a value the authorization layer has already resolved.
 */
export type Account = {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  role: Role;
  created_at: string;
  updated_at: string;
};

/**
 * The account detail response.
 *
 * `members` is `omitempty` on the wire and absent on a list, and the absence is
 * meaningful: an empty list and no list are different answers, so this is
 * optional rather than defaulted to `[]`.
 */
export type AccountDetail = Account & { members?: Membership[] };

/**
 * One row of `GET /v1/accounts`.
 *
 * Its own type rather than a trimmed `Account`, because the service sends
 * neither `members` nor `updated_at` here and a list is "a navigation aid
 * carrying the minimum a client needs to render a row and open it".
 */
export type AccountListItem = {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  role: Role;
  created_at: string;
};

/** A membership: an account, a user, and a role. */
export type Membership = {
  account_id: string;
  user_id: string;
  role: Role;
  created_at: string;
};

/**
 * The member panel's response.
 *
 * A wrapper rather than an array so a client rendering the panel knows the
 * caller's own role without a third request.
 */
export type MemberList = { memberships: Membership[]; role: Role };

/**
 * A pending invitation, and on creation its one-time token.
 *
 * `token` appears here and nowhere else: there is no endpoint that re-reads it
 * and no column that stores it, only its digest. It is returned because until
 * courier exists, returning it is the only way an invitation can be delivered
 * at all. Nothing here may store it.
 */
export type Invitation = {
  id: string;
  account_id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  created_at: string;
};

/** One `{field, code}` pair out of a 422. The codes are contract vocabulary. */
export type FieldError = { field: string; code: string };

export type TransportRequest = {
  url: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  body?: string;
};

export type Transport = (request: TransportRequest) => Promise<Response>;

/**
 * The one client every screen in this app talks to, and one of two things about
 * it that are decisions rather than defaults.
 *
 * 1. **Property declarations, not method shorthand.** `register(input):
 *    Promise<User>` reads to TypeScript as a method with an implicit `this`,
 *    and then `const { register } = useAuth()` or a test's
 *    `expect(identity.register)` is a method separated from its object — which
 *    `@typescript-eslint/unbound-method` rejects, and rightly in general,
 *    because a method that reads `this` and is called detached fails. These do
 *    not read `this`: `createIdentityClient` below returns them from an object
 *    literal of arrow functions closing over `transport` and `base`, so there
 *    is no object for a `this` to belong to. The method spelling asserts a
 *    binding that does not exist; this one states the truth and is the same
 *    type at run time.
 *
 * 2. **No `this` is not the same as no contract.** Every member is still a
 *    required, fully-typed call — a screen that reaches for `identity.me` is
 *    reaching for exactly one thing, with the credential as its first
 *    argument, which is the tenancy rule the service enforces.
 */
export type IdentityClient = {
  /**
   * Mint a signed signup timestamp pair for the registration form.
   *
   * `POST /v1/signup-timestamp` takes no body and no credential — public and
   * unauthenticated, exactly as `POST /v1/users` is — and answers
   * `{timestamp, signature}`. It is called when the form renders rather than
   * when it submits, because a pair younger than two seconds is refused and a
   * mint-then-submit in one breath would always be one.
   */
  mintSignupTimestamp: () => Promise<SignupTimestamp>;
  register: (input: Registration) => Promise<User>;
  /**
   * The first leg of a sign in, which is sometimes the whole of one.
   *
   * A 200 mints a session. A 202 means the credentials were accepted and a
   * second factor is owed — it mints nothing and sets the `__Host-mfa-challenge`
   * cookie — so the answer is a `LoginResult` rather than a bare `Session`: a
   * caller that read `token` off every successful sign-in would find nothing on
   * the 202 arm, and "nothing" is the one answer that must never render as a
   * signed-in state. See `LoginResult` for the two arms.
   */
  login: (credentials: Credentials) => Promise<LoginResult>;
  logout: (token: string) => Promise<void>;
  me: (token: string) => Promise<User>;

  // ---------------------------------------------------------------------------
  // The display-name surface — one route, and its omitted field is a verb.
  //
  // `PATCH /v1/me` sets OR clears the name, and the two are the same request:
  // an empty string and an omitted `display_name` decode the same way, so there
  // is no "leave it unchanged" to express. A caller here is always saying
  // "this is my name now", and the two things they can mean are "this" and
  // "nothing". The input type therefore carries a REQUIRED `display_name`:
  // a method that took `{ display_name?: string }` would be offering a
  // third answer the route does not have, and a screen would find itself
  // unable to say which of the two it meant.
  //
  // The 200 carries the user with the name just written, so a screen that
  // renders from the response cannot be shown a stale value on the request
  // that changed it.
  // ---------------------------------------------------------------------------
  updateMyDisplayName: (token: string, input: { display_name: string }) => Promise<User>;

  // ---------------------------------------------------------------------------
  // The sessions surface — a list and a per-row revoke.
  //
  // `listSessions` answers the caller's LIVE sessions, newest first, with
  // never a token. `revokeSession` ends one and is refused with a single 404
  // for all four ways of not owning it — never existed, somebody else's,
  // already revoked, an id this service did not issue — because a 403 against
  // a 404 would let a signed-in caller probe whether a session id belongs to
  // a live session anywhere in the deployment.
  //
  // REVOKING THE SESSION YOU ARE USING IS ALLOWED, and the consequence is that
  // you are signed out: the 204 sets no `Set-Cookie`, so the browser keeps
  // whatever cookie it has and the next request with that credential is a 401.
  // A screen that revokes its own current session must therefore clear the
  // local half itself — the service deliberately does not do it for them.
  // ---------------------------------------------------------------------------
  listSessions: (token: string) => Promise<SessionList>;
  revokeSession: (token: string, sessionId: string) => Promise<void>;

  // ---------------------------------------------------------------------------
  // Account self-deletion — `DELETE /v1/me`, the one route that ends the caller.
  //
  // The 204 has no body and no `Content-Type`: the resource is gone, and there is
  // nothing to describe. Every credential is ended in the same transaction, so a
  // screen that succeeds must clear the local half itself — the token in
  // `localStorage` is dead the moment the 204 lands, and the next request with it
  // is a 401.
  //
  // The 409 is the one answer that is not constant: a caller who is the SOLE
  // owner of a team account is refused, and the problem document's `detail` names
  // each account by name and slug precisely so the caller can act. A team account
  // the caller merely belongs to never blocks them. The detail is the service's
  // own user-facing sentence — not an internal code, host or port — so a screen
  // renders it rather than flattening it.
  // ---------------------------------------------------------------------------
  deleteMyAccount: (token: string) => Promise<void>;

  // The tenancy surface. Every one of these takes the session token, because
  // every account route resolves a session before it does anything else, and
  // the token doubles as the path segment's authority: a call without it is a
  // 401 rather than a 403.
  listAccounts: (token: string) => Promise<AccountListItem[]>;
  createAccount: (token: string, input: { name: string }) => Promise<Account>;
  getAccount: (token: string, accountId: string) => Promise<AccountDetail>;
  renameAccount: (token: string, accountId: string, input: { name: string }) => Promise<Account>;
  deleteAccount: (token: string, accountId: string) => Promise<void>;
  listMembers: (token: string, accountId: string) => Promise<MemberList>;
  inviteMember: (
    token: string,
    accountId: string,
    input: { email: string; role: Role },
  ) => Promise<Invitation>;
  acceptInvitation: (token: string, input: { token: string }) => Promise<Membership>;
  changeMemberRole: (
    token: string,
    accountId: string,
    userId: string,
    input: { role: Role },
  ) => Promise<Membership>;
  removeMember: (token: string, accountId: string, userId: string) => Promise<void>;

  // ---------------------------------------------------------------------------
  // The recovery surface — see the wiring below for why neither takes a token.
  //
  // `requestPasswordReset` answers 202 for every address and returns the
  // service's constant `{"status":"accepted"}`, which is the entire
  // account-enumeration defence on that route. `redeemPasswordReset` answers 204
  // with no body, revokes every session and access token the account holds, and
  // mints nothing: a caller who redeems a reset is signed out by the same write
  // that changed the password. Both facts are load-bearing for the screens.
  // ---------------------------------------------------------------------------
  requestPasswordReset: (email: string) => Promise<RecoveryAccepted>;
  redeemPasswordReset: (input: RedeemPasswordResetInput) => Promise<void>;

  // ---------------------------------------------------------------------------
  // The verification surface, which is three routes rather than two and whose
  // enumeration stance is NOT the same as the reset surface's.
  //
  // `requestEmailVerification` answers the same constant 202 as
  // `requestPasswordReset` for an address with an account, one without, and one
  // inside the cooldown — with ONE declared exception, a 409 for an address that
  // is already proved. That 409 is the service's own stated trade (see
  // `RequestVerification`), so this client surfaces it rather than flattening it
  // into the acceptance answer.
  //
  // `redeemEmailVerification` answers 204 and, unlike the reset redemption,
  // revokes nothing and mints nothing: a verification is a fact about an address,
  // not a change of credential. Nobody is signed out by it and nobody is signed in.
  //
  // `verificationStatus` is the ONE route here that takes the token, because it
  // is the only one that answers a question about the caller rather than about a
  // token they were handed.
  // ---------------------------------------------------------------------------
  requestEmailVerification: (email: string) => Promise<RecoveryAccepted>;
  redeemEmailVerification: (input: RedeemVerificationInput) => Promise<void>;
  verificationStatus: (token: string) => Promise<VerificationStatus>;

  // ---------------------------------------------------------------------------
  // The social surface — two routes, and NEITHER ONE IS AN ORDINARY XHR.
  //
  // These are the only two operations in this file whose answer is not a body the
  // caller reads out of a 2xx, and that is why `startSocialLogin` does not use
  // `send`: a 302 is not `response.ok`, so an implementation that reached the
  // failure branch first would report a redirect as a malformed answer from a
  // proxy. The order below is the one identity's own client uses for the same
  // operation, for the same reason.
  //
  // `startSocialLogin` returns the ADDRESS TO GO TO rather than navigating: a
  // `fetch` cannot perform a top-level navigation to another origin, and one
  // that tried would be github.com answering a sign-in with an HTML page. What
  // the browser does with that address is the screen's business — see
  // `window.location`, which this file deliberately does not touch.
  //
  // NEITHER CALL TAKES A TOKEN. Both routes are `security: []`, and the reason
  // is not only that a credential would be ignored: the start leg READS the
  // session cookie to record whether this becomes a sign-in or a LINK, and
  // sending a bearer header as well would make "signed in" ambiguous between two
  // sources of the same fact. The cookie travels anyway, because the browser
  // sends it and the forwarder carries it — see the `cookie` entry in
  // `FORWARDED_REQUEST_HEADERS`.
  //
  // The third leg is `POST /v1/session/mfa`, and it IS here now — see
  // `completeSecondFactor` below, which the password path's prompt drives. It
  // is still unreachable from THIS screen: a social sign-in that lands on the
  // challenge has no form to answer it with, so the honest answer is the
  // sentence that points at the password path. See
  // `HANDOFF-parlor-02-social-ui` for the finding.
  // ---------------------------------------------------------------------------
  startSocialLogin: (provider: SocialProvider) => Promise<string>;
  completeSocialLogin: (
    provider: SocialProvider,
    input: SocialCallbackInput,
  ) => Promise<SocialSignIn>;

  // ---------------------------------------------------------------------------
  // The second-factor LOGIN leg — `POST /v1/session/mfa`, and the only route in
  // the service that turns a second factor into a session.
  //
  // It is the other half of `login`'s 202 arm, and it is here because the
  // client can perform it: the same bar the four MFA management routes
  // crossed. The session is minted inside the same transaction that consumes
  // the challenge, so a challenge cannot be answered twice and a code cannot
  // buy two sessions.
  //
  // IT TAKES NO TOKEN. The challenge IS the credential — presented in the body
  // (which wins when both are present) or in the `__Host-mfa-challenge` cookie
  // the 202 set — so `send` is called with no `token` and no `Authorization`
  // header goes out at all, exactly like the anonymous recovery pair.
  //
  // The 401 is one status and one sentence for five different facts (a wrong
  // TOTP code, a spent recovery code, a code whose step was already used, a
  // malformed value, a rotated-away secret) and this client does not undo that
  // collapse: it reads the status and the `Retry-After` header and nothing
  // else. The 423 carries the lockout window in `Retry-After`; the 503 says
  // the deployment cannot verify a second factor at all.
  // ---------------------------------------------------------------------------
  completeSecondFactor: (input: CompleteSecondFactorInput) => Promise<Session>;

  // ---------------------------------------------------------------------------
  // The MFA surface — four routes, all session-scoped, three of them one-time.
  //
  // `mfaStatus` answers 200 with `{"enabled": false}` when there is no
  // credential, never a 404. `startMfaEnrollment` returns the secret and the
  // provisioning URI HERE AND NEVER AGAIN. `confirmMfaEnrollment` revokes
  // every session the account holds — including the caller's — and returns the
  // recovery codes once. `regenerateMfaRecoveryCodes` requires a code and
  // returns a fresh set once.
  //
  // The disable route, `DELETE /v1/mfa`, is deliberately NOT here: it is a
  // destructive security action with no screen behind it yet, and a client
  // method with no caller is a capability this app does not have. The
  // forwarder refuses it for the same reason.
  // ---------------------------------------------------------------------------
  mfaStatus: (token: string) => Promise<MFAStatus>;
  startMfaEnrollment: (token: string, input?: StartEnrollmentInput) => Promise<StartedEnrollment>;
  confirmMfaEnrollment: (
    token: string,
    enrollmentId: string,
    input: ConfirmEnrollmentInput,
  ) => Promise<ConfirmedEnrollment>;
  regenerateMfaRecoveryCodes: (
    token: string,
    input: RegenerateRecoveryCodesInput,
  ) => Promise<RecoveryCodes>;
};

/**
 * `202 {"status":"accepted"}` — the body of `POST /v1/password-resets`.
 *
 * It is typed rather than discarded because the contract declares it, but the
 * screens must not branch on it: it is the same for a registered address and an
 * unregistered one, which is the property worth having, so there is nothing in it
 * to read.
 */
export type RecoveryAccepted = { status: string };

/**
 * The body of `POST /v1/password-resets/confirm`.
 *
 * `token` is the credential from the emailed link and `password` is the value to
 * move to. There is no `email` and no `session`: the token IS the authority, which
 * is why this route is anonymous and why redeeming it signs the caller out.
 */
export type RedeemPasswordResetInput = { token: string; password: string };

/**
 * The body of `POST /v1/email-verifications/confirm`.
 *
 * `tokenRequest` in the handler: one field, and the other two token routes are
 * deliberately not folded into it. A shared type with an optional `password`
 * would invite a client to send a password to a verification endpoint, where the
 * service would ignore it — and "ignored" is worse than "refused", because a
 * caller that believed the field was accepted would never learn to retry.
 *
 * There is no `email` and no `session`: the token IS the authority, which is why
 * the route is anonymous and why redeeming it costs nobody their session.
 */
export type RedeemVerificationInput = { token: string };

/**
 * The 200 from `GET /v1/email-verification`.
 *
 * `verificationStatusResponse` in the handler. `email_verified_at` is OPTIONAL
 * and that is load-bearing: it is absent for an address that was never proved,
 * which is a different answer from an epoch timestamp, and different again from
 * `false` on an address that was proved and then changed — a changed address
 * lands unverified. So the type does not default it and the screen does not
 * invent one.
 */
export type VerificationStatus = {
  email: string;
  email_verified: boolean;
  email_verified_at?: string;
};

/**
 * A provider name, as this file accepts one: ANY string.
 *
 * That is not carelessness and it is not the same as saying every name works.
 * The document's `provider` parameter is `enum: [google, github]`, and a caller
 * holding a closed union here would be protected from exactly the case that has
 * to work: a provider this app has never heard of. The service answers 404 both
 * for a name it has no credentials for and for a name that does not exist, so
 * "not one of ours" and "not configured here" have to be askable and have to
 * arrive as the same answer, or this file would be turning one into the other.
 *
 * The place the name is checked is `SEGMENT_PATTERNS.provider` in
 * `src/lib/upstream.ts` — once, at the forwarder, on the way to an address — and
 * the test named "asks identity about a provider this app does not narrow to the
 * document's enum" is what holds that line. A string type here and a shape there
 * is the whole arrangement: this file is allowed to ask, and the gate decides.
 */
export type SocialProvider = string;

/**
 * The 200 from the social callback on the LINK path.
 *
 * `SocialLinked` in the document. A flow that started while somebody was signed
 * in attaches the provider identity to that account instead of signing anybody
 * in, so this body carries NO `token` — not an empty one, no field at all, which
 * is the honest signal for "nothing was minted". A client that reads `token` off
 * this shape finds nothing, and that is the contract rather than an oversight.
 */
export type SocialLinked = { linked_provider: string };

/**
 * The 202 from the social callback: a correct round trip and an UNFINISHED login.
 *
 * Typed here rather than left out because `send` returns it as a success — it is
 * a 2xx — and a type that silently omitted it would be claiming a caller can
 * read `token` off every successful social sign-in. It cannot.
 *
 * `MFAChallenge` in the document, and the same three fields `POST /v1/session`
 * answers 202 with. There is no `token` and adding one would be the bug that
 * schema exists to prevent.
 */
export type SocialMfaChallenge = {
  mfa_required: boolean;
  challenge: string;
  expires_at: string;
};

/**
 * What a finished social round trip can be: a session, a link, or a challenge.
 *
 * A DISCRIMINATED union rather than the three bodies, because the whole risk on
 * this route is reading the wrong one. `token` and `linked_provider` are
 * mutually exclusive on the wire and a caller that defaults a missing `token` to
 * `""` would be inventing a signed-in state the service never minted — somebody
 * who controls a provider account with another person's address would walk into
 * that account. `kind` makes the caller state which it got, and a body carrying
 * BOTH keys is refused rather than guessed at.
 *
 * Which of the three arrived is decided by the INTENTION recorded when the flow
 * started, before the code was spent, and not by anything a client asks for.
 */
export type SocialSignIn =
  | { kind: "session"; session: Session }
  | { kind: "linked"; linked: SocialLinked }
  | { kind: "mfa_required"; challenge: SocialMfaChallenge };

/**
 * The query string the provider sends the browser back with.
 *
 * All three are parameters of the callback route in the document and in that
 * order. `state` is required and the other two are alternatives: `code` is
 * absent when the provider reported a problem, and `error` is absent when it did
 * not, so "declined consent" and "presented something invalid" are told apart
 * by their presence rather than by a message. The service collapses the four
 * refusals it has into one 400 on purpose; this shape is where the difference
 * between "the provider said no" and "the provider said nothing useful" is still
 * visible, and dropping `error` here would throw that away.
 */
export type SocialCallbackInput = {
  code?: string;
  state: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// The MFA surface
//
// Four routes under /v1/mfa, transcribed from `identity/openapi/v1.yaml`
// (which does describe them, unlike the tenancy surface) and cross-checked
// against the handler in `identity/internal/httpapi/mfa.go`.
//
// ALL FOUR ARE SESSION-SCOPED — every one is wrapped in
// `sessionCredentialOnly`, like the tenancy routes — so every call takes the
// token and a call without one is a 401 rather than a 403. None is anonymous
// and none answers a redirect, so all four go through `send` like the tenancy
// surface rather than writing their own status handling like the social pair.
//
// THREE OF THE FOUR HAND OUT A ONE-TIME VALUE, and that is the fact this
// surface exists around. The enrollment secret, the provisioning URI and the
// recovery codes are each returned in exactly one response and NEVER AGAIN:
// there is no endpoint that re-reads them and no column that stores them,
// only a SHA-256 digest per code. A client that caches them, or a screen that
// re-renders them from state, is showing a person a secret the service has
// already forgotten — which is a defect rather than a shortcut. The settings
// section's tests are where that is proved.
// ---------------------------------------------------------------------------

/**
 * The 200 from `GET /v1/mfa`.
 *
 * `method`, `enrolled_at` and `recovery_codes_remaining` are `omitempty` in
 * the handler and ABSENT when `enabled` is false — "totp" and "no method yet"
 * are different answers, which is why these are optional rather than
 * defaulted to a placeholder. A 200 with `{"enabled": false}` and never a
 * 404: the question has an answer for every signed-in user, so a settings
 * page never has to distinguish "you have none" from "this is not your
 * account".
 */
export type MFAStatus = {
  enabled: boolean;
  method?: string;
  enrolled_at?: string;
  recovery_codes_remaining?: number;
};

/**
 * The body of `POST /v1/mfa/enrollments`.
 *
 * `code` authorises a ROTATION and is not needed for a first enrollment; the
 * service decides which case it is from the rows, so a client that sends one
 * for a first enrollment is not wrong, only redundant. The body itself is
 * required by the document, so a first enrollment sends `{}` — which is why
 * the parameter below defaults rather than being optional at the call.
 */
export type StartEnrollmentInput = { code?: string };

/**
 * The 201 from `POST /v1/mfa/enrollments`.
 *
 * `secret` and `provisioning_uri` are HERE AND NOWHERE ELSE: no endpoint
 * re-reads them, so a client that loses this body starts a new enrollment,
 * which mints a new secret. The reasoning is the one an OIDC `client_secret`
 * follows — a secret this service can produce again is a secret this service
 * is storing, and a stored TOTP secret is a second factor for whoever reads
 * the database.
 *
 * `replaced` says the previous credential is STILL LIVE behind this pending
 * one, so an abandoned rotation costs nothing and the old phone keeps working
 * until the new one is confirmed.
 */
export type StartedEnrollment = {
  enrollment_id: string;
  secret: string;
  provisioning_uri: string;
  method: string;
  digits: number;
  period_seconds: number;
  algorithm: string;
  expires_at: string;
  replaced: boolean;
};

/**
 * The body of `POST /v1/mfa/enrollments/{enrollmentId}/confirm`.
 *
 * `code` is required always — an unconfirmed enrollment is not a second
 * factor yet, so this is the only thing that makes it one. Wrong, already
 * spent, malformed, and produced by a secret this rotation has already
 * replaced are all the same 401: four different facts, one sentence, because
 * a client that could tell them apart would only learn which to keep trying.
 */
export type ConfirmEnrollmentInput = { code: string };

/**
 * The 200 from the confirm.
 *
 * EVERY SESSION THE ACCOUNT HOLDS WAS REVOKED to produce this response,
 * including the caller's own — a session minted under a one-factor policy was
 * minted on a password alone, and leaving it alive means whoever holds it does
 * not have to solve the new problem. There is no token in this body and nowhere
 * else: enabling MFA signs the session in only via the already-working path,
 * and the settings section's copy says so rather than promising otherwise.
 *
 * `recovery_codes` are here and never again — ten of them, each accepted
 * exactly once and destroyed by use.
 */
export type ConfirmedEnrollment = {
  enabled: boolean;
  method: string;
  enrolled_at: string;
  recovery_codes: string[];
  replaced_existing_secret: boolean;
};

/**
 * The body of `POST /v1/mfa/recovery-codes` — one field, `code`, which the
 * service reads as either a six-digit TOTP code or a recovery code in the
 * `XXXX-XXXX-XXXX-XXXX` form. One field rather than two, so a caller cannot
 * put a recovery code in the TOTP field and be told it was malformed rather
 * than not accepted.
 */
export type RegenerateRecoveryCodesInput = { code: string };

/**
 * The 200 from `POST /v1/mfa/recovery-codes`.
 *
 * The old set is destroyed in the same transaction that writes the new one —
 * a partial write would leave two live sets, which is a second recovery path
 * through codes nobody audited. The new codes are returned once.
 */
export type RecoveryCodes = {
  recovery_codes: string[];
  issued_at: string;
  recovery_codes_remaining: number;
};

export class IdentityError extends Error {
  readonly status: number;
  /** A reserved code (`core/docs/openapi-conventions.md`), or `internal`. */
  readonly code: string;
  /** The fixed human summary for the code. Never occurrence-specific. */
  readonly title: string | null;
  /** Per-field failures from a 422. Empty for every other status. */
  readonly fieldErrors: FieldError[];
  /** `trace_id` from the body, else `X-Trace-Id`. What support will ask for. */
  readonly traceId: string | null;
  /**
   * The `Retry-After` header on a 423, in whole seconds, or null.
   *
   * Only the second-factor lockout answers 423 today, and the wait is the one
   * fact a person needs from it: the factor is locked for fifteen minutes
   * after five failures, and a bare "try again" sends them to retry forever
   * against a lock that ignores them. Null on every other status, and on a
   * 423 whose header is missing or unparseable — the honest reading of a value
   * that is not there.
   */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      title?: string | null;
      fieldErrors?: FieldError[];
      traceId?: string | null;
      retryAfter?: number | null;
    },
  ) {
    super(message);
    this.name = "IdentityError";
    this.status = options.status;
    this.code = options.code ?? "internal";
    this.title = options.title ?? null;
    this.fieldErrors = options.fieldErrors ?? [];
    this.traceId = options.traceId ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

/**
 * The browser transport.
 *
 * `credentials: "same-origin"`, and the value is the whole content of the
 * change. It was `"omit"` because the call was cross-origin: a cookie set by
 * another origin is unreachable from here, and an ambient one nobody manages is
 * a second credential with no owner. Same-origin removes both reasons — the
 * browser now owns the cookie, and identity's `__Host-session` travels with
 * every request, which is what makes it a credential rather than a decoration.
 *
 * `"same-origin"` rather than `"include"` is deliberate. `include` would also
 * send the cookie to a cross-origin destination, and the one property this
 * arrangement is built on is that the browser never talks to another origin
 * again. If a future change reintroduced a cross-origin call, `same-origin`
 * would drop the cookie there — the failure would be a 401, which is visible.
 *
 * The bearer token is still sent, and `identity` still prefers it
 * (`presentedToken` reads the header before the cookie). Both credentials are
 * live; see README, "Sessions", for why the `localStorage` half is still here
 * and which packet retires it.
 */
const fetchTransport: Transport = async ({ url, method, headers, body }) =>
  fetch(url, {
    method,
    headers,
    body,
    credentials: "same-origin",
  });

export function createIdentityClient(
  options: { baseUrl?: string; transport?: Transport } = {},
): IdentityClient {
  const base = (options.baseUrl ?? IDENTITY_BASE_URL).replace(/\/+$/, "");
  const transport = options.transport ?? fetchTransport;

  return {
    register: (input) => send(transport, `${base}/v1/users`, "POST", { body: input }),
    mintSignupTimestamp: () => send(transport, `${base}/v1/signup-timestamp`, "POST"),

    // -----------------------------------------------------------------------
    // The login leg.
    //
    // This does NOT go through `send`, and the reason is the mirror image of the
    // social pair's: there, the interesting case is a status `send` would treat
    // as a FAILURE (a 302 is not `ok`); here, it is a status `send` would treat
    // as a SUCCESS and then misread. A 202 IS `response.ok`, so `send` would
    // read the challenge body as a `Session` — a body with no `token` — and
    // hand a screen a "session" that minted nothing. The 202 branch comes first
    // for the same reason `startSocialLogin`'s 3xx branch does: the status that
    // needs its own handling is the one the shared helper's path gets wrong.
    //
    // The 202 mints no session and sets no session cookie — the credentials
    // were accepted and the authentication is not finished, which is what 202
    // means. So the arm carries the challenge and nothing else, and the
    // challenge is a one-time credential that is never stored beyond the span
    // of the prompt that answers it.
    // -----------------------------------------------------------------------
    login: async (credentials) => {
      const response = await transport({
        url: `${base}/v1/session`,
        method: "POST",
        headers: {
          Accept: "application/json, application/problem+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (response.status === 202) {
        return { kind: "mfa_required", ...(await readMfaChallenge(response)) };
      }

      if (!response.ok) throw await parseError(response);
      return { kind: "session", session: (await readJson(response)) as Session };
    },

    logout: (token) => send(transport, `${base}/v1/session`, "DELETE", { token }),
    me: (token) => send(transport, `${base}/v1/me`, "GET", { token }),

    // -----------------------------------------------------------------------
    // The display-name surface.
    //
    // The body ALWAYS carries `display_name`, and that is the contract rather
    // than an omission: an omitted field and an empty string are the same
    // request upstream, so a caller that made the field optional would be
    // inventing a distinction the route does not have. Clearing is `""`.
    // -----------------------------------------------------------------------
    updateMyDisplayName: (token, input) =>
      send(transport, `${base}/v1/me`, "PATCH", { token, body: input }),

    // -----------------------------------------------------------------------
    // The sessions surface.
    //
    // Both take the token like every other session-scoped call here: the two
    // routes resolve the caller from the presented credential before they look
    // at anything else, and a scoped api key is refused with 403 on the same
    // terms as `DELETE /v1/session`.
    // -----------------------------------------------------------------------
    listSessions: (token) => send(transport, `${base}/v1/sessions`, "GET", { token }),
    revokeSession: (token, sessionId) =>
      send(transport, `${base}/v1/sessions/${sessionId}`, "DELETE", { token }),

    // -----------------------------------------------------------------------
    // Account self-deletion.
    //
    // The same path as `me` under a third method, and the forwarder's
    // two-lookup rule is what tells them apart. The 204 resolves `undefined`;
    // the 409 arrives as an `IdentityError` whose message is the service's own
    // detail naming the accounts to transfer or delete first.
    // -----------------------------------------------------------------------
    deleteMyAccount: (token) => send(transport, `${base}/v1/me`, "DELETE", { token }),

    listAccounts: (token) => send(transport, `${base}/v1/accounts`, "GET", { token }),
    createAccount: (token, input) =>
      send(transport, `${base}/v1/accounts`, "POST", { token, body: input }),
    getAccount: (token, accountId) =>
      send(transport, `${base}/v1/accounts/${accountId}`, "GET", { token }),
    renameAccount: (token, accountId, input) =>
      send(transport, `${base}/v1/accounts/${accountId}`, "PATCH", { token, body: input }),
    deleteAccount: (token, accountId) =>
      send(transport, `${base}/v1/accounts/${accountId}`, "DELETE", { token }),
    listMembers: (token, accountId) =>
      send(transport, `${base}/v1/accounts/${accountId}/members`, "GET", { token }),
    inviteMember: (token, accountId, input) =>
      send(transport, `${base}/v1/accounts/${accountId}/invitations`, "POST", {
        token,
        body: input,
      }),
    acceptInvitation: (token, input) =>
      send(transport, `${base}/v1/invitations/accept`, "POST", { token, body: input }),
    changeMemberRole: (token, accountId, userId, input) =>
      send(transport, `${base}/v1/accounts/${accountId}/members/${userId}`, "PATCH", {
        token,
        body: input,
      }),
    removeMember: (token, accountId, userId) =>
      send(transport, `${base}/v1/accounts/${accountId}/members/${userId}`, "DELETE", { token }),

    // -----------------------------------------------------------------------
    // The recovery surface.
    //
    // NEITHER CALL TAKES A TOKEN, and that is the service's rule rather than an
    // omission here. All eight recovery routes are wrapped in
    // `sessionCredentialOnly`, which refuses a scoped API key outright: a key
    // that can mint a password reset is a takeover with a delay rather than a
    // break-in. The four anonymous routes, these two among them, are exactly the
    // ones where presenting a credential would be worst. So `send` is called with
    // no `token`, and no `Authorization` header goes out at all.
    //
    // The request bodies and the statuses are transcribed from the handler
    // (`identity/internal/httpapi/recovery.go`) for the same reason the tenancy
    // shapes above are transcribed rather than read off the OpenAPI document.
    // -----------------------------------------------------------------------

    requestPasswordReset: (email) =>
      send(transport, `${base}/v1/password-resets`, "POST", { body: { email } }),
    redeemPasswordReset: (input) =>
      send(transport, `${base}/v1/password-resets/confirm`, "POST", { body: input }),

    // -----------------------------------------------------------------------
    // The verification surface.
    //
    // The same rule as the two calls above: both POSTs are wrapped in
    // `sessionCredentialOnly` and take no credential, so `send` is called with no
    // `token` and no Authorization header goes out at all. `verificationStatus`
    // is the exception — it resolves a session through `currentUser`, so it
    // carries the token like every other session-scoped call in this file.
    //
    // THE SINGULAR ROUTE IS `/v1/email-verification`, not `/v1/email-verifications`.
    // One word, singular, reading the caller's own state against the two-word
    // plural routes that start and redeem a flow. It is transcribed rather than
    // guessed because it is exactly the kind of name a plausible guess gets wrong,
    // and a wrong path here is a 404 that looks like an unverified account.
    // -----------------------------------------------------------------------

    requestEmailVerification: (email) =>
      send(transport, `${base}/v1/email-verifications`, "POST", { body: { email } }),
    redeemEmailVerification: (input) =>
      send(transport, `${base}/v1/email-verifications/confirm`, "POST", { body: input }),
    verificationStatus: (token) =>
      send(transport, `${base}/v1/email-verification`, "GET", { token }),

    // -----------------------------------------------------------------------
    // The social surface.
    //
    // Neither of these uses `send`, and both write the failure handling out
    // rather than sharing a helper, because in each case the interesting case IS
    // a status `send` would treat as a failure. `startSocialLogin` answers a 302,
    // which is not `response.ok`; `completeSocialLogin` answers a 202, which is,
    // and whose body is a challenge rather than a session. Sharing the path would
    // mean threading a flag through `send` to say "this 3xx is the answer", and
    // a flag like that is how a 302 stops being handled three calls later.
    //
    // What they DO share is `parseError` and `readJson`, so a refusal is still an
    // `IdentityError` and a body that is not JSON still says so.
    // -----------------------------------------------------------------------

    startSocialLogin: async (provider) => {
      const response = await transport({
        // Encoded because the provider is a PATH SEGMENT and this is the only
        // thing in this file that puts a caller-supplied string into a URL
        // rather than reading one out of a route table. `../google/../../me`
        // becomes `..%2Fgoogle%2F..%2F..%2Fme`: still nonsense, still refused by
        // the forwarder's shape check, and no longer a path.
        url: `${base}/v1/auth/oauth/${encodeURIComponent(provider)}`,
        method: "GET",
        headers: { Accept: "application/json, application/problem+json" },
      });

      // THE 3xx BRANCH COMES FIRST, and moving it below `response.ok` is the
      // regression this method exists to avoid: a 302 is not `ok`, so a version
      // that checked for a failure first would throw `IdentityError` on a
      // perfectly good answer and the button would never navigate anywhere.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        // A redirect with nowhere to go is not a success, and an empty string
        // here would render as a link pointing at the page it is already on.
        if (location === null) {
          throw new IdentityError(
            `identity answered ${response.status} with no Location header, so the browser has nowhere to be sent`,
            { status: response.status, code: "internal" },
          );
        }
        return location;
      }

      // The document promises no 2xx for this operation. One means whatever
      // answered is not identity, and there is no address to report — so it must
      // not come back as an empty string either.
      if (response.ok) {
        throw new IdentityError(
          `identity answered ${response.status} to a social sign-in start, which has to be a redirect`,
          { status: response.status, code: "internal" },
        );
      }

      // A provider with no credentials and a provider that does not exist both
      // land here, and stay indistinguishable: the status and code are the
      // service's own, and this file adds nothing to either.
      throw await parseError(response);
    },

    completeSocialLogin: async (provider, input) => {
      const response = await transport({
        url: socialCallbackUrl(base, provider, input),
        method: "GET",
        headers: { Accept: "application/json, application/problem+json" },
      });

      // 400 (declined, forged state, unusable address), 401 (a LINK whose
      // session no longer resolves), 404 and 409 (an address a local account
      // already holds) all arrive here and stay failures. The 409 in particular
      // is the anti-account-takeover refusal and flattening it into a session
      // would be the worst answer available.
      if (!response.ok) throw await parseError(response);

      return readSocialSignIn(await readJson(response), response.status);
    },

    // -----------------------------------------------------------------------
    // The second-factor login leg.
    //
    // `send` rather than a hand-rolled status branch, because every answer this
    // route can give that is not a 200 is a failure: a 401 (refused, whatever
    // the cause), a 423 (locked, with the window in `Retry-After`), a 503 (the
    // deployment cannot verify a second factor). There is no status `send` would
    // misread, which is the property the two surfaces above each had to write
    // their own handling to avoid.
    //
    // NO TOKEN, and that is the service's rule rather than an omission here: the
    // challenge in the body IS the credential, so `send` is called with no
    // `token` and no `Authorization` header goes out at all — the same shape as
    // the anonymous recovery pair.
    // -----------------------------------------------------------------------
    completeSecondFactor: (input) =>
      send(transport, `${base}/v1/session/mfa`, "POST", { body: input }),

    // -----------------------------------------------------------------------
    // The MFA surface.
    //
    // All four take the token, because every route is `sessionCredentialOnly`
    // and a call without one is a 401 rather than a 403. All four go through
    // `send`, because none of them is anonymous and none answers a redirect —
    // the two properties that made the social pair write their own status
    // handling.
    //
    // `startMfaEnrollment` defaults its input to `{}` because the document
    // requires a body and `code` is the optional half of it: a first
    // enrollment sends an empty object, a rotation sends `{ code }`.
    // -----------------------------------------------------------------------
    mfaStatus: (token) => send(transport, `${base}/v1/mfa`, "GET", { token }),
    startMfaEnrollment: (token, input = {}) =>
      send(transport, `${base}/v1/mfa/enrollments`, "POST", { token, body: input }),
    confirmMfaEnrollment: (token, enrollmentId, input) =>
      send(transport, `${base}/v1/mfa/enrollments/${enrollmentId}/confirm`, "POST", {
        token,
        body: input,
      }),
    regenerateMfaRecoveryCodes: (token, input) =>
      send(transport, `${base}/v1/mfa/recovery-codes`, "POST", { token, body: input }),
  };
}

/**
 * The callback's URL, carrying the parameters the provider sent.
 *
 * `code`, `state` and `error` are the three the document puts in the query
 * string, and all three have to be here: `code` is what the round trip spends,
 * `state` is what it is authenticated by, and `error` is how somebody who
 * declined at the provider is told that rather than being handed the refusal
 * reserved for a forged state.
 *
 * The order is the CALLER'S, not this file's, and it is deliberately not
 * normalised. It does not matter to anything — the forwarder rebuilds the query
 * from its own list in `ROUTES`, so `?state=..&code=..` arrives upstream as
 * `?code=..&state=..` — and leaving it alone means the URL a caller reads in a
 * failing test is the URL they wrote.
 *
 * A parameter that was not supplied is not sent as an empty one. `?error=` is a
 * different answer from no `error` at all, and the service reads the difference.
 */
function socialCallbackUrl(
  base: string,
  provider: SocialProvider,
  input: SocialCallbackInput,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined) query.set(name, value);
  }
  const search = query.toString();
  const segment = encodeURIComponent(provider);
  return `${base}/v1/auth/oauth/${segment}/callback${search ? `?${search}` : ""}`;
}

/**
 * Reads the 202 challenge body `POST /v1/session` answers.
 *
 * `readString` rather than `String(…)` for the reason `readSocialSignIn` spells
 * out on the same shape: the body is `unknown`-valued, and a service that sent
 * an object where the contract says `challenge` is a string would otherwise
 * have `"[object Object]"` handed to a second-factor screen as somebody's
 * challenge. `readString` returns a string or nothing, and "nothing" is the
 * honest reading of a field that is not one.
 *
 * The 202 status IS the signal that a challenge is owed — the handler only
 * answers 202 from `writeChallenge`, which always sets `mfa_required: true` —
 * so the flag is not re-checked here the way `readSocialSignIn` checks it.
 */
async function readMfaChallenge(
  response: Response,
): Promise<{ challenge: string; expiresAt: string }> {
  const record = asRecord(await readJson(response));
  return {
    challenge: readString(record?.challenge) ?? "",
    expiresAt: readString(record?.expires_at) ?? "",
  };
}

/**
 * Reads the callback's 200 or 202 as the one of three things it is.
 *
 * The three bodies are mutually exclusive on the wire, and this function is
 * where that is enforced rather than assumed:
 *
 *   * `token` → a session, which is a sign-in that finished;
 *   * `linked_provider` → a LINK, which minted nothing, and which must never be
 *     read as a session with an empty token — somebody holding that would treat
 *     an account as signed in when no session exists;
 *   * `mfa_required` → an unfinished login and a challenge, which is a 2xx and
 *     so arrives here like a success and is not one.
 *
 * A body with BOTH `token` and `linked_provider` is not a documented shape, and
 * picking one of the two would be a guess about what the service meant. It is
 * refused, on the same discipline `readJson` applies to a body that is not JSON.
 * The status on that refusal is the real one, so a caller can tell "the service
 * answered something nobody here can read" from "the service refused me".
 */
function readSocialSignIn(body: unknown, status: number): SocialSignIn {
  const record = (body ?? {}) as Record<string, unknown>;
  const isSession = typeof record.token === "string";
  const isLinked = typeof record.linked_provider === "string";
  const isChallenge = record.mfa_required === true;

  if (isChallenge) {
    return {
      kind: "mfa_required",
      // `readString`, not `String(…)`. The record is `unknown`-valued, and
      // `String({})` is `"[object Object]"` — so a service that sent an object
      // where the document says `challenge` is a string would have that literal
      // handed to a second factor screen as somebody's challenge. `readString`
      // returns a string or nothing, and "nothing" is the honest reading of a
      // field that is not one. `@typescript-eslint/no-base-to-string` is what
      // pointed at it.
      challenge: {
        mfa_required: true,
        challenge: readString(record.challenge) ?? "",
        expires_at: readString(record.expires_at) ?? "",
      },
    };
  }

  if (isSession && isLinked) throw unrecognisableSocialBody(status);
  if (isSession) return { kind: "session", session: body as Session };
  if (isLinked) return { kind: "linked", linked: body as SocialLinked };

  // Neither key, which is what an empty body looks like — the case the
  // forwarder's table-and-client walk hits, because its stub answers every hop
  // with `200 {}`.
  throw unrecognisableSocialBody(status);
}

function unrecognisableSocialBody(status: number): IdentityError {
  return new IdentityError(
    `identity's social callback answered ${status} with a body this app does not recognise as a session, a link or a challenge`,
    { status, code: "internal" },
  );
}

async function send<T>(
  transport: Transport,
  url: string,
  method: TransportRequest["method"],
  options: { body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  // Only a request that carries a token has one to send. register, login,
  // mintSignupTimestamp and completeSecondFactor must arrive with no
  // Authorization header at all — the last because the challenge in the body
  // IS the credential there, and the mint because a browser arriving at the
  // form holds nothing but the address it was sent to.
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await transport({ url, method, headers, body });
  if (!response.ok) throw await parseError(response);

  // 204 has no body by definition; anything else is a contract violation, and
  // reading it should say so rather than raise a parse error about `null`.
  if (response.status === 204) return undefined as T;

  return (await readJson(response)) as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new IdentityError(`identity returned a body that is not JSON (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
}

/**
 * Turns a failure response into an `IdentityError`.
 *
 * The status is the one fact that is never in doubt, so it is captured first
 * and everything after is best effort: a proxy's HTML 502 and a service's
 * problem+json 422 both come out as an `IdentityError` a screen can render.
 */
async function parseError(response: Response): Promise<IdentityError> {
  const { status } = response;
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    // A body that cannot even be read is still a failure we can describe.
  }

  const body = asRecord(safeParse(raw));
  const traceId = readString(body?.trace_id) ?? response.headers.get("X-Trace-Id");
  const retryAfter = readRetryAfter(response.headers.get("retry-after"));
  const nested = asRecord(body?.error);
  if (nested) return fromNestedEnvelope(nested, status, traceId, retryAfter);
  if (body) return fromProblemEnvelope(body, status, traceId, retryAfter);

  return new IdentityError(`Request to identity failed (${status})`, {
    status,
    traceId,
    retryAfter,
  });
}

/**
 * The `Retry-After` header as whole seconds, or null when it is absent or not a
 * number.
 *
 * Null rather than NaN for the unparseable case: a proxy that wrote garbage
 * into the header has not told the caller anything, and a screen that read NaN
 * off this would render "try again in NaN seconds" — which is worse than the
 * bare "try again" the field exists to replace.
 */
function readRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function fromProblemEnvelope(
  body: Record<string, unknown>,
  status: number,
  traceId: string | null,
  retryAfter: number | null,
): IdentityError {
  const code = readString(body.code) ?? "internal";
  const title = readString(body.title) ?? null;
  const detail = readString(body.detail);
  return new IdentityError(detail ?? title ?? `Request to identity failed (${status})`, {
    status,
    code,
    title,
    fieldErrors: readProblemFieldErrors(body.errors),
    traceId,
    retryAfter,
  });
}

/**
 * The `{error:{…}}` shape from the identity-02 brief, read into the same
 * `IdentityError` as the problem+json above. `fields` is a map of field name
 * to a list of codes, so a field with two failures becomes two entries and
 * the screen picks the first.
 */
function fromNestedEnvelope(
  error: Record<string, unknown>,
  status: number,
  traceId: string | null,
  retryAfter: number | null,
): IdentityError {
  const fieldErrors: FieldError[] = [];
  const fields = asRecord(error.fields);
  for (const [field, codes] of Object.entries(fields ?? {})) {
    for (const code of Array.isArray(codes) ? codes : [codes]) {
      if (typeof code === "string") fieldErrors.push({ field, code });
    }
  }

  return new IdentityError(
    readString(error.message) ?? readString(error.detail) ?? `Request to identity failed (${status})`,
    {
      status,
      code: readString(error.code) ?? "internal",
      title: readString(error.title) ?? readString(error.message) ?? null,
      fieldErrors,
      traceId,
      retryAfter,
    },
  );
}

function readProblemFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  const found: FieldError[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const field = record ? readString(record.field) : null;
    const code = record ? readString(record.code) : null;
    if (field && code) found.push({ field, code });
  }
  return found;
}

/** Turns one contract field code into a sentence for a person. */
export function fieldErrorMessage(field: string, code: string): string {
  // The tenancy codes first, because a role failure is a sentence about what
  // the service will not let you do rather than about the shape of a value, and
  // the generic fallbacks below would flatten all four of them into "Role is
  // not valid." — which is true, useless, and the same sentence for four
  // different mistakes.
  const tenancy = tenancyFieldMessage(field, code);
  if (tenancy) return tenancy;

  const label = fieldLabel(field);
  switch (code) {
    case "required":
      return `${label} is required.`;
    case "invalid_format":
      return field === "email" ? "Enter a valid email address." : `${label} is not valid.`;
    case "too_short":
      return field === "password"
        ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
        : `${label} is too short.`;
    case "too_long":
      // The name has a published bound, so the sentence can quote it rather
      // than say "too long" and send somebody to look it up.
      return field === "name"
        ? `Use ${MAX_NAME_LENGTH} characters or fewer.`
        : `${label} is too long.`;
    default:
      // An unknown code is a gap in this table, not something to show a person.
      // It stays on the error for telemetry; the sentence stays plain.
      return `${label} is not valid.`;
  }
}

/**
 * The tenancy field codes, which the service declares in its own package.
 *
 * `internal/accounts/accounts.go` calls these "part of the contract and
 * clients may switch on them", so each one gets a sentence that says what
 * actually happened rather than what shape a value had.
 */
function tenancyFieldMessage(field: string, code: string): string | null {
  // Two client-only codes, not ones from the service.
  //
  // `POST /v1/password-resets/confirm` takes `{token, password}` and never sees
  // a confirmation, so "these two do not match" is only catchable on this side.
  // It goes through here rather than into the reset screen anyway, because this
  // is the one place a field code becomes a sentence, and a screen that wrote
  // its own would be the second place.
  if (field === "password_confirmation" && code === "mismatch") {
    return "The two passwords do not match.";
  }
  if (field === "name" && code === "invalid_format") {
    // ValidateName's third rule. A name with nothing sluggable in it would
    // produce an empty slug, and a slug is NOT NULL and unique — so the service
    // refuses it rather than turning a 422 into a 500. Saying so is more use
    // than "Name is not valid."
    return "Use a name with at least one letter or number in it.";
  }
  if (field === "role" && code === "not_invitable") {
    return "An invitation may carry the admin or member role.";
  }
  if (field === "role" && code === "last_owner") {
    return "This account must keep at least one owner.";
  }
  if (field === "role" && code === "unknown_role") {
    return "Choose a role this account recognises.";
  }
  return null;
}

function fieldLabel(field: string): string {
  if (field === "email") return "Email";
  if (field === "password") return "Password";
  const words = field.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
