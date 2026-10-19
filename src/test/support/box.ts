import { vi, type MockedFunction } from "vitest";

import {
  BoxError,
  type Box,
  type BoxCapability,
  type BoxClient,
  type CustomerEntitlement,
  type DnsVerification,
  type EmailProviderConnection,
  type ClaimResult,
  type GrantResult,
  type Release,
  type ReleaseApproval,
  type StaffEntitlement,
} from "@/lib/box";

/**
 * A scripted Box client for component tests.
 *
 * The real client is covered by `box.test.ts` against a transport stub.
 * This exists for the layer above it: the entitlement screens only need a
 * `BoxClient`, and handing them one means a render test can never reach
 * the network even by accident. Un-scripted methods reject loudly rather than
 * quietly returning `undefined`.
 */
export type StubBox = BoxClient & {
  getAccountEntitlements: MockedFunction<BoxClient["getAccountEntitlements"]>;
  listEntitlements: MockedFunction<BoxClient["listEntitlements"]>;
  grantEntitlement: MockedFunction<BoxClient["grantEntitlement"]>;
  revokeEntitlement: MockedFunction<BoxClient["revokeEntitlement"]>;
  listBoxes: MockedFunction<BoxClient["listBoxes"]>;
  listEmailProviderConnections: MockedFunction<BoxClient["listEmailProviderConnections"]>;
  createEmailProviderConnection: MockedFunction<BoxClient["createEmailProviderConnection"]>;
  verifyEmailProviderConnection: MockedFunction<BoxClient["verifyEmailProviderConnection"]>;
  listReleases: MockedFunction<BoxClient["listReleases"]>;
  getRelease: MockedFunction<BoxClient["getRelease"]>;
  approveRelease: MockedFunction<BoxClient["approveRelease"]>;
  mintBoxCapability: MockedFunction<BoxClient["mintBoxCapability"]>;
  claim: MockedFunction<BoxClient["claim"]>;
};

const unscripted = (method: string) =>
  vi.fn(() => Promise.reject(new Error(`stub box: ${method}() was not scripted`))) as never;

export function stubBox(overrides: Partial<BoxClient> = {}): StubBox {
  return {
    getAccountEntitlements: vi.fn(overrides.getAccountEntitlements ?? unscripted("getAccountEntitlements")),
    listEntitlements: vi.fn(overrides.listEntitlements ?? unscripted("listEntitlements")),
    grantEntitlement: vi.fn(overrides.grantEntitlement ?? unscripted("grantEntitlement")),
    revokeEntitlement: vi.fn(overrides.revokeEntitlement ?? unscripted("revokeEntitlement")),
    listBoxes: vi.fn(overrides.listBoxes ?? unscripted("listBoxes")),
    listEmailProviderConnections: vi.fn(
      overrides.listEmailProviderConnections ?? unscripted("listEmailProviderConnections"),
    ),
    createEmailProviderConnection: vi.fn(
      overrides.createEmailProviderConnection ?? unscripted("createEmailProviderConnection"),
    ),
    verifyEmailProviderConnection: vi.fn(
      overrides.verifyEmailProviderConnection ?? unscripted("verifyEmailProviderConnection"),
    ),
    listReleases: vi.fn(overrides.listReleases ?? unscripted("listReleases")),
    getRelease: vi.fn(overrides.getRelease ?? unscripted("getRelease")),
    approveRelease: vi.fn(overrides.approveRelease ?? unscripted("approveRelease")),
    mintBoxCapability: vi.fn(overrides.mintBoxCapability ?? unscripted("mintBoxCapability")),
    claim: vi.fn(overrides.claim ?? unscripted("claim")),
  };
}

export function aBoxError(status: number, code = "internal"): BoxError {
  return new BoxError(`stub box failure (${status})`, { status, code });
}

export function aCustomerEntitlement(overrides: Partial<CustomerEntitlement> = {}): CustomerEntitlement {
  return {
    account_id: "8f2c1a44-0000-4000-8000-000000000001",
    product: "kit",
    status: "active",
    source: "onboarding",
    reference: "ticket-1",
    granted_at: "2026-10-01T00:00:00Z",
    revoked_at: null,
    ...overrides,
  };
}

export function aStaffEntitlement(overrides: Partial<StaffEntitlement> = {}): StaffEntitlement {
  return {
    id: 7,
    account_id: "8f2c1a44-0000-4000-8000-000000000001",
    product: "kit",
    status: "active",
    source: "onboarding",
    reference: "ticket-1",
    granted_by: "staff-user-id",
    revoked_by: null,
    granted_at: "2026-10-01T00:00:00Z",
    revoked_at: null,
    ...overrides,
  };
}

