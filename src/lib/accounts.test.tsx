/**
 * Cross-tenant negative tests for the account cache.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * `parlor` has no database. There is no SQL in this repository, no ORM, no query
 * builder and no migration; `identity` and `billing` hold the rows and `parlor`
 * calls them over HTTP. So the question `anywaye/notes/debt.md` D18 asks — "can account A read
 * account B's data" — cannot be answered here in the form it is answered in
 * `identity`, where a transaction and a real row decide it. What it CAN be
 * answered here is the half of the question this repository owns:
 *
 *   `parlor` holds account-scoped rows in exactly one place, and it is this
 *   process. The React Query cache under `["account", …]` and
 *   ["account-members", …]` holds an account's name, its slug, its creation
 *   time, the caller's role in it and its member list, in memory, for as long
 *   as the tab is open. A cross-tenant read needs no service bug at all: drop
 *   one component of a cache key and account A's rows are rendered under
 *   account B's URL, or under the next person's session, with every request to
 *   `identity` still correct.
 *
 * That is why these tests are here and not only in `upstream.test.ts`. The
 * forwarder tests prove the wire is honest; these prove the cache is.
 *
 * ---------------------------------------------------------------------------
 * HOW A CROSS-TENANT READ HAPPENS HERE, WHICH IS WHAT MAKES THESE NEGATIVE
 * ---------------------------------------------------------------------------
 * Not by a service answering wrongly — by a cache key colliding. Two keys, two
 * scopes:
 *
 *   * `accountId` missing from the key. A caller who is a member of both Acme
 *     and Globex opens Acme, then Globex. With `staleTime: Infinity` the second
 *     render finds a cache hit, issues no request, and paints Acme's name,
 *     slug and member list under Globex's URL.
 *   * `token` missing from the key. One person signs out and another signs in on
 *     the same browser. The second session's request for an account it may not
 *     see is answered from the first session's cache instead of from the
 *     service's refusal, so a 404 never reaches the screen and the rows do.
 *
 * Both arms assert the REFUSAL reaches the screen, not merely that the right
 * name is on it. "B's name is showing" passes just as happily against a cache
 * that never refetched, and "A's name is not showing" passes against a screen
 * that rendered a spinner. The negative assertion here is that the second
 * session is shown what the service said, which is a 404.
 */

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountScreen } from "@/app/accounts/[accountId]/account-screen";
import { accountKey, accountsKey, membersKey, useAccounts } from "@/lib/accounts";
import { createTokenStore, type TokenStore } from "@/lib/token-store";
import type { MemberList } from "@/lib/identity";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { anAccountDetail, anAccountListItem, aMembershipAsTheServiceSendsIt } from "@/test/support/tenancy";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useNavigation: () => ({ push, refresh: vi.fn() }) }));

/**
 * Two accounts and two sessions, both real.
 *
 * Acme is `ACCOUNT_A`, Globex is `ACCOUNT_B`, and ALICE and BOB each belong to
 * one of them and not the other — which is the state every negative arm needs:
 * a second account to collide with, and a second caller who is genuinely not a
 * member, so the service's answer is a refusal rather than a coincidence.
 */
const TOKEN_A = "tok_alice";
const TOKEN_B = "tok_bob";
const ACCOUNT_A = "acc_0a1b2c3d";
const ACCOUNT_B = "acc_9z8y7x6w";

const ALICE = aUser({ id: "usr_alice", email: "alice@example.com" });
const BOB = aUser({ id: "usr_bob", email: "bob@example.com" });

/**
 * The two member panels.
 *
 * Typed as `MemberList` rather than read off the detail fixtures: the detail
 * response declares `members` optional while the panel is a required
 * `Membership[]`, and deriving one from the other produces a type that is
 * `Membership[] | undefined` where the client wants a list.
 */
const ACME_MEMBERS: MemberList = {
  memberships: [aMembershipAsTheServiceSendsIt({ role: "owner" })],
  role: "owner",
};

/** Globex's panel: no owner row at all, which is what makes it distinguishable. */
const GLOBEX_MEMBERS: MemberList = {
  memberships: [aMembershipAsTheServiceSendsIt({ role: "member" })],
  role: "member",
};

/** Acme, as Alice sees it. */
const ACME = anAccountDetail({
  id: ACCOUNT_A,
  name: "Acme Corp",
  slug: "acme-corp",
  role: "owner",
  members: ACME_MEMBERS.memberships,
});

