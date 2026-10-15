import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CheckoutPage from "./page";
import { aCheckoutSession, aCustomer, aPlan, stubBilling } from "@/test/support/billing";
import { aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";
import { createTokenStore } from "@/lib/token-store";

const identity = () => stubIdentity({ me: vi.fn(() => Promise.resolve(aUser())) });

function renderCheckout(billing = stubBilling(), searchParams: Record<string, string> = { plan: "team" }) {
  createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");
  return renderWithProviders(CheckoutPage({ searchParams }), { identity: identity(), billing });
}

const buyable = () =>
  vi.fn(() =>
    Promise.resolve(aPlan({ slug: "team", processor_price_id: "price_1PZQaBcDeFgHiJkLmNoPqR2" })),
  );

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the checkout screen", () => {
  it("reads the plan named in the URL and shows what it costs", async () => {
    const billing = stubBilling({ getPlanBySlug: buyable() });

    renderCheckout(billing);

    await waitFor(() => expect(screen.getByRole("button", { name: /continue to checkout/i })).toBeTruthy());
    expect(screen.getByText(/Team/)).toBeTruthy();
    expect(billing.getPlanBySlug).toHaveBeenCalledWith("team");
  });

  it("hands the buyer to the processor and does not claim a subscription", async () => {
    const billing = stubBilling({
      getPlanBySlug: buyable(),
      listCustomers: vi.fn(() =>
        Promise.resolve({ data: [aCustomer({ id: "cus_mine" })], page: { next_cursor: null, has_more: false } }),
      ),
      startSubscriptionCheckout: vi.fn(() => Promise.resolve(aCheckoutSession())),
    });

    renderCheckout(billing);
    await waitFor(() => expect(screen.getByRole("button", { name: /continue to checkout/i })).toBeTruthy());
    screen.getByRole("button", { name: /continue to checkout/i }).click();

    await waitFor(() => expect(screen.getByRole("link", { name: /payment page/i })).toBeTruthy());
    // The POST names this account's customer and the plan read from the URL —
    // never a customer the body could name, which would be a cross-tenant
    // checkout wearing a request.
    expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith({
      customer_id: "cus_mine",
      plan_id: aPlan().id,
    });
    // And the screen does NOT say "subscribed": the production door writes no
    // row, so the row's arrival is the processor's news.
    expect(screen.queryByText(/you are subscribed/i)).toBeNull();
  });

  it("refuses to check out when the account has no billing customer", async () => {
    const billing = stubBilling({
      getPlanBySlug: buyable(),
      listCustomers: vi.fn(() => Promise.resolve({ data: [], page: { next_cursor: null, has_more: false } })),
      startSubscriptionCheckout: vi.fn(() => Promise.resolve(aCheckoutSession())),
    });

    renderCheckout(billing);
    await waitFor(() => expect(screen.getByRole("button", { name: /continue to checkout/i })).toBeTruthy());
    screen.getByRole("button", { name: /continue to checkout/i }).click();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(billing.startSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it("says nothing was charged when the processor refuses", async () => {
    const billing = stubBilling({
      getPlanBySlug: buyable(),
      listCustomers: vi.fn(() =>
        Promise.resolve({ data: [aCustomer()], page: { next_cursor: null, has_more: false } }),
      ),
      startSubscriptionCheckout: vi.fn(() => Promise.reject(new Error("refused"))),
    });

    renderCheckout(billing);
    await waitFor(() => expect(screen.getByRole("button", { name: /continue to checkout/i })).toBeTruthy());
    screen.getByRole("button", { name: /continue to checkout/i }).click();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/nothing was charged/i);
  });

  it("tells the visitor to pick a plan when the URL names none", async () => {
    const billing = stubBilling({ getPlanBySlug: buyable() });
    createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");
    renderWithProviders(CheckoutPage({ searchParams: {} }), { identity: identity(), billing });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/no plan was chosen/i);
  });
});
