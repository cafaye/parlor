import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountScreen } from "./account-screen";
import type { Account, AccountDetail, MemberList, Membership } from "@/lib/identity";
import { createTokenStore } from "@/lib/token-store";
import type { Role } from "@/lib/roles";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import {
  anAccountDetail,
  aMembership,
  aMembershipAsTheServiceSendsIt,
  anInvitation,
} from "@/test/support/tenancy";
import { renderWithProviders } from "@/test/support/render";

/**
 * One account: its facts, its members, and the four things a person can do to
 * it.
 *
 * Rendered through the client screen rather than the page component. The page
 * is a server component whose only job is to await `params` and hand over an
 * id, and there is nothing in that to test — the h1 is here, in the screen,
 * because the account's name is not known until the client has asked.
 *
 * Two failures in the service shape most of this file, and both are asserted
 * rather than worked around:
 *
 *   - The service answers 404, not 403, for "you are not a member of this
 *     account", so a wrong id and a real account you cannot see are one
 *     sentence. The screen must not tell them apart either.
 *   - A member list arrives with no `user_id` on any row, so no member can be
 *     named and no per-member action can be addressed. See
 *     `aMembershipAsTheServiceSendsIt`.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const TOKEN = "tok_abc";
const ACCOUNT_ID = "acc_0a1b2c3d";
const CALLER_ID = "usr_caller_01";

function signIn() {
  createTokenStore().set(TOKEN);
}

/** A signed-in caller whose id is `CALLER_ID`, so "is this row you?" is answerable. */
const ME = aUser({ id: CALLER_ID, email: "kaka@example.com" });

function gate<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** A stub with the session, the account and the member panel all answering. */
function asCaller(
  {
    role = "owner" as Role,
    members,
    account,
  }: { role?: Role; members?: Membership[]; account?: Partial<Account> } = {},
  overrides = {},
) {
  const detail: AccountDetail = anAccountDetail({ id: ACCOUNT_ID, role, ...account });
  const panel: MemberList = { memberships: members ?? [aMembership({ role: "owner" })], role };
  return stubIdentity({
    me: vi.fn(async () => ME),
    getAccount: vi.fn(async () => detail),
    listMembers: vi.fn(async () => panel),
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

// ---------------------------------------------------------------------------
// Finding the account
// ---------------------------------------------------------------------------

describe("an account you can see", () => {
  it("names itself after the account", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller() });

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Acme Corp");
  });

  it("shows the caller's role, because it decides what they may do", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "admin" }) });

    expect(await screen.findByText("Admin")).toBeInTheDocument();
  });

  it("shows the handle and says it does not move on a rename", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller() });

    // The slug is derived once at creation and never again, so it is the one
    // string a person can rely on, and saying so stops somebody chasing a
    // broken link after a rename.
    expect(await screen.findByText("acme-corp")).toBeInTheDocument();
    expect(screen.getByText(/never changes/i)).toBeInTheDocument();
  });

  it("marks a personal account", async () => {
    signIn();
    renderWithProviders(
      <AccountScreen accountId={ACCOUNT_ID} />,
      { identity: asCaller({ account: { personal: true } }) },
    );

    expect(await screen.findByText("Personal account")).toBeInTheDocument();
  });

  it("asks the service with the caller's token", async () => {
    signIn();
    const identity = asCaller();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    await screen.findByRole("heading", { level: 1 });
    expect(identity.getAccount).toHaveBeenCalledWith(TOKEN, ACCOUNT_ID);
  });
});

