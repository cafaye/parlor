import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountsPage from "./page";
import type { Account, AccountListItem } from "@/lib/identity";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { anAccount, anAccountListItem } from "@/test/support/tenancy";
import { renderWithProviders } from "@/test/support/render";

/**
 * The account list and the create form.
 *
 * Composed with the page component so the `h1` is asserted where it is
 * actually rendered, and rendered through `renderWithProviders` so the identity
 * client is a stub and no test can open a socket.
 *
 * A signed-in tree needs two things: a token in the store, and a scripted
 * `me()`. The token is what the query keys and every tenancy call are built
 * from, so a test that sets one and leaves the other unscripted would fail on
 * the unscripted call rather than on anything about this screen.
 */

const TOKEN = "tok_abc";

/**
 * A promise plus the handle that settles it.
 *
 * Written as an object rather than a bare `let release` because TypeScript
 * narrows a `let` initialised to `null` and never widens it again, so the
 * call site ends up with `release?: never` and a type error. The object
 * property is mutable, so the narrowing does not happen.
 */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * Sign in the way the app does.
 *
 * Through the store rather than `localStorage.setItem`, because the store
 * writes a JSON envelope and reads one back. Writing the bare token string
 * makes `get()` fail its parse and return null — which renders as a
 * *signed-out* tree, so the test would pass its "signed out" assertions while
 * claiming to be testing the signed-in ones.
 */
function signIn() {
  createTokenStore().set(TOKEN);
}

/** A signed-in stub whose account list is whatever `accounts` says. */
function signedIn(accounts: AccountListItem[] = [], overrides = {}) {
  return stubIdentity({
    me: vi.fn(async () => aUser()),
    listAccounts: vi.fn(async () => accounts),
    ...overrides,
  });
}

function typeName(value: string) {
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("accounts page", () => {
  it("names itself", () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn([]) });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/accounts/i);
  });
});

describe("when nobody is signed in", () => {
  it("offers a way in rather than an error", async () => {
    renderWithProviders(<AccountsPage />, { identity: stubIdentity() });

    // Asking a service a question you are not signed in to ask gets a 401, and
    // rendering that as "something went wrong" tells a signed-out visitor they
    // have done something wrong.
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not ask the service for accounts at all", () => {
    const identity = stubIdentity();
    renderWithProviders(<AccountsPage />, { identity });

    // The query is disabled without a token. A fired request would be a 401 and
    // a retry storm from a visitor who is simply not signed in yet.
    expect(identity.listAccounts).not.toHaveBeenCalled();
  });
});

describe("while the accounts are loading", () => {
  it("says what is loading", async () => {
    signIn();
    // A list request that never settles. Every other stub in this file resolves
    // in a microtask, so without this the loading state is gone before the first
    // assertion runs and the test would pass without ever seeing it.
    renderWithProviders(<AccountsPage />, {
      identity: signedIn([], { listAccounts: vi.fn(() => new Promise(() => {})) }),
    });

    // Waiting for the create form is how this test knows the session has
    // resolved. It is the marker that separates "still checking who you are"
    // from "checking your accounts", and both render a `status` region, so
    // asserting on the role alone would race between them.
    await screen.findByLabelText("Account name");

    expect(screen.getByRole("status")).toHaveTextContent("Loading accounts…");
  });

  it("does not claim the list is empty before it has answered", () => {
    // This is the failure that trains people to click "Try again": an empty
    // state painted over a fetch that has not returned yet reads as "you have no
    // accounts", which is a different and wrong thing to say.
    signIn();
    renderWithProviders(<AccountsPage />, {
      identity: signedIn([], { listAccounts: vi.fn(() => new Promise(() => {})) }),
    });

    expect(screen.queryByText(/no accounts yet/i)).not.toBeInTheDocument();
  });

  it("does not show the create form until we know who is asking", () => {
    // A form that posts on behalf of a session we have not resolved yet would
    // create the account with no owner.
    signIn();
    renderWithProviders(<AccountsPage />, {
      identity: signedIn([], { listAccounts: vi.fn(() => new Promise(() => {})) }),
    });

    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i);
    expect(screen.queryByLabelText("Account name")).not.toBeInTheDocument();
  });
});