export function aGrantResult(overrides: Partial<GrantResult> = {}): GrantResult {
  return { entitlement: aStaffEntitlement(), duplicate: false, ...overrides };
}

/**
 * A claim grant fixture, in the shape Box's `ClaimsController` answers.
 *
 * `source` is `agent_claim` and `reference` is the claimed agent's id, because
 * those two are the whole audit fact the claim-driven grant records: the row
 * exists because a human completed a claim, and it names the agent. A fixture
 * that defaulted them to the operator grant's values would be a fixture that
 * taught the screens the wrong provenance.
 */
export function aClaimResult(overrides: Partial<ClaimResult> = {}): ClaimResult {
  return {
    entitlement: aStaffEntitlement({ source: "agent_claim", reference: "8f2c1a44-0000-4000-8000-000000000009" }),
    duplicate: false,
    ...overrides,
  };
}

export function aBox(overrides: Partial<Box> = {}): Box {
  return {
    id: 3,
    box_id: "8f2c1a44-0000-4000-8000-000000000002",
    account_id: "8f2c1a44-0000-4000-8000-000000000001",
    status: "active",
    current_phase: "complete",
    ...overrides,
  };
}

/**
 * A connection fixture, with the fields a screen is allowed to see.
 *
 * There is deliberately no `credential` or `sealed_credential` to override:
 * a fixture carrying one would be a fixture that taught the screens to
 * expect one. The "never renders a stored credential" tests put such a key
 * in the ANSWER the stub resolves with, which is the only place it could
 * ever appear.
 */
export function anEmailProviderConnection(
  overrides: Partial<EmailProviderConnection> = {},
): EmailProviderConnection {
  return {
    id: 5,
    provider: "cloudflare",
    account: "no-reply@example.com",
    box_id: "8f2c1a44-0000-4000-8000-000000000002",
    config: { zone_id: "zone-1", from_address: "no-reply@example.com" },
    created_at: "2026-10-09T12:00:00Z",
    updated_at: "2026-10-09T12:00:00Z",
    ...overrides,
  };
}

/**
 * A release fixture, in the shape Box's `serialize_release` answers.
 *
 * `status` defaults to `pending` — the state a release is born in and the
 * state the acceptance screen is about — so a test constructs the case it is
 * about by saying so.
 */
export function aRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: 11,
    name: "identity",
    version: "0.2.0",
    previous_version: "0.1.0",
    release_notes: "Faster token introspection and a fixed session race.",
    status: "pending",
    account_id: "8f2c1a44-0000-4000-8000-000000000001",
    created_at: "2026-10-09T12:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

/**
 * A minted approval fixture, in the shape Box's `serialize_approval`
 * answers.
 *
 * The `token` is a fixture value, not a credential: it stands in for the
 * opaque `appr_…` string the service mints, and a test that asserts the
 * screen renders it is asserting the screen shows what the service returned.
 */
export function aReleaseApproval(overrides: Partial<ReleaseApproval> = {}): ReleaseApproval {
  return {
    id: 21,
    release_id: 11,
    account_id: "8f2c1a44-0000-4000-8000-000000000001",
    tools: ["release.apply"],
    level: "customer",
    issued_by: "8f2c1a44-0000-4000-8000-000000000009",
    expires_at: "2026-10-09T12:15:00Z",
    token: "appr_fixture_approval_token",
    ...overrides,
  };
}

/**
 * A minted enrollment-capability fixture, in the shape Box's capabilities
 * create answers.
 *
 * The `token` is a fixture value, not a credential: it stands in for the
 * opaque single-use string the service mints, and a test that asserts the
 * screen renders it is asserting the screen shows what the service returned.
 */
export function aBoxCapability(overrides: Partial<BoxCapability> = {}): BoxCapability {
  return {
    token: "cap_fixture_enrollment_token",
    purpose: "box.enroll",
    box_id: "8f2c1a44-0000-4000-8000-000000000007",
    expires_at: "2026-10-15T12:15:00Z",
    ...overrides,
  };
}

/**
 * A verification answer, in the documented three-state shape.
 *
 * `state` defaults to `verified`, so a test constructs the case it is about by
 * saying so: the point of the fixture is that each of the three states is built
 * somewhere deliberately rather than reached by accident.
 */
export function aDnsVerification(overrides: Partial<DnsVerification> = {}): DnsVerification {
  return {
    connection_id: 5,
    state: "verified",
    reason: null,
    checked_at: "2026-10-09T12:00:00Z",
    ...overrides,
  };
}
