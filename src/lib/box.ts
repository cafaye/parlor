/**
 * Typed client for the Box entitlements service, and for the W3 box
 * and email-provider surfaces.
 *
 * The entitlements operations are transcribed from Box's versioned
 * contract (`docs/openapi/entitlements-v1.yaml`, v1.0.0) on Box `main`,
 * not from prose. The FOUR DOCUMENTED operations and nothing else, plus the
 * claim grant, whose source is named in the paragraph below.
 *
 *   GET  /v1/accounts/{account_id}/entitlements   200 {entitlements} | 401 | 404 | 503
 *   GET  /v1/operator/entitlements                200 {entitlements} | 401 | 403 | 503
 *   POST /v1/operator/entitlements                201 {entitlement} | 409 {entitlement, duplicate} | 401 | 403 | 422 | 503
 *   POST /v1/operator/entitlements/{id}/revoke    200 {entitlement} | 401 | 403 | 404 | 503
 *   POST /v1/accounts/{account_id}/claims         201 {entitlement} | 409 {entitlement, duplicate} | 401 | 403 | 422 | 503
 *
 * The four entitlements operations come from Box's versioned contract
 * (`docs/openapi/entitlements-v1.yaml`, v1.0.0) on Box `main`. The
 * claim grant does NOT: it is transcribed from Box's
 * `app/controllers/claims_controller.rb` and `config/routes.rb` on
 * `agents-first/repair-a` (W2-P3, decision D4), because `entitlements-v1.yaml`
 * still describes no operation for it. If the two ever disagree, the service
 * is right and this file is the bug — the same rule the W3 and W5 sections
 * below carry.
 *
 * The three W3 operations (boxes, connections list, connection create) are
 * transcribed from Box's MODELS instead, because its `config/routes.rb`
 * still mounts no HTTP surface for them — see the block comment above
 * `BoxStatus` for what that means for a reader of this file.
 *
 * Three properties hold for every call here:
 *
 * 1. EVERY CALL TAKES THE CALLER'S SESSION TOKEN. Box verifies nothing
 *    itself: it forwards the bearer token to identity for authorization. The
 *    customer read is member-scoped there — an unknown account and "not a
 *    member" are the same 404 on purpose — and the three operator routes are
 *    staff-checked there (401 anonymous, 403 non-staff). This file never mints,
 *    stores, or defaults a credential: an empty token throws before the wire.
 * 2. Failures are `BoxError`, a separate type from `IdentityError` and
 *    `BillingError`. Box is a different service with its own codes
 *    (`unauthenticated`, `forbidden`, `not_found`, `unprocessable`,
 *    `unavailable`); a change to identity's envelope is not a change to this.
 * 3. The base URL is this app's OWN ORIGIN. Every call goes through the `/v1`
 *    BFF allow-list in `src/lib/upstream.ts`, so `BOX_URL` is a
 *    server-only variable and is not in this bundle.
 * 4. NO CALL CARRIES A STORED CREDENTIAL IN EITHER DIRECTION ON A READ. The
 *    connection create carries one IN, as a request body box seals on
 *    arrival; no read returns one. See `EmailProviderConnection`.
 */

export type EntitlementProduct = "kit";
export type CustomerEntitlementStatus = "active";
export type StaffEntitlementStatus = "active" | "revoked";

/**
 * One active Kit entitlement, as the member-scoped customer read answers it.
 *
 * `status` is always `active` there: the customer surface lists what is live,
 * never history. A row answering another status is a shape nobody described
 * and is refused rather than rendered.
 */
export type CustomerEntitlement = {
  account_id: string;
  product: EntitlementProduct;
  status: CustomerEntitlementStatus;
  source: string | null;
  reference: string | null;
  granted_at: string | null;
  revoked_at: string | null;
};

/**
 * One entitlement row, as the staff surface answers it.
 *
 * Carries the audit facts the customer shape omits: the row `id`, both
 * actor ids, and a `revoked` status. `granted_by` is the identity user id of
 * the granting staff member; `revoked_by` the revoking one.
 */
export type StaffEntitlement = {
  id: number;
  account_id: string;
  product: EntitlementProduct;
  status: StaffEntitlementStatus;
  source: string | null;
  reference: string | null;
  granted_by: string | null;
  revoked_by: string | null;
  granted_at: string | null;
  revoked_at: string | null;
};

/** The body of `POST /v1/operator/entitlements`. Only `account_id` is required. */
export type GrantInput = {
  account_id: string;
  product?: EntitlementProduct;
  source?: string;
  reference?: string;
};

/** A grant answer: the row, and whether it already existed. */
export type GrantResult = {
  entitlement: StaffEntitlement;
  /** True on the 409 path: an active row already existed and is returned. Safe to retry. */
  duplicate: boolean;
};

/**
 * A claim grant's answer: the `kit` row the claim bought, and whether it
 * already existed.
 *
 * The same shape the operator grant answers, and for the same reason: the
 * 409 is the service saying "this account already holds an active kit", which
 * is the outcome the human wanted and not a failure. A screen that retried it
 * would be re-running a POST that has already done its work.
 */
