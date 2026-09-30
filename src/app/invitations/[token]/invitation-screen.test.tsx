import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvitationScreen } from "./invitation-screen";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { aMembership } from "@/test/support/tenancy";
import { renderWithProviders } from "@/test/support/render";

/**
 * `/invitations/[token]` — redeeming an invitation.
 *
 * The status codes are the whole design here. `writeTenancyError` in identity's
 * handler maps three different situations onto three different answers, and
 * they must not be flattened:
 *
 *   404  no invitation matches that token — a wrong token, and no more than
 *        that. The same answer an invitation that was never created gets, which
 *        is what makes a guessed token useless.
 *   410  gone. The service uses this for BOTH "expired" and "already accepted",
 *        under the same `gone` code, distinguished only by prose in `detail`.
 *        So there are exactly two states here, not three: "unrecognised" and
 *        "no longer usable", both grounded in the status rather than in parsing
 *        an English sentence out of the body.
 *   409  you are already a member of this account — the state the caller asked
 *        for already holds, which is a different thing from a bad token.
 *
 * Two things this page must never do:
 *
 *   - Accept on load. Redeeming an invitation adds the caller to an account. It
 *     is a mutation with a consequence, so it waits for a deliberate click.
 *   - Say why a 410 happened. `detail` is where service internals live, and it
 *     is not a stable contract anyway.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const TOKEN = "tok_abc";
const INVITATION = "invitation-token-once-only";
const ACCOUNT_ID = "acc_0a1b2c3d";

function signIn() {
  createTokenStore().set(TOKEN);
}

function signedIn(overrides = {}) {
  return stubIdentity({ me: vi.fn(async () => aUser()), ...overrides });
}

/** An `IdentityError` shaped as `writeTenancyError` would send it. */
function failure(status: number, code: string, detail: string) {
  return anIdentityError(status, code, { detail });
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

describe("an invitation that has not been redeemed", () => {
  it("says the person has been invited, before they accept", async () => {
    signIn();
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity: signedIn() });

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/invited/i);
  });

  it("says it cannot show which account this is, rather than implying it knows", async () => {
    // There is no `GET /v1/invitations/{token}` on the service, so the account
    // name, the inviter and the role are all unknowable until after the accept.
    // A page that just said "Accept" would be asking somebody to join a
    // workspace on the strength of a link with no indication of what it is.
    signIn();
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity: signedIn() });

    expect(await screen.findByText(/cannot show you which account/i)).toBeInTheDocument();
  });

  it("does not accept on load, because joining an account is a consequence", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => aMembership({ account_id: ACCOUNT_ID })),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    await screen.findByRole("button", { name: /accept/i });

    // Rendering the page is not consenting to it. An auto-accepting page means
    // a link in an email preview, a chat client, or a scanner joins somebody to
    // a workspace they never opened.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identity.acceptInvitation).not.toHaveBeenCalled();
  });

  it("sends the caller's session token and the invitation token", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => aMembership({ account_id: ACCOUNT_ID })),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    await waitFor(() =>
      expect(identity.acceptInvitation).toHaveBeenCalledWith(TOKEN, { token: INVITATION }),
    );
  });

  it("does not claim to know the role before accepting, because it cannot", async () => {
    // `membershipResponse.role` is what they are about to become, and it only
    // arrives in the accept *response*. So the page must not put a role on
    // screen first — the role it shows is the one they ended up with.
    signIn();
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity: signedIn() });

    await screen.findByRole("button", { name: /accept/i });
    expect(screen.queryByText(/you will join as/i)).toBeNull();
  });

  it("shows the role they ended up with, once accepted", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => aMembership({ account_id: ACCOUNT_ID, role: "admin" })),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    expect(await screen.findByText(/admin/i)).toBeInTheDocument();
  });

  it("links to the account they joined, which they can now see", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => aMembership({ account_id: ACCOUNT_ID })),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    expect(await screen.findByRole("link", { name: /open the account|go to the account/i })).toHaveAttribute(
      "href",
      `/accounts/${ACCOUNT_ID}`,
    );
  });

  it("marks the button busy without renaming it", async () => {
    signIn();
    let settle: (value: ReturnType<typeof aMembership>) => void = () => {};
    const promise = new Promise<ReturnType<typeof aMembership>>((resolve) => {
      settle = resolve;
    });
    const identity = signedIn({ acceptInvitation: vi.fn(() => promise) });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    const button = await screen.findByRole("button", { name: /accept/i });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeDisabled();

    settle(aMembership({ account_id: ACCOUNT_ID }));
  });

  it("does not offer to accept twice", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => aMembership({ account_id: ACCOUNT_ID })),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await screen.findByRole("link", { name: /open the account|go to the account/i });

    // The token is spent. Offering the button again would be offering a 410.
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });
});