describe("an account you cannot see", () => {
  // The service answers 404 for "no such account" and 404 for "an account you
  // are not a member of", with the same sentence, so that a guessed id cannot
  // be used to discover which accounts exist. The screen has to keep them
  // together or it undoes that.
  function notVisible(status: number, code: string) {
    return asCaller(
      {},
      {
        getAccount: vi.fn(async () => {
          throw anIdentityError(status, code, { detail: "no such account is visible to you" });
        }),
      },
    );
  }

  it("says it cannot be found, for a 404", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: notVisible(404, "not_found") });

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/not found/i);
  });

  it("does not say the account exists but is forbidden", async () => {
    // The forbidden sentence is the one that leaks: "you are not a member"
    // confirms the id is real. A 404 here is not a limitation, it is the
    // contract.
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: notVisible(404, "not_found") });

    await screen.findByRole("heading", { level: 1, name: /not found/i });
    expect(screen.queryByText(/not a member/i)).toBeNull();
    expect(screen.queryByText(/forbidden/i)).toBeNull();
    expect(screen.queryByText(/only an owner/i)).toBeNull();
  });

  it("offers a way back to the accounts you can see", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: notVisible(404, "not_found") });

    expect(await screen.findByRole("link", { name: /your accounts/i })).toHaveAttribute(
      "href",
      "/accounts",
    );
  });

  it("reports a service failure as temporary, and does not claim the account is gone", async () => {
    signIn();
    const identity = asCaller(
      {},
      {
        getAccount: vi.fn(async () => {
          throw anIdentityError(503, "unavailable");
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    // A 503 is the service being down. Rendering "this account does not exist"
    // for it would tell somebody their account has been deleted.
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("heading", { level: 1, name: /not found/i })).toBeNull();
  });
});

describe("while the account is loading", () => {
  it("says what is loading", async () => {
    signIn();
    const hanging = gate<AccountDetail>();
    renderWithProviders(
      <AccountScreen accountId={ACCOUNT_ID} />,
      { identity: asCaller({}, { getAccount: vi.fn(() => hanging.promise) }) },
    );

    // The create-account form is the marker that the session has resolved, which
    // is what separates this from the session still being checked.
    await waitFor(() => expect(hanging.promise).toBeDefined());
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));

    expect(screen.getAllByRole("status").map((node) => node.textContent).join(" ")).toMatch(
      /loading|checking/i,
    );
    hanging.settle(anAccountDetail());
  });
});

// ---------------------------------------------------------------------------
// The member panel
// ---------------------------------------------------------------------------

