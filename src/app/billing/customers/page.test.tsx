import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CustomersPage from "./page";
import type { Customer, CustomerPage as CustomerPageType } from "@/lib/billing";
import { aBillingError, aCustomer, stubBilling } from "@/test/support/billing";
import { stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

/**
 * `/billing/customers` — billing's customer records.
 *
 * The framing is the most important thing on this page, and it is a contract
 * fact rather than a copy choice. billing's document declares `security: []`
 * with no `securitySchemes`, and says in its own header comment that
 * `GET /v1/customers` "returns every customer, because there is no account to
 * scope it by". So this is a **platform-wide** list, not somebody's billing
 * page, and a screen that titled it "Your billing" and put it behind a signed-in
 * shell would be implying a scoping the service does not perform.
 *
 * The second thing the service will not let us claim: `processor_customer_id`
 * is "always null in v0: this build makes no Stripe call". So no row may say
 * anything about a payment method, and no row may imply a card is on file.
 */

beforeEach(() => {
  localStorage.clear();
});

const PAGE: CustomerPageType = {
  data: [aCustomer()],
  page: { next_cursor: null, has_more: false },
};

function renderCustomers(billing = stubBilling({ listCustomers: vi.fn(async () => PAGE) })) {
  renderWithProviders(<CustomersPage />, { identity: stubIdentity(), billing });
  return billing;
}

describe("the customer list", () => {
  it("names itself", () => {
    renderCustomers(stubBilling({ listCustomers: vi.fn(() => new Promise<CustomerPageType>(() => {})) }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/customers/i);
  });

  it("says it is the whole platform's list, not the reader's", () => {
    renderCustomers(stubBilling({ listCustomers: vi.fn(() => new Promise<CustomerPageType>(() => {})) }));

    // The service scopes this by nothing. A page that said "your billing
    // details" would be promising a tenancy boundary that does not exist.
    expect(screen.getByText(/every customer|all customers|whole platform/i)).toBeInTheDocument();
  });
});

describe("while the customers are loading", () => {
  it("says what is loading", () => {
    renderCustomers(stubBilling({ listCustomers: vi.fn(() => new Promise<CustomerPageType>(() => {})) }));

    expect(screen.getByRole("status")).toHaveTextContent(/loading customers/i);
  });

  it("does not claim there are none before it has answered", () => {
    renderCustomers(stubBilling({ listCustomers: vi.fn(() => new Promise<CustomerPageType>(() => {})) }));

    expect(screen.queryByText(/no customers/i)).not.toBeInTheDocument();
  });
});

describe("when there are no customers", () => {
  it("says so, without calling it a failure", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => ({
          data: [],
          page: { next_cursor: null, has_more: false },
        })),
      }),
    );

    expect(await screen.findByText(/no customers/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still offers the create form", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => ({
          data: [],
          page: { next_cursor: null, has_more: false },
        })),
      }),
    );

    expect(await screen.findByRole("button", { name: /create customer/i })).toBeInTheDocument();
  });
});

describe("when the customers are there", () => {
  function withCustomers() {
    return stubBilling({
      listCustomers: vi.fn(async () => ({
        data: [
          aCustomer({ id: "cus_1", email: "kaka@example.com", owner: { type: "User", id: "usr_1" } }),
          aCustomer({ id: "cus_2", email: null, owner: { type: "Account", id: "acc_0a1b2c3d" } }),
        ],
        page: { next_cursor: null, has_more: false },
      })),
    });
  }

  it("shows the owner's email when there is one", async () => {
    renderCustomers(withCustomers());

    expect(await screen.findByText("kaka@example.com")).toBeInTheDocument();
  });

  it("says there is no email rather than printing nothing or printing null", async () => {
    renderCustomers(withCustomers());

    const list = await screen.findByRole("list", { name: /customers/i });
    // `Customer.email` is `type: [string, 'null']`. An empty cell reads as a
    // loading failure; the word "none" is an answer.
    expect(within(list).getByText(/no email on file/i)).toBeInTheDocument();
  });

  it("says what kind of thing the customer belongs to, because the id alone says nothing", async () => {
    renderCustomers(withCustomers());

    const list = await screen.findByRole("list", { name: /customers/i });
    // `CustomerOwner.type` is the enum [User, Account] and it is the only
    // reference from billing back to identity. A bare uuid is not navigable.
    expect(within(list).getByText(/^user$/i)).toBeInTheDocument();
    expect(within(list).getByText(/^account$/i)).toBeInTheDocument();
  });

  it("says no payment processor is connected, rather than implying a card is on file", async () => {
    renderCustomers(withCustomers());

    // `processor_customer_id` is "always null in v0: this build makes no Stripe
    // call". Rendering a blank, or a dash, invites the reading that a card
    // exists and something failed to load.
    expect(await screen.findAllByText(/not connected/i)).not.toHaveLength(0);
  });
});

