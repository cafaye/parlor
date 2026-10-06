import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useNavigation: () => ({ push, refresh: vi.fn() }) }));

/**
 * `/settings` — the profile screen, version 1: only the controls that work.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TWO INSTANTS ARE A YEAR APART
 * ---------------------------------------------------------------------------
 * The badge's "Verified on" and the session panel's expiry are both rendered
 * instants, and an assertion about one has to be able to tell it from the other:
 * "the expiry is showing" would otherwise pass on a page whose only date is the
 * verified-on row, and "no time was proved" would fail on a page whose expiry is
 * perfectly correct. A year apart, so each assertion is about its own row.
 *
 * Both are at noon UTC on dates far from any year boundary, so the year renders
 * as written in every timezone CI happens to run in. An instant at 23:00 UTC
 * would render as the following day east of Greenwich, which turns an assertion
 * about a formatted time into a flake only the runner's timezone could cause.
 */

const EXPIRES_AT = "2026-03-14T12:00:00Z";
const VERIFIED_AT = "2025-06-02T12:00:00Z";

/** The two answers `GET /v1/email-verification` can give. */
const verified = (at = VERIFIED_AT) =>
  vi.fn(() => Promise.resolve({ email: "kaka@example.com", email_verified: true, email_verified_at: at }));

const unverified = () =>
  vi.fn(() => Promise.resolve({ email: "kaka@example.com", email_verified: false }));

/** The 202 the service answers for every address. */
const accepted = () => vi.fn(() => Promise.resolve({ status: "accepted" }));

function signIn(expiresAt: string | null = EXPIRES_AT) {
  createTokenStore().set("tok_abc", expiresAt);
}

/**
 * A signed-in render, with only the four capabilities this screen is allowed to
 * use scripted.
 *
 * Everything else on `stubIdentity` rejects loudly, so a control for a route the
 * forwarder refuses does not render as a dead button — it takes the whole tree
 * down with "stub identity: … was not scripted", which is the property the
 * last test in this file asserts.
 */
function renderSettings(
  identity = stubIdentity({
    me: vi.fn(() => Promise.resolve(aUser())),
    verificationStatus: unverified(),
    requestEmailVerification: accepted(),
    logout: vi.fn(() => Promise.resolve()),
  }),
  options: { expiresAt?: string | null } = {},
) {
  const { expiresAt = EXPIRES_AT } = options;
  signIn(expiresAt);
  const result = renderWithProviders(SettingsPage(), { identity });
  return { identity, ...result };
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

afterEach(cleanup);

/** Every control on the screen, in the order a person reads them. */
function controlNames() {
  return screen.getAllByRole("button").map((button) => button.textContent);
}

describe("the settings screen", () => {
  it("names itself", () => {
    renderSettings();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/settings/i);
  });

  it("asks the service about the address with the session token", async () => {
    const { identity } = renderSettings();

    await waitFor(() => expect(identity.verificationStatus).toHaveBeenCalledWith("tok_abc"));
  });

  it("gives a signed-out visitor a way in rather than an error", async () => {
    const identity = stubIdentity();
    renderWithProviders(SettingsPage(), { identity });

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    // The point of the branch: a signed-out visitor is never asked a question
    // they were not signed in to ask.
    await Promise.resolve();
    expect(identity.verificationStatus).not.toHaveBeenCalled();
  });
});

describe("the verification badge", () => {
  it("says the address is verified, and when it was proved", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: verified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    // 2025 and not 2026: the expiry panel carries a 2026 of its own, so
    // asserting a bare year here would pass whichever row rendered first.
    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it("says the address is not verified, and names no time it was proved", async () => {
    renderSettings();

    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    expect(screen.queryByText(/2025/)).not.toBeInTheDocument();
  });

  it("offers the resend only while the address is unproved", async () => {
    // The service refuses a resend for a proved address with a 409, so a control
    // shown to somebody who does not need it is a control that is guaranteed to
    // fail. Its absence is the behaviour, not a gap in the screen.
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: verified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    await screen.findByText("Verified");
    expect(screen.queryByRole("button", { name: "Resend verification email" })).not.toBeInTheDocument();
  });

  it("offers a retry when the status could not be read", async () => {
    const verificationStatus = vi
      .fn()
      .mockRejectedValueOnce(anIdentityError(503, "service_unavailable"))
      .mockResolvedValueOnce({ email: "kaka@example.com", email_verified: false });
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus,
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    expect(verificationStatus).toHaveBeenCalledTimes(2);
  });

  it("never renders the service's own words when the status fails", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: vi
          .fn()
          .mockRejectedValue(
            anIdentityError(500, "internal", { detail: "dial tcp 10.0.0.4:5432: connection refused" }),
          ),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load/i);
    expect(document.body.textContent).not.toContain("10.0.0.4");
    expect(document.body.textContent).not.toContain("5432");
  });
});