export type ClaimResult = GrantResult;

export type BoxTransportRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

export type BoxTransport = (request: BoxTransportRequest) => Promise<Response>;

/**
 * Property declarations holding function types, for the reason `BillingClient`
 * spells its members that way: method shorthand declares a `this` that does
 * not exist, and `@typescript-eslint/unbound-method` rejects the destructured
 * read every screen performs.
 */
export type BoxClient = {
  /** The account's active Kit entitlements. Empty when none. 404 when the caller may not see it. */
  getAccountEntitlements: (token: string, accountId: string) => Promise<CustomerEntitlement[]>;
  /** Staff list, newest first, capped at 100 rows. Optional filters. */
  listEntitlements: (
    token: string,
    filter?: { accountId?: string; status?: StaffEntitlementStatus },
  ) => Promise<StaffEntitlement[]>;
  /** Staff grant. Writes a grant audit event attributed to the caller. */
  grantEntitlement: (token: string, input: GrantInput) => Promise<GrantResult>;
  /** Staff revoke. Idempotent: revoking a revoked row answers 200 with the row. */
  revokeEntitlement: (token: string, id: number) => Promise<StaffEntitlement>;
  /**
   * The account's box installations, with status and phase. Member-scoped:
   * an account the caller may not see is the same 404 as no account, which is
   * the service's own stance and not this client's to narrow.
   */
  listBoxes: (token: string, accountId: string) => Promise<Box[]>;
  /**
   * The account's email-provider connections. Non-secret fields only — a
   * stored credential is never carried by any call in this client.
   */
  listEmailProviderConnections: (token: string, accountId: string) => Promise<EmailProviderConnection[]>;
  /**
   * Records a connection, sealing `input.credential` to the box's public key
   * upstream. Answers the stored row — never the credential. A box that has
   * not reported a public key cannot hold a connection, and Box refuses
   * it rather than storing anything it could open.
   */
  createEmailProviderConnection: (
    token: string,
    accountId: string,
    input: EmailProviderConnectionInput,
  ) => Promise<EmailProviderConnection>;
  /**
   * ONE EXPLICIT CHECK that a connection's required DNS records are published.
   *
   * Never called by a page on load: verification is a request a person makes
   * (D10 records automated continuous verification as post-launch), and the
   * call is the only thing in this app that asks a service to look at
   * anybody's DNS. Answers one of the three `DnsVerificationState`s.
   */
  verifyEmailProviderConnection: (
    token: string,
    accountId: string,
    connectionId: number,
  ) => Promise<DnsVerification>;
  /**
   * The account's releases, newest first, capped at 100 rows. Optional status
   * filter. Member-scoped: an account the caller may not see is the same 404
   * as no account, which is the service's own stance.
   */
  listReleases: (token: string, accountId: string, filter?: { status?: ReleaseStatus }) => Promise<Release[]>;
  /** One release. Same member-scope as the list. */
  getRelease: (token: string, accountId: string, releaseId: number) => Promise<Release>;
  /**
   * THE ONLY MINTING PATH FOR AN APPROVAL TOKEN (invariant 5).
   *
   * A POST from the human's browser session, gated upstream on membership of
   * the release's account. The answer carries the opaque token, shown once.
   * Nothing else in this app mints one: not a screen load, not an agent's
   * request, not a flag. The release must be `pending` — minting for an
   * already-applied release is refused upstream with a 409.
   */
  approveRelease: (token: string, accountId: string, releaseId: number) => Promise<ReleaseApproval>;
  /**
   * THE MINT FOR A BOX ENROLLMENT CAPABILITY.
   *
   * A POST from the human's browser session, gated upstream on membership of
   * the account. The body names a NEW box id the caller generated
   * (`crypto.randomUUID()` on the screen) and the fixed purpose
   * `box.enroll`; the answer carries the single-use, minutes-lived token,
   * shown once. Nothing else in this app mints one: not a screen load, not
   * an agent's request. Regenerating is a second mint, which is why the
   * screen says the old token expires on its own rather than revoking it.
   */
  mintBoxCapability: (token: string, accountId: string, boxId: string) => Promise<BoxCapability>;
  /**
   * THE GRANT A HUMAN'S CLAIM BUYS (D4).
   *
   * A POST from the claiming human's browser session, carrying the claimed
   * agent's id. It is the SECOND HALF OF ONE CLICK: identity's claim route
   * binds the agent to the account, and this is what fires the `kit`
   * entitlement that binding buys — `Entitlement.grant!`, which is exactly
   * what Box's artifact-fetch check reads. Without it the agent holds
   * its credential, the account holds nothing, and every later
   * `artifact.fetch` answers 403 `entitlement_required` with nothing
   * upstream having errored.
   *
   * Three properties, each of them the service's rather than this client's:
   *
   *   * THE CALLER MUST BE A HUMAN'S SESSION. `require_account_member`
   *     verifies membership through identity, so an unknown account and "not
   *     a member" are the same 404. An AGENT's credential is refused with
   *     `agent_cannot_grant` — fail-closed, so this client never gets to
   *     decide who is human.
   *   * IT GRANTS EXACTLY `kit`. The base entitlement, `source:
   *     "agent_claim"`, `reference` the agent id. The paid units come from a
   *     reconciled payment through the operator surface, never from a claim.
   *   * IT IS IDEMPOTENT. An active row already existing is a 409 ANSWER
   *     (`duplicate: true`), not a failure — a retry after a network blip is
   *     safe, which is the only reason a retry of this half is honest at all.
   */
  claim: (token: string, accountId: string, agentId: string) => Promise<ClaimResult>;
};