describe("when the account list is empty", () => {
  it("says so, and says it is not a failure", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn([]) });

    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still offers the create form, because that is the next thing to do", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn([]) });

    expect(await screen.findByLabelText("Account name")).toBeInTheDocument();
  });
});

describe("when the accounts are there", () => {
  const accounts = [
    anAccountListItem({ id: "acc_one", name: "Acme Corp", slug: "acme-corp", role: "owner" }),
    anAccountListItem({ id: "acc_two", name: "Personal", slug: "personal", role: "member", personal: true }),
  ];

  it("links each one to its own page", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn(accounts) });

    expect(await screen.findByRole("link", { name: /Acme Corp/ })).toHaveAttribute(
      "href",
      "/accounts/acc_one",
    );
    expect(screen.getByRole("link", { name: /Personal/ })).toHaveAttribute(
      "href",
      "/accounts/acc_two",
    );
  });

  it("shows the caller's role on each, because it decides what they may do", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn(accounts) });

    const list = await screen.findByRole("list", { name: /your accounts/i });

    expect(within(list).getByText("Owner")).toBeInTheDocument();
    expect(within(list).getByText("Member")).toBeInTheDocument();
  });

  it("marks a personal account, so it is not mistaken for a shared one", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn(accounts) });

    expect(await screen.findByText("Personal account")).toBeInTheDocument();
  });

  it("shows the handle, so a person can recognise the account they are in", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn(accounts) });

    // The slug is the account's stable handle and never changes on a rename, so
    // it is the one string a person can be sure about.
    expect(await screen.findByText("acme-corp")).toBeInTheDocument();
  });
});