/** Globex, as Alice sees it. Distinct in every field a screen renders. */
const GLOBEX = anAccountDetail({
  id: ACCOUNT_B,
  name: "Globex",
  slug: "globex",
  role: "member",
  members: GLOBEX_MEMBERS.memberships,
});

/**
 * The service, as it actually behaves: it scopes by the token, so Alice's
 * session sees both of her accounts and Bob's session sees neither.
 *
 * Scripted from the `(token, accountId)` a client call carries, because those
 * two arguments are the whole of the tenancy decision and a stub that answers
 * the same thing for everything would make every test below vacuous.
 *
 * The refusal for Bob is 404, not 403, because that is what `identity` does on
 * purpose: the same status and the same sentence for "no such account" and "an
 * account you are not a member of", so a guessed id cannot be used to find out
 * which accounts exist. See `account-screen.tsx` and `NotVisible`.
 */
function service() {
  return stubIdentity({
    me: vi.fn((token: string) => Promise.resolve(token === TOKEN_A ? ALICE : BOB)),
    listAccounts: vi.fn((token: string) =>
      Promise.resolve(
        token === TOKEN_A
          ? [
              anAccountListItem({ id: ACCOUNT_A, name: "Acme Corp", slug: "acme-corp" }),
              anAccountListItem({ id: ACCOUNT_B, name: "Globex", slug: "globex", role: "member" }),
            ]
          : [],
      ),
    ),
    // NOT `async`: these read their arguments to decide the answer, so the
    // promise has to be produced by an explicit `Promise.resolve` /
    // `Promise.reject` at each exit rather than by the keyword — which is what
    // `@typescript-eslint/require-await` asks for when there is no `await`.
    // `Promise.reject` and not a bare `throw` because a caller awaiting this
    // mock has to see a rejection, which is what the keyword used to give it.
    getAccount: vi.fn((token: string, accountId: string) => {
      if (token !== TOKEN_A) return Promise.reject(anIdentityError(404, "not_found"));
      if (accountId === ACCOUNT_A) return Promise.resolve(ACME);
      if (accountId === ACCOUNT_B) return Promise.resolve(GLOBEX);
      return Promise.reject(anIdentityError(404, "not_found"));
    }),
    listMembers: vi.fn((token: string, accountId: string): Promise<MemberList> => {
      if (token !== TOKEN_A) return Promise.reject(anIdentityError(404, "not_found"));
      if (accountId === ACCOUNT_A) return Promise.resolve(ACME_MEMBERS);
      if (accountId === ACCOUNT_B) return Promise.resolve(GLOBEX_MEMBERS);
      return Promise.reject(anIdentityError(404, "not_found"));
    }),
  });
}

