import type { Account, AccountDetail, AccountListItem, Invitation, Membership } from "@/lib/identity";
import type { Role } from "@/lib/roles";

/**
 * Fixtures for the tenancy screens.
 *
 * Every shape here is copied out of the service's handler,
 * `identity/internal/httpapi/accounts.go` — the `json:` tags on
 * accountResponse, accountListItem, membershipResponse and invitationResponse.
 * They are the contract, not invented data: a test that asserts against these
 * is asserting against what the service actually writes on the wire.
 *
 * See `src/lib/identity.test.ts` for the same shapes asserted at the request
 * level, and the packet report for why these come from the handler rather than
 * from `openapi/v1.yaml`.
 */

export const ACCOUNT_ID = "acc_0a1b2c3d";

/** accountResponse as `handleCreateAccount` and `handleGetAccount` write it. */
export function anAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: ACCOUNT_ID,
    name: "Acme Corp",
    slug: "acme-corp",
    personal: false,
    role: "owner",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

/** accountListItem — no `members`, no `updated_at`; the service omits both. */
export function anAccountListItem(overrides: Partial<AccountListItem> = {}): AccountListItem {
  return {
    id: ACCOUNT_ID,
    name: "Acme Corp",
    slug: "acme-corp",
    personal: false,
    role: "owner",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

/** The detail response, which is the one shape that carries `members`. */
export function anAccountDetail(overrides: Partial<AccountDetail> = {}): AccountDetail {
  return { ...anAccount(), members: [], ...overrides };
}

/** membershipResponse with every field the struct declares. */
export function aMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    account_id: ACCOUNT_ID,
    user_id: "usr_participant_01",
    role: "member",
    created_at: "2026-09-02T11:00:00Z",
    ...overrides,
  };
}

/**
 * A membership as the service ACTUALLY sends one in a member list.
 *
 * This fixture exists because of a bug in the service, and it is the shape the
 * account screen has to survive today.
 *
 * `membershipResponses` in `internal/httpapi/accounts.go` builds each row as
 * `membershipResponse{Role: m.Role}` and nothing else, and `MemberSummary` in
 * `internal/accounts/store.go` carries only an `Account` and a `Role` — so
 * there is no user id in the store to copy even if the projection wanted it.
 * The declared struct has `account_id`, `user_id` and `created_at`; a member
 * list therefore arrives with an empty user id, an empty account id and a zero
 * time.
 *
 * The consequences are all real: a member row cannot say who it is, and the
 * per-member actions (`PATCH`/`DELETE /v1/accounts/:id/members/:userId`) have
 * no id to put in the path. The account screen detects this and says so rather
 * than rendering a row with a blank name and a button that cannot work.
 *
 * `handleAcceptInvitation` and `handleChangeRole` are unaffected: they build
 * their response inline and do send `user_id`, which is why `aMembership` above
 * has one and the service's own test asserts it.
 */
export function aMembershipAsTheServiceSendsIt(overrides: Partial<Membership> = {}): Membership {
  return {
    account_id: "",
    user_id: "",
    role: "member",
    // Go's zero time, which is what an unpopulated `time.Time` marshals to.
    created_at: "0001-01-01T00:00:00Z",
    ...overrides,
  };
}

/** invitationResponse — the 201, and the only response carrying a token. */
export function anInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv_7f6e5d",
    account_id: ACCOUNT_ID,
    email: "newcomer@example.com",
    role: "member",
    token: "invitation-token-once-only",
    expires_at: "2026-09-08T10:05:00Z",
    created_at: "2026-09-01T10:05:00Z",
    ...overrides,
  };
}

/** A signed-in user whose id the account screen can recognise in a member row. */
export const CALLER = { id: "usr_caller_01", email: "kaka@example.com" };

/** A member list shaped the way the service sends it, one row per role. */
export function aMemberList(roles: Role[]) {
  return {
    memberships: roles.map((role) => aMembershipAsTheServiceSendsIt({ role })),
    role: "owner" as Role,
  };
}