describe("when the account list cannot be loaded", () => {
  it("says so, in an alert, and offers a retry", async () => {
    signIn();
    const identity = signedIn([], {
      listAccounts: vi.fn(async () => {
        throw anIdentityError(503, "unavailable");
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("does not leak the service's own words about the failure", async () => {
    signIn();
    const identity = signedIn([], {
      listAccounts: vi.fn(async () => {
        // The service's `detail` is where a host or an internal class lives.
        throw anIdentityError(500, "internal", {
          detail: "dial tcp 10.0.3.11:5432: connection refused",
        });
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("10.0.3.11");
    expect(alert).not.toHaveTextContent("5432");
  });

  it("asks again when the retry button is used", async () => {
    signIn();
    const identity = signedIn([], {
      listAccounts: vi.fn(async () => {
        throw anIdentityError(503, "unavailable");
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(identity.listAccounts.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("creating an account", () => {
  it("refuses a blank name without asking the service", async () => {
    signIn();
    const identity = signedIn([]);
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    submit();

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(identity.createAccount).not.toHaveBeenCalled();
  });

  it("refuses a name it could not make a handle from, and says why", async () => {
    signIn();
    const identity = signedIn([]);
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("!!!");
    submit();

    // "Name is not valid" would be true and useless. The service refuses these
    // because an empty slug is NOT NULL, and that is worth saying.
    expect(await screen.findByText(/at least one letter or number/i)).toBeInTheDocument();
    expect(identity.createAccount).not.toHaveBeenCalled();
  });

  it("marks the field invalid so the message is announced with it", async () => {
    signIn();
    renderWithProviders(<AccountsPage />, { identity: signedIn([]) });

    await screen.findByLabelText("Account name");
    submit();

    await waitFor(() => expect(screen.getByLabelText("Account name")).toHaveAttribute("aria-invalid"));
  });

  it("sends the trimmed name", async () => {
    signIn();
    const identity = signedIn([], {
      createAccount: vi.fn(async () => anAccount({ id: "acc_new", name: "Acme Corp" })),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("  Acme Corp  ");
    submit();

    // The service trims before validating, so a name with a trailing space is
    // the same name. Sending the padded one would still work, but the stored
    // value and the field would disagree.
    await waitFor(() => expect(identity.createAccount).toHaveBeenCalledWith(TOKEN, { name: "Acme Corp" }));
  });

  it("sends the caller's token, because that is what authorises the account", async () => {
    signIn();
    const identity = signedIn([], {
      createAccount: vi.fn(async () => anAccount()),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    await waitFor(() => expect(identity.createAccount).toHaveBeenCalledWith(TOKEN, expect.anything()));
  });

  it("shows the new account in the list afterwards", async () => {
    signIn();
    // First call: nothing. After the create, the list is invalidated and asked
    // again — which is the only way the new account gets an id on screen.
    const listAccounts = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([anAccountListItem({ id: "acc_new", name: "Acme Corp" })]);
    const identity = signedIn([], {
      listAccounts,
      createAccount: vi.fn(async () => anAccount({ id: "acc_new", name: "Acme Corp" })),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    expect(await screen.findByRole("link", { name: /Acme Corp/ })).toHaveAttribute(
      "href",
      "/accounts/acc_new",
    );
  });

  it("clears the field so a second account does not start with the first one's name", async () => {
    signIn();
    renderWithProviders(
      <AccountsPage />,
      {
        identity: signedIn([], { createAccount: vi.fn(async () => anAccount({ id: "acc_new" })) }),
      },
    );

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    await waitFor(() => expect(screen.getByLabelText("Account name")).toHaveValue(""));
  });

  it("marks the button busy without renaming it", async () => {
    signIn();
    const gate = deferred<Account>();
    const identity = signedIn([], { createAccount: vi.fn(() => gate.promise) });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    // The accessible name must not change: a control that renames itself
    // mid-interaction loses its own label for anyone navigating by name.
    const button = await screen.findByRole("button", { name: "Create account" });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeDisabled();

    gate.settle(anAccount({ id: "acc_new" }));
  });

  it("sends only one request when the button is clicked twice", async () => {
    signIn();
    const gate = deferred<Account>();
    const identity = signedIn([], { createAccount: vi.fn(() => gate.promise) });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    const button = await screen.findByRole("button", { name: "Create account" });
    fireEvent.click(button);
    // The second click lands in the frame before the re-render that disables
    // the button, which is exactly the window a `pending` read is stale in.
    fireEvent.click(button);

    gate.settle(anAccount({ id: "acc_new" }));
    await waitFor(() => expect(identity.createAccount).toHaveBeenCalledTimes(1));
  });

  it("puts a name conflict on the name field, not in a banner", async () => {
    signIn();
    const identity = signedIn([], {
      createAccount: vi.fn(async () => {
        // ErrSlugTaken: the handle, derived from the name, is taken. The only
        // conflict this endpoint declares is about the name, so the message
        // belongs on the name.
        throw anIdentityError(409, "conflict", {
          detail: "an account with that name already exists",
        });
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it("does not repeat the service's own wording for the conflict", async () => {
    signIn();
    const identity = signedIn([], {
      createAccount: vi.fn(async () => {
        throw anIdentityError(409, "conflict", { detail: "handle acme-corp is UNIQUE-violated" });
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    await screen.findByText(/already exists/i);
    // The service's detail is not rendered anywhere. This screen's own sentence
    // is what a person reads.
    expect(screen.queryByText(/UNIQUE-violated/)).not.toBeInTheDocument();
  });

  it("reports a service failure in a banner, without blaming the name", async () => {
    signIn();
    const identity = signedIn([], {
      createAccount: vi.fn(async () => {
        throw anIdentityError(500, "internal");
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    // A 500 says nothing about whether the name is acceptable, so putting a
    // message on the name field would invent a per-field failure that did not
    // happen and send somebody off to rename a perfectly good account.
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not create the account/i);
    expect(screen.getByLabelText("Account name")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps what was typed so a retry does not lose it", async () => {
    signIn();
    const identity = signedIn([], {
      createAccount: vi.fn(async () => {
        throw anIdentityError(503, "unavailable");
      }),
    });
    renderWithProviders(<AccountsPage />, { identity });

    await screen.findByLabelText("Account name");
    typeName("Acme Corp");
    submit();

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Account name")).toHaveValue("Acme Corp");
  });
});
