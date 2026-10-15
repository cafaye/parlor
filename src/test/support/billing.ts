import { vi, type MockedFunction } from "vitest";

import {
  BillingError,
  type BillingClient,
  type Charge,
  type Customer,
  type Entitlements,
  type InvoicePreview,
  type PaymentMethodUrl,
  type Plan,
  type Subscription,
  type SubscriptionWithPlanChange,
  type CheckoutSession,
} from "@/lib/billing";

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
  listSubscriptions: MockedFunction<BillingClient["listSubscriptions"]>;
  getSubscription: MockedFunction<BillingClient["getSubscription"]>;
  getEntitlements: MockedFunction<BillingClient["getEntitlements"]>;
  getUpcomingInvoice: MockedFunction<BillingClient["getUpcomingInvoice"]>;
  startSubscriptionCheckout: MockedFunction<BillingClient["startSubscriptionCheckout"]>;
  cancelSubscription: MockedFunction<BillingClient["cancelSubscription"]>;
  changeSubscriptionPlan: MockedFunction<BillingClient["changeSubscriptionPlan"]>;
  completeCheckout: MockedFunction<BillingClient["completeCheckout"]>;
  listCharges: MockedFunction<BillingClient["listCharges"]>;
  createPaymentMethodUrl: MockedFunction<BillingClient["createPaymentMethodUrl"]>;
};

/**
 * The body of a method a test did not script — a rejection, for the reason
 * `unscripted` in `./identity.ts` is one. Read that file's comment; this is
 * the same rule applied to the other client.
 */
const unscripted = (method: string) =>
  vi.fn(() => Promise.reject(new Error(`stub billing: ${method}() was not scripted`))) as never;

export function stubBilling(overrides: Partial<BillingClient> = {}): StubBilling {
  return {
    listPlans: vi.fn(overrides.listPlans ?? unscripted("listPlans")),
    getPlanBySlug: vi.fn(overrides.getPlanBySlug ?? unscripted("getPlanBySlug")),
    listCustomers: vi.fn(overrides.listCustomers ?? unscripted("listCustomers")),
    getCustomer: vi.fn(overrides.getCustomer ?? unscripted("getCustomer")),
    createCustomer: vi.fn(overrides.createCustomer ?? unscripted("createCustomer")),
    listSubscriptions: vi.fn(overrides.listSubscriptions ?? unscripted("listSubscriptions")),
    getSubscription: vi.fn(overrides.getSubscription ?? unscripted("getSubscription")),
    getEntitlements: vi.fn(overrides.getEntitlements ?? unscripted("getEntitlements")),
    getUpcomingInvoice: vi.fn(overrides.getUpcomingInvoice ?? unscripted("getUpcomingInvoice")),
    startSubscriptionCheckout: vi.fn(
      overrides.startSubscriptionCheckout ?? unscripted("startSubscriptionCheckout"),
    ),
    cancelSubscription: vi.fn(overrides.cancelSubscription ?? unscripted("cancelSubscription")),
    changeSubscriptionPlan: vi.fn(overrides.changeSubscriptionPlan ?? unscripted("changeSubscriptionPlan")),
    completeCheckout: vi.fn(overrides.completeCheckout ?? unscripted("completeCheckout")),
    listCharges: vi.fn(overrides.listCharges ?? unscripted("listCharges")),
    createPaymentMethodUrl: vi.fn(overrides.createPaymentMethodUrl ?? unscripted("createPaymentMethodUrl")),
  };
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

const PAGE: { next_cursor: string | null; has_more: boolean } = { next_cursor: null, has_more: false };

/** A `Subscription`, with every field the schema's `required` list names. */
export function aSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    account_id: "acc_0a1b2c3d",
    plan_id: "plan_1",
    plan_slug: "team",
    customer_id: "cus_1",
    processor_subscription_id: "sub_stripe_1",
    status: "active",
    price: { amount_minor: 1900, currency: "USD" },
    current_period_start: "2026-10-01T10:00:00Z",
    current_period_end: "2026-11-01T10:00:00Z",
    cancel_at_period_end: false,
    canceled_at: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

/** An `Entitlements` block for a subscription that is granting them. */
export function anEntitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    subscription_id: "sub_1",
    plan_id: "plan_1",
    plan_slug: "team",
    status: "active",
    granted: true,
    features: ["Unlimited projects"],
    limits: { projects: 10 },
    ...overrides,
  };
}

/** The processor's projection of the next invoice. */
export function anInvoicePreview(overrides: Partial<InvoicePreview> = {}): InvoicePreview {
  return {
    subscription_id: "sub_1",
    period_end: "2026-11-01T10:00:00Z",
    currency: "USD",
    line_items: [
      {
        description: "Team",
        period: { start: "2026-10-01T10:00:00Z", end: "2026-11-01T10:00:00Z" },
        quantity: 1,
        unit_amount: 1900,
        amount: 1900,
        currency: "USD",
      },
    ],
    subtotal: 1900,
    tax: 247,
    total: 2147,
    ...overrides,
  };
}

/** A `Charge`, with every field the schema's `required` list names. */
export function aCharge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: "chg_1",
    account_id: "acc_0a1b2c3d",
    customer_id: "cus_1",
    subscription_id: "sub_1",
    processor_charge_id: "ch_stripe_1",
    amount: 1900,
    currency: "USD",
    description: "Team",
    paid_at: "2026-10-01T10:00:00Z",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

/** The production door's answer: a Checkout session, and no row yet. */
export function aCheckoutSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    checkout_session_id: "cs_test_00000000000001",
    checkout_url: "https://checkout.stripe.test/c/pay/cs_test_00000000000001",
    customer_id: "cus_1",
    plan_id: "plan_1",
    ...overrides,
  };
}

/** The processor's portal URL. */
export function aPaymentMethodUrl(overrides: Partial<PaymentMethodUrl> = {}): PaymentMethodUrl {
  return {
    payment_method_url: "https://billing.stripe.test/session/pcss_00000000000001",
    ...overrides,
  };
}

/** A page of subscriptions. */
export function aSubscriptionPage(subscriptions: Subscription[] = [aSubscription()]): {
  data: Subscription[];
  page: { next_cursor: string | null; has_more: boolean };
} {
  return { data: subscriptions, page: PAGE };
}

/** A page of charges. */
export function aChargePage(charges: Charge[] = [aCharge()]): {
  data: Charge[];
  page: { next_cursor: string | null; has_more: boolean };
} {
  return { data: charges, page: PAGE };
}

/** A plan change that takes effect immediately, with the difference invoiced. */
export function aPlanChange(overrides: Partial<SubscriptionWithPlanChange["plan_change"]> = {}): SubscriptionWithPlanChange["plan_change"] {
  return { plan_id: "plan_1", effective: "immediately", proration: "always_invoice", ...overrides };
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