/**
 * The `code` on a `BoxError` that means "this deployment has no
 * Box configured", as distinct from "Box is unreachable".
 *
 * The forwarder (`src/lib/upstream.ts`) answers a Box route with a 503
 * carrying this code when `BOX_URL` is unset. It lives here rather than
 * in the forwarder because the forwarder is server-only and the screens that
 * branch on it are client code.
 */
export const BOX_NOT_CONFIGURED_CODE = "box_not_configured";

// ---------------------------------------------------------------------------
// W3: boxes and email-provider connections
// ---------------------------------------------------------------------------
//
// Transcribed from Box's models (`app/models/installation.rb`,
// `app/models/email_provider_connection.rb`, on Box `main` after
// W3-P2), because the service's HTTP surface for these does not exist yet:
// Box's `config/routes.rb` still mounts only entitlements and
// capabilities, so there is no versioned document to transcribe from. The
// shapes below are the models' own shapes, in the member-scoped idiom
// Box's entitlements routes already use. **When Box lands the
// routes, this file is the transcription that has to be re-checked against
// them; if the two disagree, the service is right and this file is the bug.
//
// THE ONE RULE EVERY TYPE HERE OBEYS: no connection row carries a credential,
// and no method returns one. The stored credential is `sealed_credential`,
// an envelope sealed to the box's public key (boundary 6) — ciphertext
// Box cannot open, and therefore ciphertext this app has nothing to do
// with either. The POST carries the credential IN (Box seals it on the
// way in, via `create_sealed!`, which refuses a box with no public key) and
// never out. `readEmailProviderConnection` builds every row from named
// non-secret fields, so a response that carried a `sealed_credential` or a
// `credential` key would still produce a row with neither.
//
// AND THE FOURTH OPERATION IS A HEAD, NOT A MODEL. `verifyEmailProviderConnection`
// has no model behind it on Box's `main` at all — the models above are
// W3-P2's, but the DNS-verification state is not one of them, so the three
// states and the four reason codes below are the shape the packet
// (W3-P5 in `moon/AGENTS-FIRST.md`, decision D10) documents rather than a
// service's. When Box lands a verification surface, this is the
// transcription to re-check; if the two disagree, the service is right and this
// file is the bug. What is NOT a transcription is the record set the screen
// renders before asking: those values are Cloudflare's own, and
// `src/lib/dns-records.ts` names the page they were read from.

/**
 * The outcome of one explicit DNS verification check.
 *
 * THREE STATES AND NOT A SCORE, because the thing being checked has three
 * honest answers and a percentage would be a fourth one:
 *
 *   * `verified`  — every required record is published, and matches.
 *   * `not_yet`   — the records are not all published, or one does not match.
 *                   Cloudflare's own note on domain onboarding is that DNS
 *                   changes take up to 24 hours globally and usually 5–15
 *                   minutes on Cloudflare DNS, so this is the expected state
 *                   of a correct setup for the first quarter hour and is
 *                   rendered as a wait, not as a fault.
 *   * `unknown`   — the check could not be COMPLETED. The records may well be
 *                   right; nobody looked. `reason` says which of a closed set
 *                   of causes applies, and the screen translates it — the
 *                   service's own words never reach the DOM.
 *
 * There is no fourth "failed" state, because "the records are wrong" and "we
 * could not look" are different facts with different next steps and merging
 * them is how a customer ends up editing a correct record.
 */
export type DnsVerificationState = "verified" | "not_yet" | "unknown";

/**
 * The closed set of causes a `unknown` answer may carry.
 *
 * A closed set, because a reason this app cannot translate is a reason a
 * screen would either drop (losing the only actionable fact) or render (which
 * the house forbids: an internal code, host or port never reaches a person).
 * BOX_UNREACHABLE is the interesting one — the check runs on the box, because
 * the box is the only party holding the sealed credential, so "we could not
 * check" is usually "we could not reach your box".
 */
export const DNS_VERIFICATION_REASONS = [
  "box_unreachable",
  "zone_not_on_cloudflare_dns",
  "lookup_failed",
  "check_pending",
] as const;

export type DnsVerificationReason = (typeof DNS_VERIFICATION_REASONS)[number];

/** One explicit check's answer, for one connection. */
export type DnsVerification = {
  connection_id: number;
  state: DnsVerificationState;
  /** Present only on `unknown`. One of `DNS_VERIFICATION_REASONS`. */
  reason: DnsVerificationReason | null;
  /** When the check ran. Null on `unknown` outcomes that never completed. */
  checked_at: string | null;
};

/** A box's installation status, from `Installation::STATUSES`. */
export type BoxStatus = "enrolling" | "active" | "disabled";