describe("the member panel", () => {
  /**
   * The panel's own `<section>` is on screen before its query resolves — the
   * heading and the border paint immediately, and the data arrives a microtask
   * later. So every assertion about panel *contents* waits, and only assertions
   * about the panel's existence do not.
   */
  async function loadedPanel() {
    return (await screen.findByRole("region", { name: "Members" })) as HTMLElement;
  }

  it("counts the members by role, which is what the service actually sends", async () => {
    signIn();
    const identity = asCaller({
      members: [
        aMembershipAsTheServiceSendsIt({ role: "owner" }),
        aMembershipAsTheServiceSendsIt({ role: "admin" }),
        aMembershipAsTheServiceSendsIt({ role: "member" }),
        aMembershipAsTheServiceSendsIt({ role: "member" }),
      ],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    await within(panel).findByText(/not returning member names/i);

    // Read as one string with the whitespace squeezed out. Asserting each
    // number with getByText does not work — "1" is the owner count and the admin
    // count and anything else that happens to be one — and asserting on
    // `getByText("1 owner")` would be testing wording rather than the counts.
    const counts = panel.querySelector("dl");
    expect(counts?.textContent?.replace(/\s+/g, "")).toBe("Total4Owners1Admins1Members2");
  });

  it("omits a role nobody holds, rather than showing it as zero", async () => {
    signIn();
    const identity = asCaller({
      members: [aMembershipAsTheServiceSendsIt({ role: "owner" })],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    await within(panel).findByText(/not returning member names/i);

    const counts = panel.querySelector("dl");
    // "0 admins" is noise: it tells a person nothing and has to be read past.
    expect(counts?.textContent?.replace(/\s+/g, "")).toBe("Total1Owners1");
  });

  it("names each role in the count, so the numbers mean something", async () => {
    signIn();
    const identity = asCaller({
      members: [
        aMembershipAsTheServiceSendsIt({ role: "owner" }),
        aMembershipAsTheServiceSendsIt({ role: "admin" }),
        aMembershipAsTheServiceSendsIt({ role: "member" }),
        aMembershipAsTheServiceSendsIt({ role: "member" }),
      ],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    await within(panel).findByText(/not returning member names/i);

    expect(within(panel).getByText("Owners")).toBeInTheDocument();
    expect(within(panel).getByText("Admins")).toBeInTheDocument();
    expect(within(panel).getByText("Members", { selector: "dt" })).toBeInTheDocument();
  });

  it("says the service is not returning member names, rather than showing blanks", async () => {
    // The honest rendering of a contract gap. Showing four empty rows, or
    // inventing "Member 1", would both be worse than saying what is missing.
    signIn();
    const identity = asCaller({
      members: [aMembershipAsTheServiceSendsIt({ role: "owner" })],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    expect(
      await within(panel).findByText(/not returning member names/i),
    ).toBeInTheDocument();
  });

  it("offers no per-member actions while there are no ids to address them with", async () => {
    signIn();
    const identity = asCaller({
      members: [aMembershipAsTheServiceSendsIt({ role: "owner" })],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    await within(panel).findByText(/not returning member names/i);

    // PATCH and DELETE members both need a userId in the path. Without one there
    // is nothing to put there, so a button here would be a button that 404s.
    expect(within(panel).queryByRole("button", { name: /remove/i })).toBeNull();
    expect(within(panel).queryByRole("combobox")).toBeNull();
  });

  it("does offer them once the service sends a member id", async () => {
    // The same panel against the shape the schema declares. Written so the day
    // identity fixes the projection, the UI that should appear is already
    // specified rather than being written from scratch under deadline.
    signIn();
    const identity = asCaller({
      role: "owner",
      members: [aMembership({ user_id: "usr_other", role: "member" })],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    expect(await within(panel).findByRole("button", { name: /remove/i })).toBeInTheDocument();
    expect(within(panel).queryByText(/not returning member names/i)).toBeNull();
  });

  it("will not offer to remove the account's last owner", async () => {
    signIn();
    const identity = asCaller({
      role: "owner",
      members: [aMembership({ user_id: CALLER_ID, role: "owner" })],
    });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    const panel = await loadedPanel();
    const remove = await within(panel).findByRole("button", { name: /remove/i });

    // An account must keep at least one owner, so the last one cannot be
    // removed. Rendering an enabled button would be offering a guaranteed 422.
    expect(remove).toBeDisabled();
  });

  it("reports a panel failure without taking the page down with it", async () => {
    signIn();
    const identity = asCaller(
      {},
      {
        listMembers: vi.fn(async () => {
          throw anIdentityError(503, "unavailable");
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    // The account's own facts are still true and still useful. A panel that
    // cannot load should cost the member list and nothing else.
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Acme Corp");
    const panel = await loadedPanel();
    expect(await within(panel).findByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Renaming
// ---------------------------------------------------------------------------

describe("renaming", () => {
  it("is not offered to a member, who would only get a 403", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "member" }) });

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("is offered to an admin", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "admin" }) });

    expect(await screen.findByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  it("sends the trimmed name", async () => {
    signIn();
    const identity = asCaller({ role: "admin" }, { renameAccount: vi.fn(async () => anAccountDetail()) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "  Acme Ltd  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() =>
      expect(identity.renameAccount).toHaveBeenCalledWith(TOKEN, ACCOUNT_ID, { name: "Acme Ltd" }),
    );
  });

  it("refuses a name the service would refuse, without asking it", async () => {
    signIn();
    const identity = asCaller({ role: "admin" }, { renameAccount: vi.fn(async () => anAccountDetail()) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText(/at least one letter or number/i)).toBeInTheDocument();
    expect(identity.renameAccount).not.toHaveBeenCalled();
  });

  it("shows the renamed name in the heading", async () => {
    signIn();
    // A stateful stub: a real service returns the new name afterwards, so a
    // `getAccount` that kept answering with the old one would be testing the
    // stub rather than the screen.
    let current = anAccountDetail({ name: "Acme Corp" });
    const identity = asCaller(
      { role: "admin" },
      {
        getAccount: vi.fn(async () => current),
        renameAccount: vi.fn(async (_token, _id, input: { name: string }) => {
          current = anAccountDetail({ name: input.name });
          return current;
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Acme Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    // `waitFor`, not `findBy`: the rename invalidates the account query, so the
    // heading still reads "Acme Corp" for a moment after the mutation resolves.
    // `findByRole` would match that stale heading on its first poll and pass the
    // assertion on the old name.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Acme Ltd"),
    );
  });

  it("explains a refusal to rename, in this app's words", async () => {
    signIn();
    const identity = asCaller(
      { role: "admin" },
      {
        renameAccount: vi.fn(async () => {
          throw anIdentityError(403, "forbidden", {
            detail: "your role in this account does not permit this action",
          });
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Acme Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    // The refusal names the reason rather than shrugging: a 403 here is about the
    // caller's role, and "try again" would be advice that cannot help.
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not allow renaming/i);
  });
});

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

describe("inviting", () => {
  // The invite form is open on arrival rather than behind a disclosure: it is
  // the main thing an admin comes to this page to do, and a form that is
  // hidden behind a button is a form half the admins never find. Renaming is the
  // opposite — rare, and it rewrites something they recognise — so that one
  // stays behind a disclosure.

  it("is not offered to a member", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "member" }) });

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Send invitation" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Invite somebody" })).toBeNull();
  });

  it("offers an admin only the member role", async () => {
    // "An admin may invite a member; only an owner may hand out admin, or an
    // admin can clone themselves into a second admin who answers to nobody."
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "admin" }) });

    const select = await screen.findByLabelText("Role");

    expect(within(select).getByRole("option", { name: "Member" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Admin" })).toBeNull();
  });

  it("offers an owner member and admin, but never owner", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "owner" }) });

    const select = await screen.findByLabelText("Role");

    expect(within(select).getByRole("option", { name: "Member" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Owner" })).toBeNull();
  });

  it("tells an admin why the admin option is missing", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "admin" }) });

    // A select with one option and no explanation reads as a bug. The service's
    // own reason is worth showing before somebody works out they cannot do it.
    expect(await screen.findByText(/only an owner can invite another admin/i)).toBeInTheDocument();
  });

  it("sends the email and the role", async () => {
    signIn();
    const identity = asCaller({}, { inviteMember: vi.fn(async () => anInvitation()) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "newcomer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() =>
      expect(identity.inviteMember).toHaveBeenCalledWith(TOKEN, ACCOUNT_ID, {
        email: "newcomer@example.com",
        role: "admin",
      }),
    );
  });

  it("shows the one-time token, because there is no other way to deliver it", async () => {
    // Until courier exists, this response is the only copy of the token that
    // will ever exist. Losing it means an invitation nobody can redeem.
    signIn();
    const identity = asCaller({}, { inviteMember: vi.fn(async () => anInvitation()) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "newcomer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    const link = await screen.findByRole("link", { name: /invitation-token-once-only/ });
    expect(link).toHaveAttribute("href", "/invitations/invitation-token-once-only");
  });

  it("warns that the link is shown once and will not come back", async () => {
    signIn();
    const identity = asCaller({}, { inviteMember: vi.fn(async () => anInvitation()) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "newcomer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText(/shown once/i)).toBeInTheDocument();
  });

  it("says when an invitation is already pending for that address", async () => {
    signIn();
    const identity = asCaller(
      {},
      {
        inviteMember: vi.fn(async () => {
          throw anIdentityError(409, "conflict", {
            detail: "there is already a pending invitation for that address on this account",
          });
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "newcomer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText(/already has a pending invitation/i)).toBeInTheDocument();
  });

  it("does not show a token when the invitation was refused", async () => {
    signIn();
    const identity = asCaller(
      {},
      {
        inviteMember: vi.fn(async () => {
          throw anIdentityError(409, "conflict");
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "newcomer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await screen.findByRole("alert");
    // Showing a link to a token that was never minted is the worst outcome here.
    expect(screen.queryByRole("link", { name: /invitations\// })).toBeNull();
  });

  it("keeps the address after a refusal, so it does not have to be retyped", async () => {
    signIn();
    const identity = asCaller(
      {},
      {
        inviteMember: vi.fn(async () => {
          throw anIdentityError(409, "conflict");
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "newcomer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Email")).toHaveValue("newcomer@example.com");
  });
});

// ---------------------------------------------------------------------------
// Leaving and deleting
// ---------------------------------------------------------------------------

describe("leaving an account", () => {
  it("is offered to a member, who knows their own id", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "member" }) });

    // The one per-member action that works today: the caller is the one member
    // whose id this client already holds, from `GET /v1/me`.
    expect(await screen.findByRole("button", { name: /leave/i })).toBeInTheDocument();
  });

  it("is not offered to an owner, who cannot remove themselves", async () => {
    // "An account must keep at least one owner", and the last one cannot change
    // their own role or be removed. Offering this to a sole owner is offering a
    // guaranteed refusal.
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "owner" }) });

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /leave/i })).toBeNull();
  });

  it("removes the caller's own membership, addressed by their own id, once confirmed", async () => {
    signIn();
    const identity = asCaller({ role: "member" }, { removeMember: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /leave/i }));

    // The confirmation. Leaving is irreversible in exactly the way deleting is:
    // the copy on this very screen says you will need a NEW INVITATION to come
    // back, so a one-click button that removes your membership with no
    // confirmation is a button that ends somebody's access to a workspace.
    expect(screen.getByRole("dialog", { name: "Leave this account?" })).toBeInTheDocument();
    expect(identity.removeMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Leave this account" }));

    await waitFor(() => expect(identity.removeMember).toHaveBeenCalledWith(TOKEN, ACCOUNT_ID, CALLER_ID));
  });

  it("does nothing when leaving is declined, which is the whole point of asking", async () => {
    signIn();
    const identity = asCaller({ role: "member" }, { removeMember: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /leave/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Focus lands on Cancel, so a person who opened the dialog and hit Escape or
    // Tab-away has not asked for anything. This is the assertion that makes the
    // confirmation a confirmation rather than a speed bump.
    expect(identity.removeMember).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("goes back to the accounts list afterwards", async () => {
    signIn();
    const identity = asCaller({ role: "member" }, { removeMember: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /leave/i }));
    fireEvent.click(screen.getByRole("button", { name: "Leave this account" }));

    // You are no longer a member, so the account you were on no longer resolves.
    // Staying put would be a page that 404s on reload.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/accounts"));
  });
});

describe("deleting an account", () => {
  it("is not offered to an admin", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "admin" }) });

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("is offered to an owner", async () => {
    signIn();
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity: asCaller({ role: "owner" }) });

    expect(await screen.findByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("asks before it deletes, because there is no undo", async () => {
    signIn();
    const identity = asCaller({ role: "owner" }, { deleteAccount: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));

    // Nothing is sent yet. Deleting an account removes everything scoped by it.
    expect(identity.deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete this account" })).toBeInTheDocument();
  });

  it("deletes once confirmed, and returns to the list", async () => {
    signIn();
    const identity = asCaller({ role: "owner" }, { deleteAccount: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this account" }));

    await waitFor(() => expect(identity.deleteAccount).toHaveBeenCalledWith(TOKEN, ACCOUNT_ID));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/accounts"));
  });

  it("does nothing when the confirmation is declined", async () => {
    signIn();
    const identity = asCaller({ role: "owner" }, { deleteAccount: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(identity.deleteAccount).not.toHaveBeenCalled();
  });

  it("stays on the page and says so when the delete is refused", async () => {
    signIn();
    const identity = asCaller(
      { role: "owner" },
      {
        deleteAccount: vi.fn(async () => {
          throw anIdentityError(403, "forbidden");
        }),
      },
    );
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/only an owner can delete/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("puts the confirmation in a named dialog, so it is a place and not a pair of buttons", async () => {
    signIn();
    const identity = asCaller({ role: "owner" }, { deleteAccount: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    // Before: no dialog at all, so the page has nothing named "delete".
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));

    // Named by the question, and it carries the consequence as its
    // description. The consequence is a screen-reader property, not a visual
    // one — a dialog whose "no undo" only exists as a paragraph is a dialog
    // that says nothing to somebody not looking at it.
    const dialog = screen.getByRole("dialog", { name: "Delete this account?" });
    expect(dialog).toHaveAccessibleDescription(
      "The account and everything scoped by it are removed. There is no undo.",
    );
  });

  it("offers the destructive action as a destructive button, not the primary one", async () => {
    signIn();
    const identity = asCaller({ role: "owner" }, { deleteAccount: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));

    // The regression this guards: the confirming button used to be
    // `variant="primary"`, so the most dangerous control on the account screen
    // carried the same visual weight as "Save name" three panels above it.
    // Asserted by asking the system whether the two are the same, rather than
    // by naming a class — the property is that they are distinguishable, and a
    // future palette is free to change what `destructive` looks like.
    const destructive = screen.getByRole("button", { name: "Delete this account" });
    const primary = await screen.findByRole("button", { name: "Rename" });
    expect(destructive.className).not.toBe(primary.className);
  });

  it("sends nothing while the dialog is open, however many times it is focused", async () => {
    signIn();
    const identity = asCaller({ role: "owner" }, { deleteAccount: vi.fn(async () => undefined) });
    renderWithProviders(<AccountScreen accountId={ACCOUNT_ID} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));

    // Focus lands on Cancel. The dangerous button is reachable and clearly
    // labelled, but a person who opened the dialog and pressed Escape has not
    // asked for anything.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })),
    );
    expect(identity.deleteAccount).not.toHaveBeenCalled();
  });
});
