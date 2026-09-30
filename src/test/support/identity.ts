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
