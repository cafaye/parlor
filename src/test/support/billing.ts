import { vi, type MockedFunction } from "vitest";

import { BillingError, type BillingClient, type Customer, type Plan } from "@/lib/billing";

/**
 * A scripted billing client for component tests.
 *
 * The real client is covered by `billing.test.ts` against a transport stub. This
 * exists for the screens above it, so a render test cannot reach the network.
 * Un-scripted methods reject loudly, the same as the identity stub — a screen
 * calling a method because of a bug should say so rather than render `undefined`.
 */
export type StubBilling = BillingClient & {
  listPlans: MockedFunction<BillingClient["listPlans"]>;
  getPlanBySlug: MockedFunction<BillingClient["getPlanBySlug"]>;
  listCustomers: MockedFunction<BillingClient["listCustomers"]>;
  getCustomer: MockedFunction<BillingClient["getCustomer"]>;
  createCustomer: MockedFunction<BillingClient["createCustomer"]>;
};

const unscripted = (method: string) =>
  vi.fn(async () => {
    throw new Error(`stub billing: ${method}() was not scripted`);
  }) as never;

export function stubBilling(overrides: Partial<BillingClient> = {}): StubBilling {
  return {
    listPlans: vi.fn(overrides.listPlans ?? unscripted("listPlans")),
    getPlanBySlug: vi.fn(overrides.getPlanBySlug ?? unscripted("getPlanBySlug")),
    listCustomers: vi.fn(overrides.listCustomers ?? unscripted("listCustomers")),
    getCustomer: vi.fn(overrides.getCustomer ?? unscripted("getCustomer")),
    createCustomer: vi.fn(overrides.createCustomer ?? unscripted("createCustomer")),
  } as StubBilling;
}

/**
 * A `Plan`, with every field the schema's `required` list names.
 *
 * Copied from `components.schemas.Plan` in billing's `openapi/v1.yaml`, not
 * invented: `processor_product_id` and `processor_price_id` are null because the
 * schema documents them as always null in v0, and `price` is integer minor
 * units because the contract says a decimal "is a 422".
 */
export function aPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan_1",
    name: "Team",
    slug: "team",
    processor_product_id: null,
    processor_price_id: null,
    price: { amount_minor: 1900, currency: "USD" },
    interval: "month",
    trial_days: 14,
    active: true,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

/** A `Customer`, with every field the schema's `required` list names. */
export function aCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cus_1",
    owner: { type: "Account", id: "acc_0a1b2c3d" },
    processor: "stripe",
    // Always null in v0: "this build makes no Stripe call".
    processor_customer_id: null,
    email: "kaka@example.com",
    metadata: {},
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

/** A `BillingError` as the service would have raised it, for failure paths. */
export function aBillingError(
  status: number,
  code: string,
  extra: { fieldErrors?: { field: string; code: string }[]; detail?: string } = {},
): BillingError {
  return new BillingError(extra.detail ?? code, {
    status,
    code,
    fieldErrors: extra.fieldErrors ?? [],
  });
}