describe("creating a customer", () => {
  it("needs an owner before it will send anything", async () => {
    const billing = renderCustomers();
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    expect(await screen.findByText(/owner id is required/i)).toBeInTheDocument();
    expect(billing.createCustomer).not.toHaveBeenCalled();
  });

  it("sends the owner kind and id, and the processor", async () => {
    const billing = renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(async () => aCustomer({ id: "cus_new" })),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner kind"), { target: { value: "Account" } });
    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "acc_0a1b2c3d" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "kaka@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() =>
      expect(billing.createCustomer).toHaveBeenCalledWith({
        owner: { type: "Account", id: "acc_0a1b2c3d" },
        processor: "stripe",
        email: "kaka@example.com",
      }),
    );
  });

  it("sends only the fields the schema allows", async () => {
    const billing = renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(async () => aCustomer({ id: "cus_new" })),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => expect(billing.createCustomer).toHaveBeenCalled());
    // `CustomerCreate` is `additionalProperties: false`, and an unknown field
    // is a 422. The screen must not send an optimistic `metadata: {}`.
    expect(billing.createCustomer).toHaveBeenCalledWith({
      owner: { type: "User", id: "usr_1" },
      processor: "stripe",
    });
  });

  it("shows the customer it created", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi
          .fn()
          .mockResolvedValueOnce({ data: [], page: { next_cursor: null, has_more: false } })
          .mockResolvedValue({
            data: [aCustomer({ id: "cus_new", email: "new@example.com" })],
            page: { next_cursor: null, has_more: false },
          }),
        createCustomer: vi.fn(async () => aCustomer({ id: "cus_new", email: "new@example.com" })),
      }),
    );

    fireEvent.change(await screen.findByLabelText("Owner id"), { target: { value: "usr_9" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
  });

  it("says when one already exists for that owner, and does not offer a blind retry", async () => {
    // "One customer per (owner, processor): a second attempt is a 409." A retry
    // button here is a guaranteed second 409.
    const billing = renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(async () => {
          throw aBillingError(409, "conflict", {
            detail: "a customer already exists for that owner and processor",
          });
        }),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // And it was asked exactly once: a screen that re-sent on render would turn
    // one refused click into a burst of guaranteed 409s.
    expect(billing.createCustomer).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the service's own wording", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(async () => {
          throw aBillingError(409, "conflict", { detail: "UNIQUE violation on customers_owner_key" });
        }),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await screen.findByText(/already exists/i);
    expect(screen.queryByText(/UNIQUE violation/)).not.toBeInTheDocument();
  });

  it("puts a field failure on the field it names", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(async () => {
          throw aBillingError(422, "validation_failed", {
            fieldErrors: [{ field: "email", code: "invalid_format" }],
          });
        }),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "usr_1" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid");
  });

  it("keeps what was typed after a failure", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(async () => {
          throw aBillingError(503, "unavailable");
        }),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Owner id")).toHaveValue("usr_1");
  });

  it("marks the button busy without renaming it", async () => {
    const gate: { settle?: () => void } = {};
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => PAGE),
        createCustomer: vi.fn(
          () =>
            new Promise<Customer>((resolve) => {
              gate.settle = () => resolve(aCustomer({ id: "cus_new" }));
            }),
        ),
      }),
    );
    await screen.findByRole("button", { name: /create customer/i });

    fireEvent.change(screen.getByLabelText("Owner id"), { target: { value: "usr_1" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    const button = await screen.findByRole("button", { name: /create customer/i });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeDisabled();
    gate.settle?.();
  });
});

describe("when the customers cannot be loaded", () => {
  function failing() {
    return stubBilling({
      listCustomers: vi.fn(async () => {
        throw aBillingError(503, "unavailable");
      }),
    });
  }

  it("says so, in an alert, and offers a retry", async () => {
    renderCustomers(failing());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("does not leak the service's own words", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi.fn(async () => {
          throw aBillingError(500, "internal", { detail: "pq: dial tcp 10.0.3.11:5432 refused" });
        }),
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("10.0.3.11");
  });

  it("asks again when the retry is used", async () => {
    const billing = failing();
    renderCustomers(billing);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(billing.listCustomers.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("paging", () => {
  it("offers no more button on the last page", async () => {
    renderCustomers();

    await screen.findByRole("list", { name: /customers/i });
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("keeps what is already shown when the next page arrives", async () => {
    renderCustomers(
      stubBilling({
        listCustomers: vi
          .fn()
          .mockResolvedValueOnce({
            data: [aCustomer({ id: "cus_1", email: "first@example.com" })],
            page: { next_cursor: "c2", has_more: true },
          })
          .mockResolvedValue({
            data: [aCustomer({ id: "cus_2", email: "second@example.com" })],
            page: { next_cursor: null, has_more: false },
          }),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));

    expect(await screen.findByText("first@example.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("second@example.com")).toBeInTheDocument());
  });
});
