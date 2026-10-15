import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChargesPage from "./page";
import { aBillingError, aCharge, stubBilling } from "@/test/support/billing";
import { aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";
import { createTokenStore } from "@/lib/token-store";

const identity = () => stubIdentity({ me: vi.fn(() => Promise.resolve(aUser())) });

function renderCharges(billing = stubBilling()) {
  createTokenStore().set("tok_abc", "2026-03-14T12:00:00Z");
  return { billing, ...renderWithProviders(ChargesPage(), { identity: identity(), billing }) };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the charges screen", () => {
  it("lists this account's charges with a link to each receipt", async () => {
    const billing = stubBilling({
      listCharges: vi.fn(() =>
        Promise.resolve({
          data: [aCharge({ id: "chg_1", amount: 1900, currency: "USD", description: "Team" })],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderCharges(billing);

    await waitFor(() => expect(screen.getByText("Team")).toBeTruthy());
    expect(screen.getByText(/19\.00/)).toBeTruthy();
    // The receipt is billing's own HTML document, so a link and not a fetch:
    // a second renderer for one document would be a second answer to "what did
    // this customer pay".
    expect(screen.getByRole("link", { name: "Receipt" }).getAttribute("href")).toBe("/v1/charges/chg_1");
  });

  it("shows an empty history rather than an error when nothing was charged", async () => {
    const billing = stubBilling({
      listCharges: vi.fn(() => Promise.resolve({ data: [], page: { next_cursor: null, has_more: false } })),
    });

    renderCharges(billing);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not been charged/i));
  });

  it("says billing is not configured, rather than an error, in the launch shape", async () => {
    const billing = stubBilling({
      listCharges: vi.fn(() => Promise.reject(aBillingError(503, "billing_not_configured"))),
    });

    renderCharges(billing);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not configured/i));
  });

  it("formats a zero-decimal currency with no decimal point it does not have", async () => {
    const billing = stubBilling({
      listCharges: vi.fn(() =>
        Promise.resolve({
          data: [aCharge({ amount: 1900, currency: "JPY" })],
          page: { next_cursor: null, has_more: false },
        }),
      ),
    });

    renderCharges(billing);

    await waitFor(() => expect(screen.getByText(/1,900/)).toBeTruthy());
    expect(screen.queryByText(/1,900\.00/)).toBeNull();
  });
});
