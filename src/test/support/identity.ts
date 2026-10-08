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
  mintSignupTimestamp: MockedFunction<IdentityClient["mintSignupTimestamp"]>;
  register: MockedFunction<IdentityClient["register"]>;
  login: MockedFunction<IdentityClient["login"]>;
  logout: MockedFunction<IdentityClient["logout"]>;
  me: MockedFunction<IdentityClient["me"]>;
  updateMyDisplayName: MockedFunction<IdentityClient["updateMyDisplayName"]>;
  listSessions: MockedFunction<IdentityClient["listSessions"]>;
  revokeSession: MockedFunction<IdentityClient["revokeSession"]>;
  deleteMyAccount: MockedFunction<IdentityClient["deleteMyAccount"]>;
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
  startSocialLogin: MockedFunction<IdentityClient["startSocialLogin"]>;
  completeSocialLogin: MockedFunction<IdentityClient["completeSocialLogin"]>;
  completeSecondFactor: MockedFunction<IdentityClient["completeSecondFactor"]>;
  mfaStatus: MockedFunction<IdentityClient["mfaStatus"]>;
  startMfaEnrollment: MockedFunction<IdentityClient["startMfaEnrollment"]>;
  confirmMfaEnrollment: MockedFunction<IdentityClient["confirmMfaEnrollment"]>;
  regenerateMfaRecoveryCodes: MockedFunction<IdentityClient["regenerateMfaRecoveryCodes"]>;
};

/**
 * The body of a method a test did not script.
 *
 * `Promise.reject` rather than a `throw` inside an `async` arrow, and rather
 * than a plain non-async arrow that throws: an `async` function's throw reaches
 * the caller as a rejection, and every caller here is `try { await … } catch`,
 * so this has to be the rejection to be the same function it replaced.
 * `@typescript-eslint/require-await` is what forced the spelling to be written
 * down — an `async` arrow that only throws has no `await` in it.
 */
const unscripted = (method: string) =>
  vi.fn(() => Promise.reject(new Error(`stub identity: ${method}() was not scripted`))) as never;

export function stubIdentity(overrides: Partial<IdentityClient> = {}): StubIdentity {
  return {
    // The signup timestamp mint resolves by default: the register screen mints
    // on render, and a test that does not care about the pair should not have
    // to script it. The values are a fixed fixture, never a live credential.
    mintSignupTimestamp: vi.fn(
      overrides.mintSignupTimestamp ??
        (() => Promise.resolve({ timestamp: 1759843200, signature: "minted-signature" })),
    ),
    register: vi.fn(overrides.register ?? unscripted("register")),
    login: vi.fn(overrides.login ?? unscripted("login")),
    logout: vi.fn(overrides.logout ?? unscripted("logout")),
    me: vi.fn(overrides.me ?? unscripted("me")),
    // The three display-name and sessions methods have resolving defaults
    // rather than `unscripted` because the settings screen calls them on render.
    // A test that does not care about them should not have to script them, and a
    // test that does passes its own override.
    updateMyDisplayName: vi.fn(
      overrides.updateMyDisplayName ?? (() => Promise.resolve(aUser())),
    ),
    listSessions: vi.fn(
      overrides.listSessions ?? (() => Promise.resolve({ sessions: [] })),
    ),
    revokeSession: vi.fn(overrides.revokeSession ?? (() => Promise.resolve())),
    // The settings screen reads the personal account's name for the
    // type-to-confirm, so the accounts list resolves with one by default.
    deleteMyAccount: vi.fn(overrides.deleteMyAccount ?? (() => Promise.resolve())),
    listAccounts: vi.fn(
      overrides.listAccounts ?? (() => Promise.resolve([{ id: "acc_1", name: "Kaka", slug: "kaka", personal: true, role: "owner", created_at: "2026-01-01T00:00:00Z" }])),
    ),
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
    // Both social methods are here rather than left out because a screen that
    // calls one and finds it undefined gets a `TypeError` rather than the loud
    // "was not scripted" this file exists to produce.
    startSocialLogin: vi.fn(overrides.startSocialLogin ?? unscripted("startSocialLogin")),
    completeSocialLogin: vi.fn(
      overrides.completeSocialLogin ?? unscripted("completeSocialLogin"),
    ),
    // The second-factor login leg, for the same reason: the login screen drives
    // it, and a render test that reached it unscripted would take the tree down
    // rather than fail the assertion it was writing.
    completeSecondFactor: vi.fn(
      overrides.completeSecondFactor ?? unscripted("completeSecondFactor"),
    ),
    // The four MFA methods for the same reason: the settings section calls all
    // of them across its states, and a render test that reached one unscripted
    // would take the tree down rather than fail the assertion it was writing.
    mfaStatus: vi.fn(overrides.mfaStatus ?? unscripted("mfaStatus")),
    startMfaEnrollment: vi.fn(overrides.startMfaEnrollment ?? unscripted("startMfaEnrollment")),
    confirmMfaEnrollment: vi.fn(
      overrides.confirmMfaEnrollment ?? unscripted("confirmMfaEnrollment"),
    ),
    regenerateMfaRecoveryCodes: vi.fn(
      overrides.regenerateMfaRecoveryCodes ?? unscripted("regenerateMfaRecoveryCodes"),
    ),
  };
}

export function aUser(overrides: Partial<User> = {}): User {
  return { id: "usr_1", email: "kaka@example.com", ...overrides };
}

/** An `IdentityError` as the service would have raised it, for failure paths. */
export function anIdentityError(
  status: number,
  code: string,
  extra: {
    fieldErrors?: { field: string; code: string }[];
    title?: string;
    detail?: string;
    retryAfter?: number | null;
  } = {},
): IdentityError {
  return new IdentityError(extra.detail ?? extra.title ?? code, {
    status,
    code,
    title: extra.title,
    fieldErrors: extra.fieldErrors ?? [],
    retryAfter: extra.retryAfter ?? null,
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
