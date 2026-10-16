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

/**
 * The click a person makes: the button is enabled only once the plan is read
 * AND the session is known, so the wait is the same one the screen performs —
 * and it is what keeps the first-purchase path from racing the session's
 * answer (the customer it creates carries the buyer's email).
 */
async function continueToCheckout() {
  const button = await screen.findByRole("button", { name: /continue to checkout/i });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  button.click();
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the checkout screen", () => {
  it("reads the plan named in the URL and shows what it costs", async () => {
    const billing = stubBilling({ getPlanBySlug: buyable() });

    renderCheckout(billing);

    // The plan line is the read's own answer; the button exists (disabled)
    // from the first render, so waiting for it would pass before the read.
    await waitFor(() => expect(screen.getByText(/Team/)).toBeTruthy());
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
    await continueToCheckout();

    await waitFor(() => expect(screen.getByRole("link", { name: /payment page/i })).toBeTruthy());
    // The POST names this account's customer and the plan read from the URL —
    // never a customer the body could name, which would be a cross-tenant
    // checkout wearing a request.
    expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith({
      customer_id: "cus_mine",
      plan_id: aPlan().id,
      success_url: `${window.location.origin}/billing/subscriptions`,
      cancel_url: `${window.location.origin}/billing/checkout?plan=team`,
    });
    // And the screen does NOT say "subscribed": the production door writes no
    // row, so the row's arrival is the processor's news.
    expect(screen.queryByText(/you are subscribed/i)).toBeNull();
  });

  it("a first purchase creates the account's customer, then checks out", async () => {
    const billing = stubBilling({
      getPlanBySlug: buyable(),
      listCustomers: vi.fn(() => Promise.resolve({ data: [], page: { next_cursor: null, has_more: false } })),
      createCustomer: vi.fn(() => Promise.resolve(aCustomer({ id: "cus_new" }))),
      startSubscriptionCheckout: vi.fn(() => Promise.resolve(aCheckoutSession())),
    });

    renderCheckout(billing);
    await continueToCheckout();

    await waitFor(() => expect(screen.getByRole("link", { name: /payment page/i })).toBeTruthy());
    // The row is created for THIS account — the owner is the token's, decided
    // by billing, never the body — and it carries the buyer's address, because
    // billing puts that address on the event and courier refuses an event with
    // no address: a row created without one would buy silently.
    expect(billing.createCustomer).toHaveBeenCalledWith({
      processor: "stripe",
      email: "kaka@example.com",
    });
    // And the checkout names the row that was just created.
    expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "cus_new", plan_id: aPlan().id }),
    );
  });

  it("carries the chosen account into the return URLs, so the buyer lands back on that account's page", async () => {
    const TEAM = "22222222-2222-4222-8222-222222222222";
    const billing = stubBilling({
      getPlanBySlug: buyable(),
      listCustomers: vi.fn(() =>
        Promise.resolve({ data: [aCustomer({ id: "cus_mine" })], page: { next_cursor: null, has_more: false } }),
      ),
      startSubscriptionCheckout: vi.fn(() => Promise.resolve(aCheckoutSession())),
    });

    renderCheckout(billing, { plan: "team", account: TEAM });
    await continueToCheckout();

    await waitFor(() => expect(screen.getByRole("link", { name: /payment page/i })).toBeTruthy());
    // The redirect by the processor is a browser navigation and the URL is the
    // only place the choice survives the round trip, so both return URLs name
    // the account the checkout was started for.
    expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith({
      customer_id: "cus_mine",
      plan_id: aPlan().id,
      success_url: `${window.location.origin}/billing/subscriptions?account=${TEAM}`,
      cancel_url: `${window.location.origin}/billing/checkout?plan=team&account=${TEAM}`,
    });
    expect(billing.createCustomer).not.toHaveBeenCalled();
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
    await continueToCheckout();

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