/** A box's reported install phase, from `Installation::PHASES`. */
export type BoxPhase = "pending" | "enrolled" | "installing" | "complete" | "failed";

/**
 * One installation, as the box list answers it.
 *
 * `id` is Box's row id; `box_id` is the box's own identity, which the
 * box adopted at enrollment — Box never generated it. This shape is
 * Box's `serialize_installation` exactly: no `public_key`, because a
 * list has no business carrying a key even a public one, and no box
 * credential of any kind.
 */
export type Box = {
  id: number;
  box_id: string;
  account_id: string;
  status: BoxStatus;
  current_phase: BoxPhase;
};

/** The provider a connection speaks to, from `EmailProviderConnection::PROVIDERS`. */
export type EmailProviderName = "smtp" | "cloudflare";

export const EMAIL_PROVIDERS: readonly EmailProviderName[] = ["smtp", "cloudflare"];

/**
 * One email-provider connection, as the list and the create answer it.
 *
 * THE FIELDS THIS TYPE DOES NOT HAVE ARE THE POINT. There is no
 * `sealed_credential` and no `credential` member anywhere in this file's
 * surface: `config` holds non-secret settings only (Box's own
 * invariant — "a secret in `config` is a defect, not a configuration
 * choice"), and the credential exists on the wire in exactly one direction,
 * as a request body this app submits and forgets. `EmailProvidersScreen`
 * holds the screens to that in both directions: it never receives a stored
 * credential to render, and its form never populates a field from one.
 *
 * `config` is exposed as a string-only map. A non-string value in it is
 * dropped rather than rendered, because this app has no truth to offer about
 * a config it cannot read — and the only thing a screen does with the map is
 * show the settings a person typed.
 */
export type EmailProviderConnection = {
  id: number;
  provider: EmailProviderName;
  /** The provider-side account identifier. Not the Identity account. */
  account: string;
  /** The box this connection is sealed to. */
  box_id: string;
  config: Readonly<Record<string, string>>;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * What the connection form submits.
 *
 * `credential` is the provider secret (the Cloudflare API token), and it
 * travels once: form → box, where it is sealed to the box's public key
 * and discarded. It is never cached, never logged, and never rendered back.
 */
export type EmailProviderConnectionInput = {
  provider: EmailProviderName;
  box_id: string;
  account: string;
  config?: Record<string, string>;
  credential: string;
};

// ---------------------------------------------------------------------------
// W5: releases and approvals
// ---------------------------------------------------------------------------
//
// Transcribed from Box's controllers (`app/controllers/releases_controller.rb`,
// `app/controllers/approvals_controller.rb`, on Box `main` after W5-P1),
// which are the packet that landed the release-acceptance surface this screen
// is the other half of. The shapes are the controllers' own `serialize_*`
// methods, in the member-scoped idiom Box's entitlements routes already
// use.
//
// THE ONE RULE THIS SECTION EXISTS TO OBEY: `approveRelease` is the ONLY
// thing in this app that mints an approval token (invariant 5). An in-chat
// "yes" mints nothing — the mint is a POST from a human's browser session,
// gated upstream on account membership, and nothing else in this file can
// reach it. The token that comes back is a credential: it is shown once, to
// the caller, and this client never stores it.

/** A release's status, from `Release::STATUSES`. */
export type ReleaseStatus = "pending" | "applied";

/**
 * One upstream release, as the list and the show answer it.
 *
 * `id` is Box's row id — an integer, like every other row id in this
 * file. `status` is the service's own word and a screen never renames it:
 * `pending` means a human has not accepted, `applied` means an approval
 * token was redeemed. `release_notes` is the upstream's own prose, rendered
 * as-is because it is the one field on this screen a person reads rather
 * than scans.
 */
export type Release = {
  id: number;
  name: string;
  version: string;
  previous_version: string | null;
  release_notes: string | null;
  status: ReleaseStatus;
  account_id: string;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * A minted approval, as the create answers it.
 *
 * `token` is the opaque `appr_…` credential — the only copy that exists, shown
 * once to the caller. It is scoped (`tools`), minutes-lived (`expires_at`),
 * and bound to one release. This client returns it and stores nothing: the
 * token is the human's to hand to their agent, not a value this app keeps.
 */
export type ReleaseApproval = {
  id: number;
  release_id: number;
  account_id: string;
  tools: string[];
  level: string;
  issued_by: string;
  expires_at: string | null;
  token: string;
};

/**
 * A minted enrollment capability, as the create answers it.
 *
 * `token` is the opaque single-use credential — the only copy that exists,
 * shown once to the caller, minutes-lived (`expires_at`). It is bound to one
 * box (`box_id`) and one purpose (`box.enroll`). This client returns it and
 * stores nothing: the token is the human's to feed to `cafe box enroll`
 * over stdin, not a value this app keeps.
 */
export type BoxCapability = {
  token: string;
  purpose: string;
  box_id: string;
  expires_at: string | null;
};

export class BoxError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string | null;
  readonly traceId: string | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      title?: string | null;
      traceId?: string | null;
    },
  ) {
    super(message);
    this.name = "BoxError";
    this.status = options.status;
    this.code = options.code ?? "internal";
    this.title = options.title ?? null;
    this.traceId = options.traceId ?? null;
  }
}

