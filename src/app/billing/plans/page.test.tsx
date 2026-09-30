import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PlansPage from "./page";
import type { PlanPage } from "@/lib/billing";
import { aBillingError, aPlan, stubBilling } from "@/test/support/billing";
import { stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

/**
 * `/billing/plans` — the catalogue.
 *
 * What this page is allowed to say is bounded by the contract, and the bound is
 * worth stating before the assertions. billing's document on master declares
 * `/v1/plans` and nothing else about pricing: a `Plan` is "what can be bought,
 * at what price, on what cadence", and **nothing on the wire records which plan
 * a customer is on**. There is no `/v1/subscriptions`, and `Customer` has no
 * plan field.
 *
 * So this is a catalogue and it behaves like one: it shows what exists, what it
 * costs and how often, and it offers no way to buy. Rendering a "Choose plan"
 * button that does nothing, or a "your plan" line, would be inventing an
 * endpoint — which is the thing this packet was told not to do.
 *
 * The price assertions pin the *digits*, not the currency glyph, because which
 * one Node picks depends on the locale and the ICU build. The exponent is the
 * part at risk: 1900 minor units is $19.00, and a divide-by-a-different-number
 * is the bug.
 */

beforeEach(() => {
  localStorage.clear();
});

function renderPlans(billing = stubBilling()) {
  renderWithProviders(<PlansPage />, { identity: stubIdentity(), billing });
  return billing;
}

describe("the plan catalogue", () => {
  it("names itself", () => {
    renderPlans(stubBilling({ listPlans: vi.fn(() => new Promise<PlanPage>(() => {})) }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/plans/i);
  });

  it("says what it is, so nobody reads it as their current plan", () => {
    renderPlans(stubBilling({ listPlans: vi.fn(() => new Promise<PlanPage>(() => {})) }));

    // The sentence that keeps this page honest. There is no subscription on the
    // wire, so a catalogue that does not say so reads as a billing page that
    // forgot to show what you are on.
    expect(screen.getByText(/catalogue|catalog/i)).toBeInTheDocument();
  });
});

describe("while the plans are loading", () => {
  it("says what is loading", () => {
    renderPlans(stubBilling({ listPlans: vi.fn(() => new Promise<PlanPage>(() => {})) }));

    expect(screen.getByRole("status")).toHaveTextContent(/loading plans/i);
  });

  it("does not claim there are no plans before it has answered", () => {
    renderPlans(stubBilling({ listPlans: vi.fn(() => new Promise<PlanPage>(() => {})) }));

    // An empty state painted over an unanswered fetch reads as "nothing is for
    // sale", which is a different and much worse thing to say.
    expect(screen.queryByText(/no plans/i)).not.toBeInTheDocument();
  });
});

describe("when there are no plans", () => {
  it("says so, and does not call it a failure", async () => {
    renderPlans(
      stubBilling({ listPlans: vi.fn(async () => ({ data: [], page: { next_cursor: null, has_more: false } })) }),
    );

    expect(await screen.findByText(/no plans/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("when the plans are there", () => {
  const plans = [
    aPlan({ id: "plan_1", name: "Starter", slug: "starter", price: { amount_minor: 0, currency: "USD" } }),
    aPlan({ id: "plan_2", name: "Team", slug: "team", price: { amount_minor: 1900, currency: "USD" } }),
    aPlan({
      id: "plan_3",
      name: "Business",
      slug: "business",
      price: { amount_minor: 4900, currency: "USD" },
      interval: "year",
      trial_days: 0,
    }),
  ];

  function withPlans() {
    return stubBilling({
      listPlans: vi.fn(async () => ({ data: plans, page: { next_cursor: null, has_more: false } })),
    });
  }

  it("names each plan", async () => {
    renderPlans(withPlans());

    const list = await screen.findByRole("list", { name: /plans/i });
    expect(within(list).getByText("Starter")).toBeInTheDocument();
    expect(within(list).getByText("Team")).toBeInTheDocument();
    expect(within(list).getByText("Business")).toBeInTheDocument();
  });

  it("shows the price as money, not as an integer of minor units", async () => {
    renderPlans(withPlans());

    const list = await screen.findByRole("list", { name: /plans/i });

    // The digits are the assertion. 1900 minor units is nineteen dollars; a
    // screen that rendered "1900" would be charging a different amount than it
    // displays.
    expect(within(list).getByText(/19\.00/)).toBeInTheDocument();
    expect(within(list).getByText(/49\.00/)).toBeInTheDocument();
  });

  it("shows a free plan as zero rather than as nothing", async () => {
    renderPlans(withPlans());

    const list = await screen.findByRole("list", { name: /plans/i });

    // A blank price reads as "we did not load the price", which sends somebody
    // to the sales page.
    expect(within(list).getByText(/0\.00/)).toBeInTheDocument();
  });

  it("says how often each plan bills, because a yearly price is not a monthly one", async () => {
    renderPlans(withPlans());

    const list = await screen.findByRole("list", { name: /plans/i });
    const rows = within(list).getAllByRole("listitem");

    expect(within(rows[0]).getByText(/per month/i)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/per year/i)).toBeInTheDocument();
  });

  it("says when a plan has a trial, and says nothing when it does not", async () => {
    renderPlans(withPlans());

    const list = await screen.findByRole("list", { name: /plans/i });
    const rows = within(list).getAllByRole("listitem");

    // Team has trial_days: 14, Business has 0. A blanket "free trial" line on
    // every row would be a lie on the ones without one.
    expect(within(rows[1]).getByText(/14-day free trial/i)).toBeInTheDocument();
    expect(within(rows[2]).queryByText(/free trial/i)).toBeNull();
  });

  it("marks an inactive plan, rather than selling it", async () => {
    renderPlans(
      stubBilling({
        listPlans: vi.fn(async () => ({
          data: [aPlan({ name: "Retired", slug: "retired", active: false })],
          page: { next_cursor: null, has_more: false },
        })),
      }),
    );

    // The status, not the plan's name — a fixture called "Retired" would match
    // either way, and the assertion is about what the status line says.
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it("offers nothing to buy, because there is no subscription endpoint", async () => {
    renderPlans(withPlans());

    // No /v1/subscriptions on master, and no field on Customer that records
    // which plan somebody is on. A "Choose" button here would post to an
    // endpoint that does not exist.
    await screen.findByRole("list", { name: /plans/i });
    expect(screen.queryByRole("button", { name: /choose|select|subscribe|buy|upgrade/i })).toBeNull();
  });
});

describe("paging", () => {
  it("asks for the first page with a bound", async () => {
    const billing = renderPlans(
      stubBilling({
        listPlans: vi.fn(async () => ({ data: [], page: { next_cursor: null, has_more: false } })),
      }),
    );

    await waitFor(() =>
      expect(billing.listPlans).toHaveBeenCalledWith({ limit: 25, order: "asc" }),
    );
  });

  it("asks for the next page when asked, passing the cursor back verbatim", async () => {
    // "Opaque base64url cursor... Clients must not parse it; its encoding may
    // change without notice." So the client hands it straight back.
    const billing = renderPlans(
      stubBilling({
        listPlans: vi
          .fn()
          .mockResolvedValueOnce({ data: [aPlan()], page: { next_cursor: "cursor-2", has_more: true } })
          .mockResolvedValue({ data: [], page: { next_cursor: null, has_more: false } }),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(billing.listPlans).toHaveBeenLastCalledWith({ limit: 25, order: "asc", cursor: "cursor-2" }),
    );
  });

  it("keeps the plans already shown when the next page arrives", async () => {
    renderPlans(
      stubBilling({
        listPlans: vi
          .fn()
          .mockResolvedValueOnce({
            data: [aPlan({ id: "p1", name: "Starter" })],
            page: { next_cursor: "c2", has_more: true },
          })
          .mockResolvedValue({
            data: [aPlan({ id: "p2", name: "Team" })],
            page: { next_cursor: null, has_more: false },
          }),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));

    // Paging that replaces the list is paging that loses the person's place.
    expect(await screen.findByText("Starter")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Team")).toBeInTheDocument());
  });

  it("offers no more button on the last page", async () => {
    renderPlans(
      stubBilling({
        listPlans: vi.fn(async () => ({
          data: [aPlan()],
          page: { next_cursor: null, has_more: false },
        })),
      }),
    );

    await screen.findByRole("list", { name: /plans/i });
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("keeps the button while the next page loads, marked busy", async () => {
    // Held on an object, not a bare `let`, because TypeScript narrows a `let`
    // initialised to null and never widens it — the call site ends up with
    // `settle: never`.
    const gate: { settle?: () => void } = {};
    renderPlans(
      stubBilling({
        listPlans: vi
          .fn()
          .mockResolvedValueOnce({ data: [aPlan()], page: { next_cursor: "c2", has_more: true } })
          .mockImplementation(
            () =>
              new Promise<PlanPage>((resolve) => {
                gate.settle = () =>
                  resolve({ data: [], page: { next_cursor: null, has_more: false } });
              }),
          ),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));

    const button = await screen.findByRole("button", { name: /load more/i });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(within(screen.getByRole("list", { name: /plans/i })).getByText("Team")).toBeTruthy();
    gate.settle?.();
  });
});

describe("when the plans cannot be loaded", () => {
  function failing() {
    return stubBilling({
      listPlans: vi.fn(async () => {
        throw aBillingError(503, "unavailable", {
          detail: "billing is not accepting requests",
        });
      }),
    });
  }

  it("says so, in an alert, and offers a retry", async () => {
    renderPlans(failing());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("does not leak the service's own words", async () => {
    renderPlans(
      stubBilling({
        listPlans: vi.fn(async () => {
          throw aBillingError(500, "internal", {
            detail: "pq: dial tcp 10.0.3.11:5432 refused",
          });
        }),
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("10.0.3.11");
    expect(alert).not.toHaveTextContent("5432");
  });

  it("asks again when the retry is used", async () => {
    const billing = failing();
    renderPlans(billing);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(billing.listPlans.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("a plan the service sent that does not match the contract", () => {
  it("is not rendered as a price, because it has none we can format", async () => {
    // A float in `amount_minor` would be a 422 on the way in, so a service that
    // sends one is broken. Rendering it anyway is how a page shows 19.5 minor
    // units as a plausible wrong number.
    renderPlans(
      stubBilling({
        listPlans: vi.fn(async () => ({
          data: [{ ...aPlan(), price: { amount_minor: 19.5, currency: "USD" } } as never],
          page: { next_cursor: null, has_more: false },
        })),
      }),
    );

    expect(await screen.findByText(/could not be shown/i)).toBeInTheDocument();
    expect(screen.queryByText(/19\.5/)).not.toBeInTheDocument();
  });
});