/** A store this test owns, so a sign-out can be written without a re-render. */
function storeWith(token: string): TokenStore {
  const store = createTokenStore();
  store.set(token);
  return store;
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

// ---------------------------------------------------------------------------
// 1. The keys, as values.
//
// Four assertions and no rendering, because the key is where the boundary is
// written down and every other test in this file is downstream of it. These are
// the "missing bind parameter" and "missing WHERE" arms in the only store this
// repository owns: `accountId` is the WHERE, `token` is the bind parameter, and
// a key that loses either one is a cross-tenant read waiting for a tab.
// ---------------------------------------------------------------------------

describe("the account cache keys", () => {
  it("are different for two accounts in one session", () => {
    // The accountId arm. Colliding these is how Acme's rows get painted under
    // Globex's URL.
    expect(accountKey(TOKEN_A, ACCOUNT_A)).not.toEqual(accountKey(TOKEN_A, ACCOUNT_B));
  });

  it("are different for two sessions in one account", () => {
    // The token arm. Colliding these is how one person's browser shows the
    // previous person's accounts to whoever signs in next.
    expect(accountKey(TOKEN_A, ACCOUNT_A)).not.toEqual(accountKey(TOKEN_B, ACCOUNT_A));
  });

  it("are different for the member list and the account itself", () => {
    // A member list cached under the account's own key would be served in place
    // of the account's facts — a different shape under a name a screen trusts.
    expect(membersKey(TOKEN_A, ACCOUNT_A)).not.toEqual(accountKey(TOKEN_A, ACCOUNT_A));
  });

  it("keep the token and the account id in the list key too", () => {
    // `useAccounts` is the one tenancy read with no `:accountId` segment: it is
    // scoped by the token alone, so the token is the entire boundary and there
    // is nothing else in the key to lean on.
    expect(accountsKey(TOKEN_A)).not.toEqual(accountsKey(TOKEN_B));
    expect(accountsKey(TOKEN_A)).not.toEqual(accountKey(TOKEN_A, ACCOUNT_A));
  });
});

// ---------------------------------------------------------------------------
// 2. One account's page does not show another account's rows.
//
// The rendered form of the first arm. One tree, one `QueryClient`, one token:
// render Acme, then rerender the SAME tree as Globex, which is what a click on
// "Globex" in the account list does. Same cache by construction — that is the
// point.
// ---------------------------------------------------------------------------

describe("navigating between two accounts in one session", () => {
  it("does not paint the first account's name on the second account's page", async () => {
    const identity = service();
    const { rerender } = renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, {
      identity,
      tokens: storeWith(TOKEN_A),
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Acme Corp" })).toBeInTheDocument();

    rerender(<AccountScreen accountId={ACCOUNT_B} />);

    // Globex, and NOT Acme. The `not` is the assertion; the positive one only
    // says the screen eventually showed the account it was asked for.
    expect(await screen.findByRole("heading", { level: 1, name: "Globex" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Acme Corp" })).not.toBeInTheDocument();
  });

  it("does not keep the first account's slug, role or handle on the second", async () => {
    const identity = service();
    const { rerender } = renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, {
      identity,
      tokens: storeWith(TOKEN_A),
    });

    // The slug is the account's stable handle and never changes, so a leaked
    // slug is the clearest possible tell that the wrong account is on screen:
    // no rename could have produced it.
    expect(await screen.findByText("acme-corp")).toBeInTheDocument();

    rerender(<AccountScreen accountId={ACCOUNT_B} />);

    expect(await screen.findByText("globex")).toBeInTheDocument();
    expect(screen.queryByText("acme-corp")).not.toBeInTheDocument();
  });

  it("asks the service for the second account rather than reading the cache", async () => {
    const identity = service();
    const { rerender } = renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, {
      identity,
      tokens: storeWith(TOKEN_A),
    });

    await screen.findByRole("heading", { level: 1, name: "Acme Corp" });
    rerender(<AccountScreen accountId={ACCOUNT_B} />);
    await screen.findByRole("heading", { level: 1, name: "Globex" });

    // `staleTime: Infinity` means a cache hit issues NO request. So a collision
    // in the key cannot be repaired by a refetch: the second account is served
    // from the first one's entry and no amount of correct forwarding fixes it.
    // This assertion is what makes the two above meaningful — it is the
    // mechanism, they are the symptom. And it is one call per account, so a
    // second render that issued none is the collision, not a retry.
    await waitFor(() =>
      expect(identity.getAccount).toHaveBeenCalledWith(TOKEN_A, ACCOUNT_B),
    );
    expect(identity.getAccount.mock.calls).toHaveLength(2);
  });

  it("does not carry the first account's member list into the second", async () => {
    const identity = service();
    const { rerender } = renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, {
      identity,
      tokens: storeWith(TOKEN_A),
    });

    // Acme's panel: one owner. The role counts are the only member information
    // the service sends today, so they are the thing a collision would swap.
    expect(await screen.findByText("Total")).toBeInTheDocument();
    await waitFor(() => expect(identity.listMembers).toHaveBeenCalledWith(TOKEN_A, ACCOUNT_A));

    rerender(<AccountScreen accountId={ACCOUNT_B} />);

    await waitFor(() =>
      expect(identity.listMembers).toHaveBeenCalledWith(TOKEN_A, ACCOUNT_B),
    );
    // Once Globex's panel is up, Acme's owner row must be gone. The screen
    // renders "Owners" for a panel that has one, so its presence means the
    // first account's member list is still on the page.
    await waitFor(() => expect(screen.queryByText("Owners")).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// 3. One session never sees another's accounts.
//
// The token arm, rendered. Alice signs in, opens Acme. Bob signs in on the same
// browser. Bob is not a member of Acme, so `identity` answers 404 — and the
// assertion is that the SCREEN shows that 404 rather than Alice's cached rows.
//
// The service stub is the evidence that this is a real refusal and not a
// convenience: `getAccount` throws 404 for anything that is not `TOKEN_A`, and
// the test passes on what the screen rendered rather than on what the stub was
// handed.
// ---------------------------------------------------------------------------

describe("a second session signing in on the same browser", () => {
  it("is refused an account the first session was reading, rather than served its rows", async () => {
    const identity = service();
    const store = storeWith(TOKEN_A);

    renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, { identity, tokens: store });

    // Alice's rows really are in the cache at this point. Without this the
    // second half of the test would pass on an empty cache, which proves
    // nothing — the test would be asserting that a blank screen is blank.
    expect(await screen.findByRole("heading", { level: 1, name: "Acme Corp" })).toBeInTheDocument();

    store.set(TOKEN_B);

    // Bob's own session resolves, and then Acme is refused. The sentence names
    // neither whether the account exists nor that Bob is not a member, which is
    // `identity`'s decision and this screen's obligation.
    expect(await screen.findByRole("heading", { level: 1, name: "Account not found" })).toBeInTheDocument();
    expect(screen.getByText("We could not find that account.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Acme Corp" })).not.toBeInTheDocument();
    // The refusal is not dressed as a load failure: a retry button on a 404 is
    // a person being told to try again for something that will never answer.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("does not leave the first session's member rows on the page it refuses", async () => {
    const identity = service();
    const store = storeWith(TOKEN_A);

    renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, { identity, tokens: store });
    expect(await screen.findByRole("heading", { level: 1, name: "Acme Corp" })).toBeInTheDocument();
    await waitFor(() => expect(identity.listMembers).toHaveBeenCalledWith(TOKEN_A, ACCOUNT_A));
    // Alice's panel really is on the page: an owner row and the role
    // distribution that goes with it. Both are account-scoped rows held in this
    // process, and both are what a stale cache would carry to the next session.
    expect(await screen.findByText("Owners")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();

    store.set(TOKEN_B);

    // The screen refuses the ACCOUNT before it renders anything else, so the
    // whole page — facts, header and member panel together — is replaced by the
    // one refusal. That is why this asserts absence rather than a message in
    // the panel: `AccountScreen` returns `NotVisible` before `MembersPanel` is
    // ever reached, and there is no state in which Alice's rows and Bob's
    // refusal are on the screen together.
    expect(await screen.findByRole("heading", { level: 1, name: "Account not found" })).toBeInTheDocument();
    expect(screen.queryByText("Owners")).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText("acme-corp")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Members" })).not.toBeInTheDocument();
  });

  it("never asks for the member list of an account the session cannot see", async () => {
    const identity = service();
    const store = storeWith(TOKEN_A);

    renderWithProviders(<AccountScreen accountId={ACCOUNT_A} />, { identity, tokens: store });
    await screen.findByRole("heading", { level: 1, name: "Acme Corp" });
    await waitFor(() => expect(identity.listMembers).toHaveBeenCalledTimes(1));

    store.set(TOKEN_B);
    await screen.findByRole("heading", { level: 1, name: "Account not found" });

    // One call in the whole test, and it is Alice's. A panel query scoped by
    // `accountId` alone rather than by `accountId` AND `token` would fire here
    // with Bob's token and get a 404 — which is harmless to the browser but
    // tells the upstream that the id exists, because a 404 for a real account
    // you are not in and a 404 for a nonsense id are the same answer only
    // because `identity` declines to tell the difference. Nothing here should
    // be probing for it.
    expect(identity.listMembers).toHaveBeenCalledTimes(1);
    expect(identity.listMembers).toHaveBeenCalledWith(TOKEN_A, ACCOUNT_A);
  });

  it("does not see the first session's account list", async () => {
    // The list is the one tenancy read with no `:accountId` in its path, so the
    // token is the whole of its boundary and there is nothing else in the key to
    // catch a collision. `listAccounts` returns Bob nothing, and what must reach
    // the screen is that nothing.
    const identity = service();
    const store = storeWith(TOKEN_A);

    function Probe() {
      const accounts = useAccounts();
      if (accounts.isPending) return <p>loading</p>;
      if (accounts.isError) return <p>failed</p>;
      return (
        <ul aria-label="accounts">
          {accounts.data.map((account) => (
            <li key={account.id}>{account.name}</li>
          ))}
        </ul>
      );
    }

    renderWithProviders(<Probe />, { identity, tokens: store });

    const list = await screen.findByRole("list", { name: "accounts" });
    expect(list).toHaveTextContent("Acme Corp");
    expect(list).toHaveTextContent("Globex");

    store.set(TOKEN_B);

    await waitFor(() => expect(identity.listAccounts).toHaveBeenCalledWith(TOKEN_B));
    await waitFor(() => expect(screen.getByRole("list", { name: "accounts" })).toBeEmptyDOMElement());
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
    expect(screen.queryByText("Globex")).not.toBeInTheDocument();
  });
});