/** The origin every call in this file is made against: this app, same-origin. */
export const BOX_BASE_URL = "";

const fetchTransport: BoxTransport = async ({ url, method, headers, body }) =>
  fetch(url, { method, headers, body, credentials: "same-origin" });

export function createBoxClient(
  options: { baseUrl?: string; transport?: BoxTransport } = {},
): BoxClient {
  const base = (options.baseUrl ?? BOX_BASE_URL).replace(/\/+$/, "");
  const transport = options.transport ?? fetchTransport;

  return {
    getAccountEntitlements: (token, accountId) => {
      requireToken(token);
      requireUuid(accountId, "getAccountEntitlements needs an account id");
      return send<{ entitlements: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/entitlements`,
        "GET",
        { token },
      ).then((body) => readCustomerEntitlements(body));
    },
    listEntitlements: (token, filter = {}) => {
      requireToken(token);
      if (filter.accountId !== undefined) {
        requireUuid(filter.accountId, "listEntitlements needs an account id uuid when filtering by account");
      }
      const params = new URLSearchParams();
      if (filter.accountId) params.set("account_id", filter.accountId);
      if (filter.status) params.set("status", filter.status);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return send<{ entitlements: unknown }>(
        transport,
        `${base}/v1/operator/entitlements${query}`,
        "GET",
        { token },
      ).then((body) => readStaffEntitlements(body));
    },
    grantEntitlement: (token, input) => {
      requireToken(token);
      requireUuid(input.account_id, "grantEntitlement needs an account id");
      return grant(transport, `${base}/v1/operator/entitlements`, token, input);
    },
    revokeEntitlement: (token, id) => {
      requireToken(token);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error("revokeEntitlement needs a positive integer entitlement id");
      }
      return send<{ entitlement: unknown }>(
        transport,
        `${base}/v1/operator/entitlements/${id}/revoke`,
        "POST",
        { token },
      ).then((body) => readStaffEntitlement(body.entitlement, "revoke"));
    },
    listBoxes: (token, accountId) => {
      requireToken(token);
      requireUuid(accountId, "listBoxes needs an account id");
      return send<{ installations: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/boxes`,
        "GET",
        { token },
      ).then((body) => readBoxes(body));
    },
    listEmailProviderConnections: (token, accountId) => {
      requireToken(token);
      requireUuid(accountId, "listEmailProviderConnections needs an account id");
      return send<{ connections: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/email-providers`,
        "GET",
        { token },
      ).then((body) => readEmailProviderConnections(body));
    },
    createEmailProviderConnection: (token, accountId, input) => {
      requireToken(token);
      requireUuid(accountId, "createEmailProviderConnection needs an account id");
      requireUuid(input.box_id, "createEmailProviderConnection needs a box id");
      if (!EMAIL_PROVIDERS.includes(input.provider)) {
        throw new Error(`createEmailProviderConnection needs a known provider: ${EMAIL_PROVIDERS.join(", ")}`);
      }
      if (input.account.trim() === "") {
        throw new Error("createEmailProviderConnection needs the provider-side account identifier");
      }
      if (input.credential.trim() === "") {
        throw new Error("createEmailProviderConnection needs a credential to seal");
      }
      return post<{ connection: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/email-providers`,
        token,
        input,
      ).then((body) => readEmailProviderConnection(body.connection, "create"));
    },
    verifyEmailProviderConnection: (token, accountId, connectionId) => {
      requireToken(token);
      requireUuid(accountId, "verifyEmailProviderConnection needs an account id");
      if (!Number.isInteger(connectionId) || connectionId <= 0) {
        throw new Error("verifyEmailProviderConnection needs a positive integer connection id");
      }
      return post<{ verification: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/email-providers/${connectionId}/verify`,
        token,
        {},
      ).then((body) => readDnsVerification(body.verification, "verify"));
    },
    listReleases: (token, accountId, filter = {}) => {
      requireToken(token);
      requireUuid(accountId, "listReleases needs an account id");
      if (filter.status !== undefined && filter.status !== "pending" && filter.status !== "applied") {
        throw new Error("listReleases needs a known status when filtering");
      }
      const params = new URLSearchParams();
      if (filter.status) params.set("status", filter.status);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return send<{ releases: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/releases${query}`,
        "GET",
        { token },
      ).then((body) => readReleases(body));
    },
    getRelease: (token, accountId, releaseId) => {
      requireToken(token);
      requireUuid(accountId, "getRelease needs an account id");
      if (!Number.isInteger(releaseId) || releaseId <= 0) {
        throw new Error("getRelease needs a positive integer release id");
      }
      return send<{ release: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/releases/${releaseId}`,
        "GET",
        { token },
      ).then((body) => readRelease(body.release, "show"));
    },
    approveRelease: (token, accountId, releaseId) => {
      requireToken(token);
      requireUuid(accountId, "approveRelease needs an account id");
      if (!Number.isInteger(releaseId) || releaseId <= 0) {
        throw new Error("approveRelease needs a positive integer release id");
      }
      return post<{ approval: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/releases/${releaseId}/approvals`,
        token,
        {},
      ).then((body) => readReleaseApproval(body.approval, "approve"));
    },
    mintBoxCapability: (token, accountId, boxId) => {
      requireToken(token);
      requireUuid(accountId, "mintBoxCapability needs an account id");
      requireUuid(boxId, "mintBoxCapability needs a box id");
      return post<{ capability: unknown }>(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/capabilities`,
        token,
        { box_id: boxId, purpose: "box.enroll" },
      ).then((body) => readBoxCapability(body.capability, "mint"));
    },
    claim: (token, accountId, agentId) => {
      requireToken(token);
      requireUuid(accountId, "claim needs an account id");
      // The agent id is Box's `reference` and its own `UUID_RE`, so a
      // value that is not a uuid is refused HERE rather than answered 422
      // there — the same discipline `requireUuid` keeps for the account.
      requireUuid(agentId, "claim needs an agent id");
      return claimGrant(
        transport,
        `${base}/v1/accounts/${encodeURIComponent(accountId)}/claims`,
        token,
        agentId,
      );
    },
  };
}

/**
 * The D4 grant: the claim's own POST, in Box's answer idiom.
 *
 * Its own function rather than a reuse of `grant` because the BODY is
 * different — this one carries the claimed agent's id and nothing else — and
 * because the 409 has a different weight here. It is still the same shape of
 * answer as `grant`: a 201 mints the row, a 409 returns the row this account
 * already holds with `duplicate: true`, and both are success.
 */
async function claimGrant(
  transport: BoxTransport,
  url: string,
  token: string,
  agentId: string,
): Promise<ClaimResult> {
  const response = await transport({
    url,
    method: "POST",
    headers: {
      Accept: "application/json, application/problem+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (response.status === 201 || response.status === 409) {
    const body = asRecord(await readJson(response, url));
    return {
      entitlement: readStaffEntitlement(body?.entitlement, "claim"),
      duplicate: response.status === 409,
    };
  }
  throw await parseError(response);
}

async function grant(
  transport: BoxTransport,
  url: string,
  token: string,
  input: GrantInput,
): Promise<GrantResult> {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const response = await transport({ url, method: "POST", headers, body: JSON.stringify(input) });
  if (response.status === 201 || response.status === 409) {
    const body = asRecord(await readJson(response, url));
    return {
      entitlement: readStaffEntitlement(body?.entitlement, "grant"),
      duplicate: response.status === 409,
    };
  }
  throw await parseError(response);
}

/**
 * POSTs a JSON body and reads the answer, or throws the parsed failure.
 *
 * The grant above keeps its own shape because a 409 there is an ANSWER
 * (`duplicate: true`) rather than a failure. Everywhere else a non-2xx is a
 * failure, and this is that everywhere-else.
 */
async function post<T>(
  transport: BoxTransport,
  url: string,
  token: string,
  body: unknown,
): Promise<T> {
  const response = await transport({
    url,
    method: "POST",
    headers: {
      Accept: "application/json, application/problem+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (response.status === 201 || response.status === 200) {
    return (await readJson(response, url)) as T;
  }
  throw await parseError(response);
}

async function send<T>(
  transport: BoxTransport,
  url: string,
  method: BoxTransportRequest["method"],
  options: { token: string },
): Promise<T> {
  const response = await transport({
    url,
    method,
    headers: {
      Accept: "application/json, application/problem+json",
      Authorization: `Bearer ${options.token}`,
    },
  });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await readJson(response, url)) as T;
}

async function readJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    throw new BoxError(`box returned an empty body for ${url} (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BoxError(`box returned a body that is not JSON (${response.status})`, {
      status: response.status,
      code: "internal",
    });
  }
}

/**
 * Turns a failure response into a `BoxError`.
 *
 * Box answers `{error:{code, message}}` with its own codes; a
 * `problem+json` body is read too, because the forwarder mints those for its
 * own refusals (404 no-such-route, 502 unreachable, 503 not-configured) in the
 * same envelope. `detail` is never rendered: it is occurrence-specific, and a
 * screen writes its own sentence.
 */
async function parseError(response: Response): Promise<BoxError> {
  const { status } = response;
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    // A body that cannot even be read is still a failure we can describe.
  }
  const body = asRecord(safeParse(raw));
  const traceId = readString(body?.trace_id) ?? response.headers.get("X-Trace-Id");
  const nested = asRecord(body?.error);
  if (nested) {
    return new BoxError(
      readString(nested.message) ?? readString(nested.detail) ?? `Request to box failed (${status})`,
      {
        status,
        code: readString(nested.code) ?? "internal",
        title: readString(nested.title) ?? readString(nested.message) ?? null,
        traceId,
      },
    );
  }
  if (body) {
    const code = readString(body.code) ?? "internal";
    const title = readString(body.title) ?? null;
    const detail = readString(body.detail);
    return new BoxError(detail ?? title ?? `Request to box failed (${status})`, {
      status,
      code,
      title,
      traceId,
    });
  }
  return new BoxError(`Request to box failed (${status})`, { status, traceId });
}

const BOX_STATUSES: readonly BoxStatus[] = ["enrolling", "active", "disabled"];
const BOX_PHASES: readonly BoxPhase[] = ["pending", "enrolled", "installing", "complete", "failed"];

function readBoxes(body: { installations: unknown }): Box[] {
  if (!Array.isArray(body.installations)) {
    throw new BoxError("box answered a body this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return body.installations.map((entry) => readBox(entry));
}

function readBox(entry: unknown): Box {
  const record = asRecord(entry);
  const id = record?.id;
  const boxId = record ? readString(record.box_id) : null;
  const accountId = record ? readString(record.account_id) : null;
  const status = record?.status;
  const phase = record?.current_phase;
  if (typeof id !== "number" || !Number.isInteger(id) || boxId === null || accountId === null) {
    throw new BoxError("box answered a box this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  if (!BOX_STATUSES.includes(status as BoxStatus) || !BOX_PHASES.includes(phase as BoxPhase)) {
    throw new BoxError("box answered a box this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return {
    id,
    box_id: boxId,
    account_id: accountId,
    status: status as BoxStatus,
    current_phase: phase as BoxPhase,
  };
}

function readEmailProviderConnections(body: { connections: unknown }): EmailProviderConnection[] {
  if (!Array.isArray(body.connections)) {
    throw new BoxError("box answered a body this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return body.connections.map((entry) => readEmailProviderConnection(entry, "list"));
}

/**
 * Builds one connection row from the NAMED non-secret fields, and nothing else.
 *
 * This is the function that makes boundary 6 hold on this side of the wire.
 * A response carrying `sealed_credential`, `credential`, or any other
 * envelope-shaped key produces a row that has none of them, because the only
 * keys copied out of the response are the seven named below. The envelope is
 * box's to hold and the box's to open; this app never has a reason to
 * touch it, and a reader that copied unknown keys would be a reader that
 * could be taught to.
 */
function readEmailProviderConnection(entry: unknown, operation: string): EmailProviderConnection {
  const record = asRecord(entry);
  const id = record?.id;
  const provider = record?.provider;
  const account = record ? readString(record.account) : null;
  const boxId = record ? readString(record.box_id) : null;
  if (typeof id !== "number" || !Number.isInteger(id) || account === null || boxId === null) {
    throw new BoxError(`box's ${operation} answered a connection this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  if (!EMAIL_PROVIDERS.includes(provider as EmailProviderName)) {
    throw new BoxError(`box's ${operation} answered a connection this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return {
    id,
    provider: provider as EmailProviderName,
    account,
    box_id: boxId,
    config: readConfigMap(record?.config),
    created_at: readNullableString(record?.created_at),
    updated_at: readNullableString(record?.updated_at),
  };
}

/**
 * Reads one verification answer.
 *
 * THE STATE IS A CLOSED SET, and an answer carrying a fourth one is refused
 * rather than rendered as the closest of the three. That is the same rule
 * every reader in this file holds, and it matters more here than anywhere:
 * a screen with three branches that is handed a state it has no branch for
 * has exactly two bad options, show a fact it cannot interpret or fall through
 * to a generic sentence that reads as a fault.
 */
function readDnsVerification(entry: unknown, operation: string): DnsVerification {
  const record = asRecord(entry);
  const connectionId = record?.connection_id;
  const state = record?.state;
  if (typeof connectionId !== "number" || !Number.isInteger(connectionId)) {
    throw new BoxError(`box's ${operation} answered a verification this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  if (state !== "verified" && state !== "not_yet" && state !== "unknown") {
    throw new BoxError(`box's ${operation} answered a verification this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  const reason = readNullableString(record?.reason);
  return {
    connection_id: connectionId,
    state,
    reason: reason !== null && DNS_VERIFICATION_REASONS.includes(reason as DnsVerificationReason)
      ? (reason as DnsVerificationReason)
      : null,
    checked_at: readNullableString(record?.checked_at),
  };
}

function readReleases(body: { releases: unknown }): Release[] {
  if (!Array.isArray(body.releases)) {
    throw new BoxError("box answered a body this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return body.releases.map((entry) => readRelease(entry, "list"));
}

/**
 * Reads one release row.
 *
 * THE STATUS IS A CLOSED SET, and an answer carrying a third one is refused
 * rather than rendered as the closest of the two — the same rule every reader
 * in this file holds. `pending` and `applied` are the only two states the
 * service has, and a screen with two branches that is handed a state it has
 * no branch for has exactly two bad options.
 */
function readRelease(entry: unknown, operation: string): Release {
  const record = asRecord(entry);
  const id = record?.id;
  const name = record ? readString(record.name) : null;
  const version = record ? readString(record.version) : null;
  const status = record?.status;
  if (
    record === null ||
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    name === null ||
    version === null ||
    (status !== "pending" && status !== "applied")
  ) {
    throw new BoxError(`box's ${operation} answered a release this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return {
    id,
    name,
    version,
    previous_version: readNullableString(record.previous_version),
    release_notes: readNullableString(record.release_notes),
    status,
    account_id: readString(record.account_id) ?? "",
    created_at: readNullableString(record.created_at),
    updated_at: readNullableString(record.updated_at),
  };
}

/**
 * Reads one minted enrollment capability.
 *
 * The `token` is the credential. It is read as a plain string and returned —
 * the only copy that exists, shown once to the caller. This client stores
 * nothing and logs nothing: the token is the human's to feed to their
 * box over stdin. The `purpose` is read but not narrowed: the service owns
 * the vocabulary and a screen renders its own sentence rather than the
 * service's word.
 */
function readBoxCapability(entry: unknown, operation: string): BoxCapability {
  const record = asRecord(entry);
  const token = record ? readString(record.token) : null;
  const boxId = record ? readString(record.box_id) : null;
  if (record === null || token === null || boxId === null) {
    throw new BoxError(`box's ${operation} answered a capability this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return {
    token,
    purpose: readString(record.purpose) ?? "",
    box_id: boxId,
    expires_at: readNullableString(record.expires_at),
  };
}

/**
 * Reads one minted approval.
 *
 * The `token` is the credential. It is read as a plain string and returned —
 * the only copy that exists, shown once to the caller. This client stores
 * nothing and logs nothing: the token is the human's to hand to their agent.
 */
function readReleaseApproval(entry: unknown, operation: string): ReleaseApproval {
  const record = asRecord(entry);
  const id = record?.id;
  const releaseId = record?.release_id;
  const token = record ? readString(record.token) : null;
  const issuedBy = record ? readString(record.issued_by) : null;
  if (
    record === null ||
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    typeof releaseId !== "number" ||
    !Number.isInteger(releaseId) ||
    token === null ||
    issuedBy === null
  ) {
    throw new BoxError(`box's ${operation} answered an approval this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  const tools = Array.isArray(record.tools)
    ? record.tools.filter((tool): tool is string => typeof tool === "string")
    : [];
  return {
    id,
    release_id: releaseId,
    account_id: readString(record.account_id) ?? "",
    tools,
    level: readString(record.level) ?? "",
    issued_by: issuedBy,
    expires_at: readNullableString(record.expires_at),
    token,
  };
}

/**
 * The non-secret config, as a string-only map.
 *
 * `config` is box's jsonb of provider settings. A non-string value is
 * dropped rather than coerced: the only thing a screen does with the map is
 * show the settings a person typed, and a shape this app cannot read has no
 * honest rendering. A missing or non-object `config` reads as the empty map
 * the column defaults to.
 */
function readConfigMap(value: unknown): Readonly<Record<string, string>> {
  const record = asRecord(value);
  if (record === null) return {};
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") map[key] = entry;
  }
  return map;
}

function readCustomerEntitlements(body: { entitlements: unknown }): CustomerEntitlement[] {
  if (!Array.isArray(body.entitlements)) {
    throw new BoxError("box answered a body this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return body.entitlements.map((entry) => readCustomerEntitlement(entry));
}

function readStaffEntitlements(body: { entitlements: unknown }): StaffEntitlement[] {
  if (!Array.isArray(body.entitlements)) {
    throw new BoxError("box answered a body this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return body.entitlements.map((entry) => readStaffEntitlement(entry, "list"));
}

function readCustomerEntitlement(entry: unknown): CustomerEntitlement {
  const record = asRecord(entry);
  const accountId = record ? readString(record.account_id) : null;
  if (accountId === null || record?.product !== "kit" || record?.status !== "active") {
    throw new BoxError("box answered a row this app does not recognise", {
      status: 200,
      code: "internal",
    });
  }
  return {
    account_id: accountId,
    product: "kit",
    status: "active",
    source: readNullableString(record.source),
    reference: readNullableString(record.reference),
    granted_at: readNullableString(record.granted_at),
    revoked_at: readNullableString(record.revoked_at),
  };
}

function readStaffEntitlement(entry: unknown, operation: string): StaffEntitlement {
  const record = asRecord(entry);
  const id = record?.id;
  const accountId = record ? readString(record.account_id) : null;
  const status = record?.status;
  if (typeof id !== "number" || !Number.isInteger(id) || accountId === null) {
    throw new BoxError(`box's ${operation} answered a row this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  if (record?.product !== "kit" || (status !== "active" && status !== "revoked")) {
    throw new BoxError(`box's ${operation} answered a row this app does not recognise`, {
      status: 200,
      code: "internal",
    });
  }
  return {
    id,
    account_id: accountId,
    product: "kit",
    status,
    source: readNullableString(record.source),
    reference: readNullableString(record.reference),
    granted_by: readNullableString(record.granted_by),
    revoked_by: readNullableString(record.revoked_by),
    granted_at: readNullableString(record.granted_at),
    revoked_at: readNullableString(record.revoked_at),
  };
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireToken(token: string): void {
  if (token.trim() === "") {
    throw new Error("box calls need the caller's session token: it is the credential Box forwards to identity");
  }
}

function requireUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${message}: expected a uuid`);
  }
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

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length > 0 ? value : null;
}