describe("the resend", () => {
  it("sends the signed-in address and nothing else", async () => {
    const { identity } = renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));

    await waitFor(() => expect(identity.requestEmailVerification).toHaveBeenCalledWith("kaka@example.com"));
  });

  it("does not submit twice on a double submit", async () => {
    // The service bounds mail at one message per address per minute, so a
    // double submit is a promise it cannot keep.
    let settle: () => void = () => {};
    const requestEmailVerification = vi.fn(
      () => new Promise<{ status: string }>((resolve) => (settle = () => resolve({ status: "accepted" }))),
    );
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification,
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    const control = await screen.findByRole("button", { name: "Resend verification email" });
    fireEvent.click(control);
    fireEvent.click(control);
    fireEvent.click(control);

    expect(requestEmailVerification).toHaveBeenCalledTimes(1);
    settle();
    await screen.findByRole("status");
  });

  it("does not claim the badge flipped when a link was sent", async () => {
    // Sending a link proves nothing about the address. A badge that flipped to
    // "Verified" the moment a mail left would be this app claiming a fact only
    // the service knows, which is the exact failure the status route exists to
    // prevent.
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/check your inbox/i);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
  });

  it("does not send somebody to their inbox when the deployment cannot send", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: vi.fn().mockRejectedValue(anIdentityError(503, "service_unavailable")),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));

    // `Service.RequestVerification` checks the mailer BEFORE it looks the address
    // up, so this failure is about the deployment and the acceptance sentence
    // would be a lie about it.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot send email/i);
    expect(alert).not.toHaveTextContent(/check your inbox/i);
  });

  it("leaves the resend usable after a failure, because retrying is the next step", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: vi.fn().mockRejectedValue(anIdentityError(503, "service_unavailable")),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "Resend verification email" })).toBeEnabled();
  });

  it("renders a network failure as one plain sentence", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: vi
          .fn()
          .mockRejectedValue(new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080")),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent(/ECONNREFUSED/);
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
  });

  it("takes the service's own 409 as the truth and re-reads the badge", async () => {
    // The one race this control has: the person proved the address in another
    // tab between this page loading and this click. The service says it is
    // proved, so the badge is re-read rather than left contradicting the note
    // printed under it.
    let proved = false;
    const verificationStatus = vi.fn(() =>
      Promise.resolve(
        proved
          ? { email: "kaka@example.com", email_verified: true, email_verified_at: EXPIRES_AT }
          : { email: "kaka@example.com", email_verified: false },
      ),
    );
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus,
        requestEmailVerification: vi.fn(() => {
          proved = true;
          return Promise.reject(anIdentityError(409, "conflict"));
        }),
        logout: vi.fn(() => Promise.resolve()),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));

    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend verification email" })).not.toBeInTheDocument();
  });
});

describe("the session panel", () => {
  it("shows when the session expires", async () => {
    renderSettings();

    expect(await screen.findByText(/2026/)).toBeInTheDocument();
    // Formatted for a reader, not dumped: the raw instant is a wire shape and a
    // person should never have to parse one.
    expect(document.body.textContent).not.toContain("2026-03-14T12:00:00Z");
  });

  it("says the expiry was not recorded rather than inventing one", async () => {
    // A session adopted before this app stored the expiry has none. "Not
    // recorded" is the truth; a blank cell would read as a bug, and a
    // reconstructed timestamp would be a claim nothing in the app can support.
    renderSettings(undefined, { expiresAt: null });

    expect(await screen.findByText("Not recorded")).toBeInTheDocument();
  });

  it("never renders an unparseable expiry as a date", async () => {
    renderSettings(undefined, { expiresAt: "not-a-date" });

    expect(await screen.findByText("Not recorded")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Invalid Date");
  });
});

describe("signing out from the profile screen", () => {
  it("revokes the stored session, forgets the token, and goes to sign in", async () => {
    const { identity } = renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(identity.logout).toHaveBeenCalledWith("tok_abc"));
    // The local half, asserted on the STORE and not on the screen: a screen that
    // merely hid its controls would pass a "signed out" query, and a reload
    // would still be signed in.
    expect(createTokenStore().get()).toBeNull();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("leaves anyway when the service refuses", async () => {
    // Somebody who asked to leave is not held hostage to a service that is
    // already down. The header makes the same call, and it is the same store.
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.reject(anIdentityError(503, "service_unavailable"))),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    // Asserted on the STORE, not on the screen, and through `waitFor` because
    // the local half happens in a `finally` inside the logout mutation rather
    // than synchronously in the click. A screen that merely hid its controls
    // would pass a "signed out" query, and a reload would still be signed in.
    await waitFor(() => expect(createTokenStore().get()).toBeNull());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("names itself the whole time it is working", async () => {
    // A control that renames itself mid-interaction loses its own label for
    // anybody navigating by name, and every other button in this app stays put.
    const logout = vi.fn(() => new Promise<void>(() => undefined));
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout,
      }),
    );

    const control = await screen.findByRole("button", { name: "Sign out" });
    fireEvent.click(control);

    await waitFor(() => expect(control).toBeDisabled());
    expect(control).toHaveAccessibleName("Sign out");
    expect(control).toHaveAttribute("aria-busy", "true");
  });
});

describe("what this screen deliberately does not have", () => {
  it("offers exactly the controls whose routes the forwarder allows", async () => {
    // Display name, other sessions, second factor, API tokens and delete-account
    // have no route in `identity` — see `REPORT-parlor-profile-01.md` §2 — so
    // they are ABSENT here rather than greyed out. A greyed control is still a
    // promise the API cannot keep, and this screen's whole claim is that every
    // control on it does something.
    renderSettings();
    await screen.findByText("Not verified");

    expect(controlNames()).toEqual(["Resend verification email", "Sign out"]);
  });

  it("says nothing about a capability it cannot reach", async () => {
    renderSettings();
    await screen.findByText("Not verified");

    for (const absent of [/display name/i, /second factor/i, /api (key|token)/i, /delete/i, /other sessions?/i]) {
      expect(document.body.textContent).not.toMatch(absent);
    }
  });
});