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
  it("carries the account into the charges link, so the choice survives the step", async () => {
    // The account is the URL's, and every internal billing link has to keep
    // it: a team's subscriptions page linking to the plain charges URL would
    // quietly show the PERSONAL account's money history one click later.
    const TEAM = "22222222-2222-4222-8222-222222222222";
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([aSubscription({ plan_slug: "team" })]))),
      getEntitlements: vi.fn(() => Promise.resolve(anEntitlements({ features: [] }))),
    });
    createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");

    renderWithProviders(SubscriptionsPage(), {
      identity: identity(),
      billing,
      path: `/billing/subscriptions?account=${TEAM}`,
    });

    const link = await screen.findByRole("link", { name: /see every charge/i });
    expect(link.getAttribute("href")).toBe(`/billing/charges?account=${TEAM}`);
  });

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

  it("does not ask billing a question before the session is known", async () => {
    // The fresh-load window, which is the shape of every redirect back from
    // the processor: the token is read a commit after the first render, and a
    // request sent in that window carries no credential — billing answers 401
    // and the screen would show it. Measured on the launch stack, 2026-10-16.
    let settle: () => void = () => {};
    const me = vi.fn(() => new Promise<ReturnType<typeof aUser>>((resolve) => (settle = () => resolve(aUser()))));
    const billing = stubBilling({
      listSubscriptions: vi.fn(() => Promise.resolve(page([aSubscription({ plan_slug: "team" })]))),
      getEntitlements: vi.fn(() => Promise.resolve(anEntitlements({ features: [] }))),
    });
    createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");

    renderWithProviders(SubscriptionsPage(), { identity: stubIdentity({ me }), billing });

    // The screen is up and the session question is out — so the load effect
    // has had its turn — and billing has not been asked.
    await waitFor(() => expect(me).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(billing.listSubscriptions).not.toHaveBeenCalled();

    settle();
    await waitFor(() => expect(screen.getByRole("heading", { name: "team" })).toBeTruthy());
    expect(billing.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("shows the data once a load answers, even if an earlier load failed", async () => {
    // A failure must not latch. The measured sequence this guards: the post-
    // payment landing showed "Billing could not be reached" while a later
    // request had already answered 200 — the page a buyer lands on was an
    // error page with the data sitting behind it.
    const billing = stubBilling({
      listSubscriptions: vi
        .fn()
        .mockRejectedValueOnce(new Error("the network hiccuped"))
        .mockResolvedValue(page([aSubscription({ plan_slug: "team" })])),
      getEntitlements: vi.fn(() => Promise.resolve(anEntitlements({ features: [] }))),
    });

    // The store instance is this test's own handle, so the second line below
    // is a token change the mounted tree actually hears (a fresh
    // `createTokenStore()` writes the same localStorage without notifying the
    // provider's subscription).
    const store = createTokenStore();
    store.set("tok_abc", "2026-03-14T12:00:00Z");
    renderWithProviders(SubscriptionsPage(), { identity: identity(), billing, tokens: store });

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/could not be reached/i));

    // A new session — a sign-in as somebody else, or this tab reloading — is a
    // new session for the tree, and the load runs again; this one answers.
    store.set("tok_xyz", "2026-03-14T12:00:00Z");

    await waitFor(() => expect(screen.getByRole("heading", { name: "team" })).toBeTruthy());
    // And the stale failure is gone, not painted over the data.
    expect(screen.queryByText(/could not be reached/i)).toBeNull();
  });
});
