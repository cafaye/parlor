import { vi, type MockedFunction } from "vitest";

import type { OperatorClient, OperatorMe, OperatorUser } from "@/lib/operator";

/**
 * A scripted operator client for component tests.
 *
 * The real client is covered by `operator.test.ts` against a transport stub.
 * This exists for the layer above it: the admin screen only needs an
 * `OperatorClient`, and handing it one means a render test can never reach
 * the network even by accident. Un-scripted methods reject loudly rather than
 * quietly returning `undefined`.
 */
export type StubOperator = OperatorClient & {
  me: MockedFunction<OperatorClient["me"]>;
  searchUsers: MockedFunction<OperatorClient["searchUsers"]>;
  disableUser: MockedFunction<OperatorClient["disableUser"]>;
  enableUser: MockedFunction<OperatorClient["enableUser"]>;
};

const unscripted = (method: string) =>
  vi.fn(() => Promise.reject(new Error(`stub operator: ${method}() was not scripted`))) as never;

export function stubOperator(overrides: Partial<OperatorClient> = {}): StubOperator {
  return {
    me: vi.fn(overrides.me ?? unscripted("me")),
    searchUsers: vi.fn(overrides.searchUsers ?? unscripted("searchUsers")),
    disableUser: vi.fn(overrides.disableUser ?? unscripted("disableUser")),
    enableUser: vi.fn(overrides.enableUser ?? unscripted("enableUser")),
  };
}

export function aStaffMe(): OperatorMe {
  return { user: { id: "op-1", email: "op@example.com", staff: true } };
}

export function aNonStaffMe(): OperatorMe {
  return { user: { id: "u-9", email: "kaka@example.com", staff: false } };
}

export function anOperatorUser(overrides: Partial<OperatorUser> = {}): OperatorUser {
  return {
    id: "8f2c1a44-0000-4000-8000-000000000001",
    email: "kaka@example.com",
    display_name: "Kaka",
    disabled_at: null,
    email_verified_at: "2026-09-01T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}
