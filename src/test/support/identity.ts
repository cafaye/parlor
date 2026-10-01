import { vi, type MockedFunction } from "vitest";

import { IdentityError, type IdentityClient, type User } from "@/lib/identity";

/**
 * A scripted identity client for component tests.
 *
 * The real client is covered by `identity.test.ts` against a transport stub.
 * This exists for the layer above it: the forms and the header only need an
 * `IdentityClient`, and handing them one means a render test can never reach
 * the network even by accident.
 *
 * Scripted methods come back as `vi.fn`, so a test can assert on what the tree
 * sent. The un-scripted ones reject loudly rather than quietly returning
 * `undefined` — a form that calls `me()` because of a bug should say so.
 */
export type StubIdentity = IdentityClient & {
  register: MockedFunction<IdentityClient["register"]>;
  login: MockedFunction<IdentityClient["login"]>;
  logout: MockedFunction<IdentityClient["logout"]>;
  me: MockedFunction<IdentityClient["me"]>;
  listAccounts: MockedFunction<IdentityClient["listAccounts"]>;
  createAccount: MockedFunction<IdentityClient["createAccount"]>;
  getAccount: MockedFunction<IdentityClient["getAccount"]>;
  renameAccount: MockedFunction<IdentityClient["renameAccount"]>;
  deleteAccount: MockedFunction<IdentityClient["deleteAccount"]>;
  listMembers: MockedFunction<IdentityClient["listMembers"]>;
  inviteMember: MockedFunction<IdentityClient["inviteMember"]>;
  acceptInvitation: MockedFunction<IdentityClient["acceptInvitation"]>;
  changeMemberRole: MockedFunction<IdentityClient["changeMemberRole"]>;
  removeMember: MockedFunction<IdentityClient["removeMember"]>;
  requestPasswordReset: MockedFunction<IdentityClient["requestPasswordReset"]>;
  redeemPasswordReset: MockedFunction<IdentityClient["redeemPasswordReset"]>;
  requestEmailVerification: MockedFunction<IdentityClient["requestEmailVerification"]>;
  redeemEmailVerification: MockedFunction<IdentityClient["redeemEmailVerification"]>;
  verificationStatus: MockedFunction<IdentityClient["verificationStatus"]>;
};

const unscripted = (method: string) =>
  vi.fn(async () => {
    throw new Error(`stub identity: ${method}() was not scripted`);
  }) as never;

export function stubIdentity(overrides: Partial<IdentityClient> = {}): StubIdentity {
  return {
    register: vi.fn(overrides.register ?? unscripted("register")),
    login: vi.fn(overrides.login ?? unscripted("login")),
    logout: vi.fn(overrides.logout ?? unscripted("logout")),
    me: vi.fn(overrides.me ?? unscripted("me")),
    listAccounts: vi.fn(overrides.listAccounts ?? unscripted("listAccounts")),
    createAccount: vi.fn(overrides.createAccount ?? unscripted("createAccount")),
    getAccount: vi.fn(overrides.getAccount ?? unscripted("getAccount")),
    renameAccount: vi.fn(overrides.renameAccount ?? unscripted("renameAccount")),
    deleteAccount: vi.fn(overrides.deleteAccount ?? unscripted("deleteAccount")),
    listMembers: vi.fn(overrides.listMembers ?? unscripted("listMembers")),
    inviteMember: vi.fn(overrides.inviteMember ?? unscripted("inviteMember")),
    acceptInvitation: vi.fn(overrides.acceptInvitation ?? unscripted("acceptInvitation")),
    changeMemberRole: vi.fn(overrides.changeMemberRole ?? unscripted("changeMemberRole")),
    removeMember: vi.fn(overrides.removeMember ?? unscripted("removeMember")),
    requestPasswordReset: vi.fn(overrides.requestPasswordReset ?? unscripted("requestPasswordReset")),
    redeemPasswordReset: vi.fn(overrides.redeemPasswordReset ?? unscripted("redeemPasswordReset")),
    requestEmailVerification: vi.fn(
      overrides.requestEmailVerification ?? unscripted("requestEmailVerification"),
    ),
    redeemEmailVerification: vi.fn(
      overrides.redeemEmailVerification ?? unscripted("redeemEmailVerification"),
    ),
    verificationStatus: vi.fn(overrides.verificationStatus ?? unscripted("verificationStatus")),
  } as StubIdentity;
}

export function aUser(overrides: Partial<User> = {}): User {
  return { id: "usr_1", email: "kaka@example.com", ...overrides };
}

/** An `IdentityError` as the service would have raised it, for failure paths. */
export function anIdentityError(
  status: number,
  code: string,
  extra: { fieldErrors?: { field: string; code: string }[]; title?: string; detail?: string } = {},
): IdentityError {
  return new IdentityError(extra.detail ?? extra.title ?? code, {
    status,
    code,
    title: extra.title,
    fieldErrors: extra.fieldErrors ?? [],
  });
}

/**
 * The signed-in user a tenancy test runs as.
 *
 * The account screens need somebody whose id they can compare a member row
 * against, so it is a constant rather than a default argument: a test that
 * cares which member is "you" should have to say so.
 */
export const THE_USER: User = aUser({ id: "usr_me_0001", email: "kaka@example.com" });
