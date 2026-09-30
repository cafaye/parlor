/**
 * Roles, the capability matrix, and the name rules.
 *
 * Everything here is a transcription of the identity service's tenancy
 * authorization, kept in one file so no screen has to re-derive it. The
 * authority is the service; this file is a copy of two places in it:
 *
 *   - the ordering and the three role names, from
 *     `identity/internal/accounts/accounts.go` (`AllRoles`, `Role.AtLeast`);
 *   - the matrix, from `identity/internal/httpapi/accounts.go`
 *     (`registerTenancyRoutes`), which puts each route's minimum role on the
 *     same line as its path, and from `Service.InviteRole` for the one rule
 *     that depends on the *target* rather than the caller.
 *
 * It is a copy, so it can go stale, and the honest way to use it is as a
 * reason not to offer a button — never as a reason to believe the button would
 * have worked. The service answers 403 to anything this file gets wrong, and
 * that is the authority every screen defers to.
 *
 * Nothing here fetches. It is pure vocabulary, which is why it can be tested
 * without a transport and why a component test cannot reach the network
 * through it.
 */

/** A membership's authority in an account. */
export type Role = "member" | "admin" | "owner";

/** Every role, weakest first. The order is the point: `roleAtLeast` walks it. */
export const ALL_ROLES: readonly Role[] = ["member", "admin", "owner"] as const;

/**
 * What a role in an account lets somebody do.
 *
 * These are the actions the tenancy surface actually exposes, named after what
 * the person does rather than after the endpoint, so a screen reads as
 * "can this person remove a member" and not "can this person call
 * DELETE /v1/accounts/:id/members/:userId".
 */
export type Capability =
  | "viewAccount"
  | "viewMembers"
  | "renameAccount"
  | "inviteMember"
  | "inviteAdmin"
  | "changeMemberRole"
  | "removeMember"
  | "deleteAccount";

/**
 * The minimum role for each capability.
 *
 * Read this as the route table in the service, one line each:
 *
 *   GET    /v1/accounts/:id                  member
 *   GET    /v1/accounts/:id/members          member
 *   PATCH  /v1/accounts/:id                  admin
 *   POST   /v1/accounts/:id/invitations      admin
 *   PATCH  /v1/accounts/:id/members/:userId  owner
 *   DELETE /v1/accounts/:id/members/:userId  admin
 *   DELETE /v1/accounts/:id                  owner
 *
 * `inviteMember` and `inviteAdmin` are one route and two answers, because the
 * service splits them: an admin may invite a member, and only an owner may hand
 * out admin, "or an admin can clone themselves into a second admin who answers
 * to nobody". That rule is about the *role being granted*, not the caller's
 * route, so it cannot live in a single minimum.
 */
const MINIMUM_ROLE: Record<Capability, Role> = {
  viewAccount: "member",
  viewMembers: "member",
  renameAccount: "admin",
  inviteMember: "admin",
  inviteAdmin: "owner",
  changeMemberRole: "owner",
  removeMember: "admin",
  deleteAccount: "owner",
};

/**
 * Narrows an untrusted string to a role.
 *
 * An unknown role is refused rather than defaulted, and that is the point: the
 * service documents that a role this build does not know "must fail closed".
 * A screen that coerced an unknown role into `member` would be more permissive
 * than the service in exactly the direction that matters.
 */
export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/** Whether `role` is at or above `minimum`. The one comparison, used everywhere. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ALL_ROLES.indexOf(role) >= ALL_ROLES.indexOf(minimum);
}

/**
 * Whether `role` may do `capability`.
 *
 * An unrecognized capability is denied. A table lookup that misses must not
 * fall through to "allowed", because the cost of that being wrong is a button
 * that offers a stranger somebody else's account.
 */
export function can(role: Role, capability: Capability): boolean {
  const minimum = MINIMUM_ROLE[capability];
  return minimum !== undefined && roleAtLeast(role, minimum);
}

/**
 * The roles this person may put on an invitation.
 *
 * The same rule as `can`, expressed as the list rather than the test, because
 * the invite form needs to render a `<select>` and rendering an option that
 * would 422 is worse than not offering it.
 *
 * `owner` is never in the list: `ParseInvitableRole` refuses anything that is
 * not invitable, and an account's owner is whoever created it.
 */
export function invitableRoles(role: Role): Role[] {
  return ALL_ROLES.filter((candidate) => {
    // Owner is not invitable at all: an account's owner is whoever created it.
    if (candidate === "owner") return false;
    // Each role is gated on the capability that grants *it*, which is the whole
    // reason `inviteMember` and `inviteAdmin` are two capabilities and not one.
    const capability: Capability = candidate === "admin" ? "inviteAdmin" : "inviteMember";
    return can(role, capability);
  });
}

/** The role as a person reads it. */
export function roleLabel(role: Role): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
  }
}

/** One sentence on what the role is for, in the service's own terms. */
export function roleSummary(role: Role): string {
  switch (role) {
    case "owner":
      return "Full control, including changing roles and deleting the account.";
    case "admin":
      return "Can rename the account and invite and remove members, but cannot delete it.";
    case "member":
      return "Can read the account and its member list, and change nothing.";
  }
}

/**
 * The service's own bound on `accounts.name`.
 *
 * "120 is generous for a workspace name and small enough that an account list
 * is not a payload" — `internal/accounts/accounts.go`, `MaxNameLength`.
 */
export const MAX_NAME_LENGTH = 120;

/** One `{field, code}` pair, in the shape the error envelope carries them. */
export type NameFieldError = { field: "name"; code: "required" | "invalid_format" | "too_long" };

/**
 * A mirror of the service's `Slugify`, and the only reason
 * `validateAccountName` can tell a person their name will not work.
 *
 * Lower-cases ASCII, keeps digits, and treats every other character — space,
 * punctuation, non-ASCII, control characters — as a separator, collapsing a run
 * of them to one dash and dropping leading and trailing ones. Mirrored rather
 * than imported because the service is Go and this is TypeScript; the service
 * is the authority, and this copy is only here to save a round trip.
 */
export function slugify(name: string): string {
  let out = "";
  let pendingDash = false;

  // `for…of` walks code points, which is the same unit the service's
  // `for _, r := range name` walks.
  for (const character of name) {
    const isLower = character >= "a" && character <= "z";
    const isDigit = character >= "0" && character <= "9";
    const isUpper = character >= "A" && character <= "Z";

    if (isLower || isDigit || isUpper) {
      if (pendingDash && out.length > 0) out += "-";
      pendingDash = false;
      out += isUpper ? character.toLowerCase() : character;
    } else {
      // A pending dash is left to the next alphanumeric, so a run of
      // separators collapses to one and a leading run produces nothing.
      pendingDash = out.length > 0;
    }
  }

  return out.slice(0, 63);
}

/**
 * The service's `ValidateName`, mirrored, for the same reason as `slugify`.
 *
 * The three rules and their codes are the service's, and the order matters:
 * a blank name is `required` rather than `invalid_format`, because "you left it
 * blank" and "we cannot make a slug out of this" are different sentences.
 *
 * The service is the authority. This exists so a person is told the rule before
 * a round trip, not instead of one.
 */
export function validateAccountName(name: string): NameFieldError[] {
  if (name.trim() === "") return [{ field: "name", code: "required" }];
  // Counted in characters, like the service's `len([]rune(normalized))`. A
  // byte-length check would reject a name of emoji that the service accepts.
  if ([...name].length > MAX_NAME_LENGTH) return [{ field: "name", code: "too_long" }];
  if (slugify(name) === "") return [{ field: "name", code: "invalid_format" }];
  return [];
}