describe("an invitation that is not recognised", () => {
  // 404, code not_found: "no invitation matches that token". The same answer an
  // invitation that never existed gets, which is the point.
  it("says the invitation is not recognised", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(404, "not_found", "no invitation matches that token");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    expect(await screen.findByRole("heading", { name: /not recognised|not found/i })).toBeInTheDocument();
  });

  it("does not say the invitation expired, which would tell them it once existed", async () => {
    // A 404 is deliberately indistinguishable from a token that was never
    // issued. Saying "expired" would confirm the token was real once, which
    // turns a guess into a probe.
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(404, "not_found", "no invitation matches that token");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await screen.findByRole("heading", { name: /not recognised|not found/i });

    expect(screen.queryByText(/expired/i)).toBeNull();
  });

  it("offers a way to the accounts they can already see", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(404, "not_found", "no invitation matches that token");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await screen.findByRole("heading", { name: /not recognised|not found/i });

    expect(screen.getByRole("link", { name: /your accounts/i })).toHaveAttribute("href", "/accounts");
  });
});

describe("an invitation that can no longer be used", () => {
  // 410, code gone. The service uses this for expired AND for already-accepted,
  // under the same code, so this page renders one state for both. Splitting them
  // would mean parsing an English sentence out of `detail`, which is exactly the
  // unstable string this app never renders.
  it("says it can no longer be used, and to ask for a new one", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(410, "gone", "this invitation has expired; ask for a new one");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    expect(
      await screen.findByRole("heading", { name: /no longer|expired|used/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask .* for a new one|ask somebody/i)).toBeInTheDocument();
  });

  it("is a different state from an unrecognised token", async () => {
    signIn();
    const expired = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(410, "gone", "this invitation has expired");
      }),
    });
    const { unmount } = renderWithProviders(<InvitationScreen token={INVITATION} />, {
      identity: expired,
    });
    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    const goneHeading = await screen.findByRole("heading", { name: /no longer|expired|used/i });
    const goneText = goneHeading.textContent;
    unmount();

    const unknown = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(404, "not_found", "no invitation matches that token");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity: unknown });
    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    const notFound = await screen.findByRole("heading", { name: /not recognised|not found/i });

    // The brief for this packet asked for a real expired state, honoured from
    // the status codes. This is the assertion that it is a *distinct* state and
    // not the 404 wearing a different sentence.
    expect(goneText).not.toBe(notFound.textContent);
  });

  it("still says the right thing when the invitation was already accepted", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(410, "gone", "this invitation has already been accepted");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    // The advice is the same either way — ask for a new one — so the same
    // sentence is honest for both, and the service's own wording is not used.
    expect(await screen.findByText(/ask .* for a new one|ask somebody/i)).toBeInTheDocument();
    expect(screen.queryByText(/already been accepted/i)).toBeNull();
  });

  it("does not repeat the service's own reason", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(410, "gone", "token digest 9f8e7d6c is not redeemable");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await screen.findByRole("heading", { name: /no longer|expired|used/i });

    expect(screen.queryByText(/9f8e7d6c/)).toBeNull();
  });
});

describe("an invitation for an account you are already in", () => {
  it("says so, which is not the same as a bad token", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(409, "conflict", "you are already a member of this account");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    // The state the caller asked for already holds, so the right advice is to go
    // and look at the account, not to ask for a new invitation.
    expect(await screen.findByText(/already a member/i)).toBeInTheDocument();
    expect(screen.queryByText(/ask .* for a new one/i)).toBeNull();
  });

  it("offers no retry, because retrying gets the same 409", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(409, "conflict", "you are already a member of this account");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await screen.findByText(/already a member/i);

    // Unlike a 503, a retry here is guaranteed to fail. The button is for the
    // recoverable failures and this is not one.
    expect(screen.queryByRole("button", { name: /accept|try again/i })).toBeNull();
  });
});

describe("when the service is down", () => {
  it("says it could not find out, and offers to try again", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(503, "unavailable", "identity is not accepting requests");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    // "We could not find out" and "it is not valid" are different sentences for
    // a reason: one is worth retrying and the other is not.
    expect(await screen.findByText(/could not/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("asks again when the retry is used", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi
        .fn()
        .mockRejectedValueOnce(failure(503, "unavailable", "down"))
        .mockResolvedValueOnce(aMembership({ account_id: ACCOUNT_ID })),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(identity.acceptInvitation).toHaveBeenCalledTimes(2));
  });

  it("does not tell anybody their invitation is no good, because we did not find out", async () => {
    signIn();
    const identity = signedIn({
      acceptInvitation: vi.fn(async () => {
        throw failure(500, "internal", "pq: connection reset by peer");
      }),
    });
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await screen.findByRole("alert");

    // Telling somebody their invitation is dead when the service is down sends
    // them to ask for another one they do not need.
    expect(screen.queryByText(/no longer|expired|not recognised/i)).toBeNull();
    expect(screen.queryByText(/connection reset/)).toBeNull();
  });
});

describe("when nobody is signed in", () => {
  it("asks them to sign in, because the membership would be theirs", async () => {
    // "The caller still has to be authenticated, because the membership created
    // belongs to them." Accepting while signed out is not possible, and the
    // screen must not pretend the button works.
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity: stubIdentity() });

    expect(await screen.findByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("does not ask the service to accept anything", () => {
    const identity = stubIdentity();
    renderWithProviders(<InvitationScreen token={INVITATION} />, { identity });

    expect(identity.acceptInvitation).not.toHaveBeenCalled();
  });
});
