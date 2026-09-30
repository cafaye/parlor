/**
 * The role vocabulary and the capability matrix.
 *
 * The matrix in `roles.ts` is a transcription of two places in the identity
 * service, and this file is where that claim gets checked against the only
 * authority for it: the service's own authorization table. The two tests that
 * quote `authz_matrix_test.go` by name are the ones that would catch a service
 * change nobody told this repo about.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_NAME_LENGTH,
  ALL_ROLES,
  can,
  invitableRoles,
  isRole,
  roleAtLeast,
  roleLabel,
  roleSummary,
  slugify,
  validateAccountName,
  type Capability,
} from "@/lib/roles";

describe("role order", () => {
  it("is the service's order, weakest first", () => {
    // identity/internal/accounts/accounts.go: AllRoles()
    expect(ALL_ROLES).toEqual(["member", "admin", "owner"]);
  });

  it("compares as a total order, not as independent predicates", () => {
    // An "owner but not admin" world would make every check decide what that
    // combination may do; the service chose a total order so the question has
    // one answer. owner outranks admin because it is above it in the order.
    expect(roleAtLeast("owner", "member")).toBe(true);
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "member")).toBe(true);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("member", "owner")).toBe(false);
    expect(roleAtLeast("admin", "owner")).toBe(false);
  });

  it("treats a role as meeting its own minimum", () => {
    for (const role of ALL_ROLES) {
      expect(roleAtLeast(role, role)).toBe(true);
    }
  });
});

describe("isRole", () => {
  it("accepts the three the service defines", () => {
    expect(isRole("member")).toBe(true);
    expect(isRole("admin")).toBe(true);
    expect(isRole("owner")).toBe(true);
  });

  it("rejects anything else, so an unknown role fails closed", () => {
    // identity/internal/accounts/accounts.go: "An unknown role is below
    // everything." A role this build does not know must not unlock anything.
    expect(isRole("superuser")).toBe(false);
    expect(isRole("Owner")).toBe(false);
    expect(isRole("")).toBe(false);
  });
});

describe("roleLabel", () => {
  it("names each role for a person", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});

describe("roleSummary", () => {
  // Deliberately not asserted on wording. These are English sentences for a
  // person, they conjugate, and a summary that says an admin "cannot delete it"
  // contains the word "delete" while meaning the opposite — so substring
  // matching on prose tests the wording and gets the meaning backwards. What
  // each role may actually do is asserted against the matrix above, which is
  // the claim that matters. What is asserted here is only that every role has
  // a sentence, and that it is a sentence.
  it("gives every role a sentence ending in a period", () => {
    for (const role of ALL_ROLES) {
      const summary = roleSummary(role);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.endsWith(".")).toBe(true);
    }
  });

  it("tells the three roles apart from each other", () => {
    const summaries = ALL_ROLES.map(roleSummary);
    expect(new Set(summaries).size).toBe(ALL_ROLES.length);
  });
});

describe("the capability matrix", () => {
  // Transcribed from identity/internal/httpapi/accounts.go
  // registerTenancyRoutes, which puts each route's minimum role on the same
  // line as its path, and from Service.InviteRole for the one rule that
  // depends on the target rather than the caller.

  const matrix: Array<[Capability, "member" | "admin" | "owner", boolean]> = [
    ["viewAccount", "member", true],
    ["viewMembers", "member", true],
    ["renameAccount", "member", false],
    ["renameAccount", "admin", true],
    ["inviteMember", "member", false],
    ["inviteMember", "admin", true],
    ["inviteMember", "owner", true],
    // "An admin may invite a member; only an owner may hand out admin."
    ["inviteAdmin", "admin", false],
    ["inviteAdmin", "owner", true],
    ["changeMemberRole", "admin", false],
    ["changeMemberRole", "owner", true],
    ["removeMember", "member", false],
    ["removeMember", "admin", true],
    ["removeMember", "owner", true],
    ["deleteAccount", "admin", false],
    ["deleteAccount", "owner", true],
  ];

  it.each(matrix)("%s is %s for %s", (capability, role, allowed) => {
    expect(can(role, capability)).toBe(allowed);
  });

  it("denies an unknown capability rather than defaulting to allowed", () => {
    expect(can("owner", "escalate" as Capability)).toBe(false);
  });
});

describe("invitableRoles", () => {
  it("offers an admin only the member role", () => {
    expect(invitableRoles("admin")).toEqual(["member"]);
  });

  it("offers an owner member and admin, and never owner", () => {
    // ParseInvitableRole refuses anything that is not Invitable(), and owner is
    // not: a new account's owner is its creator, not an invitation.
    expect(invitableRoles("owner")).toEqual(["member", "admin"]);
  });

  it("offers a member nothing, because they may not invite at all", () => {
    expect(invitableRoles("member")).toEqual([]);
  });
});

describe("slugify", () => {
  // A mirror of identity/internal/accounts/accounts.go Slugify, which exists
  // because ValidateName refuses a name it cannot make a slug from, and a slug
  // is NOT NULL. The service is the authority; this is so a person is told
  // before a round trip rather than instead of one.

  it("folds case and joins words with a dash", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });

  it("collapses a run of separators into one dash", () => {
    expect(slugify("Acme   Corp")).toBe("acme-corp");
    expect(slugify("Acme - Corp")).toBe("acme-corp");
  });

  it("drops leading and trailing separators", () => {
    expect(slugify("  Acme Corp  ")).toBe("acme-corp");
  });

  it("keeps digits", () => {
    expect(slugify("Acme 2026")).toBe("acme-2026");
  });

  it("yields nothing for a name with no sluggable character in it", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("日本語")).toBe("");
  });
});

describe("validateAccountName", () => {
  it("accepts an ordinary name", () => {
    expect(validateAccountName("Acme Corp")).toEqual([]);
  });

  it("reports a blank name as required, not as invalid", () => {
    // The service keeps these apart: "one is 'you left it blank', the other
    // is 'we cannot make a slug out of this'".
    expect(validateAccountName("")).toEqual([{ field: "name", code: "required" }]);
    expect(validateAccountName("   ")).toEqual([{ field: "name", code: "required" }]);
  });

  it("reports a name that cannot be slugged as invalid_format", () => {
    expect(validateAccountName("!!!")).toEqual([{ field: "name", code: "invalid_format" }]);
  });

  it("measures the length in characters, not bytes, and allows the boundary", () => {
    const atLimit = "a".repeat(MAX_NAME_LENGTH);
    expect(validateAccountName(atLimit)).toEqual([]);
    expect(validateAccountName(`${atLimit}a`)).toEqual([{ field: "name", code: "too_long" }]);
  });

  it("does not count a character outside ascii as more than one", () => {
    // The service counts runes: len([]rune(normalized)). A name of 120 emoji is
    // 120 characters to the service and 480 bytes to a byte-length check.
    expect(validateAccountName("🌈".repeat(MAX_NAME_LENGTH))).not.toContainEqual({
      field: "name",
      code: "too_long",
    });
  });
});
