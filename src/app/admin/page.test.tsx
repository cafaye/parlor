import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminPage from "./page";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { anOperatorUser, aNonStaffMe, aStaffMe, stubOperator } from "@/test/support/operator";
import { renderWithProviders } from "@/test/support/render";

/**
 * The system-admin console.
 *
 * Rendered through `renderWithProviders` with a stubbed identity client (for
 * the session) and a stubbed operator client (for the gate and the actions),
 * so no test can open a socket. A signed-in tree needs a token in the store
 * and a scripted identity `me()`; a staff tree additionally needs a scripted
 * operator `me()` answering `staff: true`.
 */

const TOKEN = "tok_abc";

function signIn() {
  createTokenStore().set(TOKEN);
}

function signedIn() {
  return stubIdentity({ me: vi.fn(() => Promise.resolve(aUser())) });
}

function renderAdmin({
  identity = signedIn(),
  operator = stubOperator({ me: vi.fn(() => Promise.resolve(aStaffMe())) }),
}: {
  identity?: ReturnType<typeof stubIdentity>;
  operator?: ReturnType<typeof stubOperator>;
} = {}) {
  return renderWithProviders(<AdminPage />, { identity, operator });
}

function searchFor(value: string) {
  fireEvent.change(screen.getByLabelText("Search users"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

/**
 * Render the staff console and wait for it: the gate is a fresh `operator/me`
 * read, so the search field is the proof the console arrived.
 */
async function renderConsole(options?: {
  identity?: ReturnType<typeof stubIdentity>;
  operator?: ReturnType<typeof stubOperator>;
}) {
  const operator =
    options?.operator ?? stubOperator({ me: vi.fn(() => Promise.resolve(aStaffMe())) });
  renderAdmin({ identity: options?.identity, operator });
  await screen.findByLabelText("Search users");
  return operator;
}

beforeEach(() => {
  localStorage.clear();
});

describe("admin page", () => {
  it("names itself as the platform surface", () => {
    signIn();
    renderAdmin();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/system admin/i);
  });

  it("sends an anonymous visitor through the sign-in flow", () => {
    renderAdmin({ identity: stubIdentity() });

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText("Search users")).not.toBeInTheDocument();
  });

  it("reads a dead token as signed out rather than as denied", async () => {
    signIn();
    renderAdmin({
      identity: stubIdentity({ me: vi.fn(() => Promise.reject(anIdentityError(401, "unauthenticated"))) }),
      operator: stubOperator({ me: vi.fn(() => Promise.reject(anIdentityError(401, "unauthenticated"))) }),
    });

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("refuses a signed-in non-staff session without naming anything searchable", async () => {
    signIn();
    renderAdmin({ operator: stubOperator({ me: vi.fn(() => Promise.resolve(aNonStaffMe())) }) });

    expect(await screen.findByRole("heading", { name: "Not available" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search users")).not.toBeInTheDocument();
  });

  it("refuses a 403 gate the same way as a non-staff answer", async () => {
    signIn();
    renderAdmin({
      operator: stubOperator({ me: vi.fn(() => Promise.reject(anIdentityError(403, "forbidden"))) }),
    });

    expect(await screen.findByRole("heading", { name: "Not available" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search users")).not.toBeInTheDocument();
  });

  it("reports a gate failure that is neither answer as a failure, not a refusal", async () => {
    signIn();
    renderAdmin({
      operator: stubOperator({ me: vi.fn(() => Promise.reject(anIdentityError(503, "unavailable"))) }),
    });

    expect(await screen.findByText("We could not check your operator access.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Not available" })).not.toBeInTheDocument();
  });
});

describe("user search", () => {
  it("asks nothing of the service before the first search", async () => {
    signIn();
    const operator = await renderConsole();

    expect(screen.getByText("No search yet")).toBeInTheDocument();
    expect(operator.searchUsers).not.toHaveBeenCalled();
  });

  it("refuses an empty query before a round trip", async () => {
    signIn();
    const operator = await renderConsole();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByText("Enter an email address or name to search for.")).toBeInTheDocument();
    expect(operator.searchUsers).not.toHaveBeenCalled();
  });

  it("lists matches with active/disabled and verified state", async () => {
    signIn();
    const users = [
      anOperatorUser(),
      anOperatorUser({
        id: "8f2c1a44-0000-4000-8000-000000000002",
        email: "sam@example.com",
        display_name: null,
        disabled_at: "2026-09-02T00:00:00Z",
        email_verified_at: null,
      }),
    ];
    await renderConsole({
      operator: stubOperator({
        me: vi.fn(() => Promise.resolve(aStaffMe())),
        searchUsers: vi.fn(() => Promise.resolve(users)),
      }),
    });

    searchFor("example.com");

    const list = await screen.findByRole("list", { name: "Matching users" });
    expect(within(list).getByRole("button", { name: /kaka@example.com.*Active.*Verified/ }));
    expect(within(list).getByRole("button", { name: /sam@example.com.*Disabled.*Unverified/ }));
  });

  it("reads an empty result as an answer rather than a failure", async () => {
    signIn();
    await renderConsole({
      operator: stubOperator({
        me: vi.fn(() => Promise.resolve(aStaffMe())),
        searchUsers: vi.fn(() => Promise.resolve([])),
      }),
    });

    searchFor("nobody-here@example.com");

    expect(await screen.findByText("No users found")).toBeInTheDocument();
  });

  it("renders a search refusal as a failure with a retry", async () => {
    signIn();
    const searchUsers = vi.fn(() => Promise.reject(anIdentityError(503, "unavailable")));
    await renderConsole({
      operator: stubOperator({ me: vi.fn(() => Promise.resolve(aStaffMe())), searchUsers }),
    });

    searchFor("example.com");

    expect(await screen.findByText("We could not search users.")).toBeInTheDocument();
    searchUsers.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(searchUsers).toHaveBeenCalled());
  });
});

describe("disable and enable", () => {
  it("asks for explicit confirm before disabling, and disables on it", async () => {
    signIn();
    const user = anOperatorUser();
    const operator = stubOperator({
      me: vi.fn(() => Promise.resolve(aStaffMe())),
      searchUsers: vi.fn(() => Promise.resolve([user])),
      disableUser: vi.fn(() => Promise.resolve()),
    });
    await renderConsole({ operator });

    searchFor("kaka@example.com");
    fireEvent.click(await screen.findByRole("button", { name: /kaka@example.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/kaka@example.com/);
    const gateCalls = (operator.me as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable this user" }));

    await waitFor(() => expect(operator.disableUser).toHaveBeenCalledWith(TOKEN, user.id));
    // Every action re-verifies staff before acting: the gate is read again on
    // top of the read that opened the console.
    expect((operator.me as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(gateCalls);
    expect(await screen.findByText("That user is now disabled.")).toBeInTheDocument();
  });

  it("does nothing when the confirm is cancelled", async () => {
    signIn();
    const operator = stubOperator({
      me: vi.fn(() => Promise.resolve(aStaffMe())),
      searchUsers: vi.fn(() => Promise.resolve([anOperatorUser()])),
      disableUser: vi.fn(() => Promise.resolve()),
    });
    await renderConsole({ operator });

    searchFor("kaka@example.com");
    fireEvent.click(await screen.findByRole("button", { name: /kaka@example.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(operator.disableUser).not.toHaveBeenCalled();
  });

  it("re-enables a disabled user after confirm", async () => {
    signIn();
    const user = anOperatorUser({ disabled_at: "2026-09-02T00:00:00Z" });
    const operator = stubOperator({
      me: vi.fn(() => Promise.resolve(aStaffMe())),
      searchUsers: vi.fn(() => Promise.resolve([user])),
      enableUser: vi.fn(() => Promise.resolve()),
    });
    await renderConsole({ operator });

    searchFor("kaka@example.com");
    fireEvent.click(await screen.findByRole("button", { name: /kaka@example.com/ }));

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-enable" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Re-enable this user" }));

    await waitFor(() => expect(operator.enableUser).toHaveBeenCalledWith(TOKEN, user.id));
    expect(await screen.findByText("That user is now enabled.")).toBeInTheDocument();
  });

  it("refuses the action when staff was lost between gate and confirm", async () => {
    signIn();
    const user = anOperatorUser();
    // The gate read answers staff; every read after it answers non-staff: the
    // session lost staff while the console was open.
    let reads = 0;
    const me = vi.fn(() => {
      reads += 1;
      return Promise.resolve(reads === 1 ? aStaffMe() : aNonStaffMe());
    });
    const operator = stubOperator({
      me,
      searchUsers: vi.fn(() => Promise.resolve([user])),
      disableUser: vi.fn(() => Promise.resolve()),
    });
    await renderConsole({ operator });

    searchFor("kaka@example.com");
    fireEvent.click(await screen.findByRole("button", { name: /kaka@example.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable this user" }));

    expect(
      await screen.findByText(
        "Your operator access changed while you were working. Sign in again and try once more.",
      ),
    ).toBeInTheDocument();
    expect(operator.disableUser).not.toHaveBeenCalled();
  });

  it("renders a gone user as gone rather than as a failure to act", async () => {
    signIn();
    const operator = stubOperator({
      me: vi.fn(() => Promise.resolve(aStaffMe())),
      searchUsers: vi.fn(() => Promise.resolve([anOperatorUser()])),
      disableUser: vi.fn(() => Promise.reject(anIdentityError(404, "not_found"))),
    });
    await renderConsole({ operator });

    searchFor("kaka@example.com");
    fireEvent.click(await screen.findByRole("button", { name: /kaka@example.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable this user" }));

    expect(await screen.findByText("That user no longer exists. Search again.")).toBeInTheDocument();
  });
});
