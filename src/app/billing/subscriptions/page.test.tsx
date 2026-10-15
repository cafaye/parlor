import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SubscriptionsPage from "./page";
import { aBillingError, anEntitlements, aPlan, aSubscription, stubBilling } from "@/test/support/billing";
import { aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";
import { createTokenStore } from "@/lib/token-store";

const identity = () => stubIdentity({ me: vi.fn(() => Promise.resolve(aUser())) });

function renderSubscriptions(billing = stubBilling()) {
  createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");
  return { billing, ...renderWithProviders(SubscriptionsPage(), { identity: identity(), billing }) };
}

const page = <T,>(data: T[]) => ({ data, page: { next_cursor: null, has_more: false } });

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the subscriptions screen", () => {
  it("lists what this account is paying for", async () => {
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([aSubscription({ plan_slug: "team" })]))),
      getEntitlements: vi.fn(() =>
        Promise.resolve(anEntitlements({ features: ["Unlimited projects"] })),
      ),
    });

    renderSubscriptions(billing);

    await waitFor(() => expect(screen.getByRole("heading", { name: "team" })).toBeTruthy());
    // The status is the processor's statement, printed as it arrived — this
    // service stores what the processor says and corrects nothing.
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("cancels at the period end and does not claim the subscription is canceled", async () => {
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([aSubscription()]))),
      getEntitlements: vi.fn(() => Promise.resolve(anEntitlements({ features: [] }))),
      cancelSubscription: vi.fn(() => Promise.resolve(aSubscription())),
    });

    renderSubscriptions(billing);
    await waitFor(() => expect(screen.getByRole("button", { name: /cancel at period end/i })).toBeTruthy());
    screen.getByRole("button", { name: /cancel at period end/i }).click();

    await waitFor(() => expect(billing.cancelSubscription).toHaveBeenCalledWith(
      aSubscription().id,
      { at_period_end: true },
    ));
    // The row has not moved: the processor cancels at the period end and the
    // webhook moves the status. Saying "canceled" here would be a claim about
    // a state this service does not own.
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/stays active until the period ends/i));
  });

  it("shows the next invoice as the processor projected it", async () => {
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([aSubscription()]))),
      getEntitlements: vi.fn(() => Promise.resolve(anEntitlements({ features: [] }))),
      getUpcomingInvoice: vi.fn(() =>
        Promise.resolve({
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
        }),
      ),
    });

    renderSubscriptions(billing);
    await waitFor(() => expect(screen.getByRole("button", { name: /show next invoice/i })).toBeTruthy());
    screen.getByRole("button", { name: /show next invoice/i }).click();

    await waitFor(() => expect(screen.getByText("Total")).toBeTruthy());
    // The processor's own figures, in minor units, and the derived tax beside
    // them: 2147 is $21.47, and the table adds up on screen.
    expect(screen.getByText(/21\.47/)).toBeTruthy();
  });

  it("offers no cancel on a subscription that is already canceled", async () => {
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([aSubscription({ status: "canceled" })]))),
      getEntitlements: vi.fn(() => Promise.resolve(anEntitlements({ granted: false, features: [] }))),
    });

    renderSubscriptions(billing);

    await waitFor(() => expect(screen.getByRole("heading", { name: "team" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /cancel at period end/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /update payment method/i })).toBeNull();
  });

  it("says nothing when the account has no subscription, rather than an error", async () => {
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([]))),
    });

    renderSubscriptions(billing);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/no subscription yet/i));
  });

  it("says billing is not configured, rather than an error, in the launch shape", async () => {
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.reject(aBillingError(503, "billing_not_configured"))),
    });

    renderSubscriptions(billing);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not configured/i));
  });
});
