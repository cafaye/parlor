import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlansPage from "./page";
import { aBillingError, aPlan, stubBilling } from "@/test/support/billing";
import { aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";
import { createTokenStore } from "@/lib/token-store";

const identity = () =>
  stubIdentity({
    me: vi.fn(() => Promise.resolve(aUser())),
  });

function renderPlans(billing = stubBilling()) {
  createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");
  return { billing, ...renderWithProviders(PlansPage(), { identity: identity(), billing }) };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the pricing screen", () => {
  it("lists the plans the service says are on sale", async () => {
    const billing = stubBilling({
      listPlans: vi.fn(() =>
        Promise.resolve({
          data: [
            aPlan({ name: "Team", slug: "team" }),
            aPlan({ name: "Scale", slug: "scale", price: { amount_minor: 4900, currency: "USD" } }),
          ],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderPlans(billing);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Scale" })).toBeTruthy();
    // The price a person reads, from integer minor units. 4900 is $49.00, and a
    // float would have shipped as $49 and nobody would have noticed.
    expect(screen.getByText(/49\.00/)).toBeTruthy();
  });

  it("does not list a withdrawn plan", async () => {
    const billing = stubBilling({
      listPlans: vi.fn(() =>
        Promise.resolve({
          data: [aPlan({ name: "Gone", slug: "gone", active: false })],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderPlans(billing);

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Gone" })).toBeNull();
  });

  // "Subscribe" on a plan billing would refuse is a promise the service cannot
  // keep, so the button is absent rather than disabled.
  it("offers no subscribe button for a plan with no processor price", async () => {
    const billing = stubBilling({
      listPlans: vi.fn(() =>
        Promise.resolve({
          data: [aPlan({ name: "Unpriced", slug: "unpriced", processor_price_id: null })],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderPlans(billing);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Unpriced" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Subscribe" })).toBeNull();
    expect(screen.getByText("Not on sale yet.")).toBeTruthy();
  });

  it("links a buyable plan to the checkout with its slug in the URL", async () => {
    const billing = stubBilling({
      listPlans: vi.fn(() =>
        Promise.resolve({
          data: [aPlan({ slug: "team", processor_price_id: "price_1PZQaBcDeFgHiJkLmNoPqR2" })],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderPlans(billing);

    await waitFor(() => expect(screen.getByRole("link", { name: "Subscribe" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "Subscribe" }).getAttribute("href")).toContain("team");
  });

  it("says billing is not configured, rather than an error, in the launch shape", async () => {
    const billing = stubBilling({
      listPlans: vi.fn(() => Promise.reject(aBillingError(503, "billing_not_configured"))),
    });

    renderPlans(billing);

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toMatch(/not configured/i);
  });

  it("shows what the plan grants", async () => {
    const billing = stubBilling({
      listPlans: vi.fn(() =>
        Promise.resolve({
          data: [aPlan({ entitlements: { features: ["Unlimited projects"], limits: { projects: 10 } } })],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderPlans(billing);

    await waitFor(() => expect(screen.getByText("Unlimited projects")).toBeTruthy());
    expect(screen.getByText("Up to 10 projects")).toBeTruthy();
  });
});
