import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";
import type { SessionSummary, User } from "@/lib/identity";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useNavigation: () => ({ push, refresh: vi.fn() }) }));

/**
 * `/settings` — the profile screen, version 2: the controls identity grew.
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

/**
 * One session row, as `GET /v1/sessions` answers it.
 *
 * The current session by default, because that is the ordinary answer: the
 * session the request arrived on is in the list, and a screen that marks one
 * row "This device" is the screen this panel is.
 */
const aSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  created_at: "2026-09-30T09:14:02Z",
  expires_at: "2026-10-30T09:14:02Z",
  user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  ip: "203.0.113.7",
  current: true,
  ...overrides,
});

function signIn(expiresAt: string | null = EXPIRES_AT) {
  createTokenStore().set("tok_abc", expiresAt);
}

/**
 * A signed-in render, with every capability this screen is allowed to use
 * scripted.
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
    updateMyDisplayName: vi.fn(() =>
      Promise.resolve(aUser({ display_name: "Kaka" })),
    ),
    listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
    revokeSession: vi.fn(() => Promise.resolve()),
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
        listSessions: vi.fn(() => Promise.resolve({ sessions: [] })),
        revokeSession: vi.fn(() => Promise.resolve()),
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
        listSessions: vi.fn(() => Promise.resolve({ sessions: [] })),
        revokeSession: vi.fn(() => Promise.resolve()),
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

describe("the display name panel", () => {
  it("shows the current name pre-filled, with Clear name offered while one is set", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka" }))),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Kaka");
    expect(screen.getByRole("button", { name: "Clear name" })).toBeInTheDocument();
  });

  it("shows an empty input and no Clear name when no name is set", async () => {
    renderSettings();
    await screen.findByText("Not verified");

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear name" })).not.toBeInTheDocument();
  });

  it("disables Save name while the input is unchanged, so a commit is never a no-op", async () => {
    // The route has no "leave it unchanged" to express — an omitted field and
    // an empty string are the same request — so a Save that could be pressed
    // without effect would be offering a third answer the API does not have.
    renderSettings();
    await screen.findByText("Not verified");

    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
  });

  it("commits the new name and confirms the write", async () => {
    const { identity } = renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        updateMyDisplayName: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka 2" }))),
      }),
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
      target: { value: "Kaka 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() =>
      expect(identity.updateMyDisplayName).toHaveBeenCalledWith("tok_abc", { display_name: "Kaka 2" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/name was saved/i);
    // The input shows the value the response carried, not the one that was
    // typed: the 200 is the answer, and a screen that kept the typed value
    // would be asserting a fact the service had not confirmed.
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Kaka 2");
  });

  it("clears the name through the explicit Clear name button", async () => {
    const { identity } = renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka" }))),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        updateMyDisplayName: vi.fn(() => Promise.resolve(aUser())),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clear name" }));

    await waitFor(() =>
      expect(identity.updateMyDisplayName).toHaveBeenCalledWith("tok_abc", { display_name: "" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/name was cleared/i);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });

  it("does not offer Save on an empty input while a name is set", async () => {
    // The set-or-clear surprise this panel exists to prevent: select-all,
    // delete, save — expecting nothing to happen, and the name is gone. With a
    // name set, an empty input is not a saveable state; Clear name is the one
    // way in, and it is named.
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka" }))),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    const input = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear name" })).toBeEnabled();
  });

  it("renders a 422 on the field inline, where the person can see why", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka" }))),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        updateMyDisplayName: vi.fn(() =>
          Promise.reject(
            anIdentityError(422, "validation_failed", {
              fieldErrors: [{ field: "display_name", code: "too_long" }],
            }),
          ),
        ),
      }),
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
      target: { value: "Kaka 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    const input = await screen.findByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/display name is too long/i)).toBeInTheDocument();
  });

  it("renders a network failure as one plain sentence", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka" }))),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        updateMyDisplayName: vi
          .fn()
          .mockRejectedValue(new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080")),
      }),
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
      target: { value: "Kaka 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent(/ECONNREFUSED/);
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
  });

  it("does not submit twice on a double submit", async () => {
    let settle: () => void = () => {};
    const updateMyDisplayName = vi.fn(
      () => new Promise<User>((resolve) => (settle = () => resolve(aUser({ display_name: "Kaka 2" })))),
    );
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser({ display_name: "Kaka" }))),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        updateMyDisplayName,
      }),
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
      target: { value: "Kaka 2" },
    });
    const save = screen.getByRole("button", { name: "Save name" });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    expect(updateMyDisplayName).toHaveBeenCalledTimes(1);
    settle();
    await screen.findByRole("status");
  });
});

describe("the sessions panel", () => {
  it("lists the sessions with the facts a person recognises", async () => {
    renderSettings();
    await screen.findByText("Not verified");

    // The user agent raw and unparsed, the address as recorded at sign-in, and
    // both instants formatted for a reader — the four things the service says
    // are enough to recognise a row.
    expect(await screen.findByText("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBeInTheDocument();
    expect(screen.getByText(/203\.0\.113\.7/)).toBeInTheDocument();
    expect(screen.getByText(/Started/)).toBeInTheDocument();
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
    // The raw instants are wire shapes and a person should never parse one.
    expect(document.body.textContent).not.toContain("2026-09-30T09:14:02Z");
  });

  it("marks the current session and leaves the others unmarked", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() =>
          Promise.resolve({
            sessions: [
              aSession({ current: true }),
              aSession({
                id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1)",
                ip: "198.51.100.22",
                current: false,
              }),
            ],
          }),
        ),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    expect(await screen.findByText("This device")).toBeInTheDocument();
    // One badge, not two: `current` is the one field a client cannot compute
    // for itself, and a screen that marked every row would be guessing.
    expect(screen.getAllByText("This device")).toHaveLength(1);
  });

  it("renders an empty user agent as unknown rather than blank", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession({ user_agent: "" })] })),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    expect(await screen.findByText("Unknown device")).toBeInTheDocument();
  });

  it("shows a loading state rather than an empty panel", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: () => new Promise(() => undefined),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    expect(await screen.findByText(/loading your sessions/i)).toBeInTheDocument();
  });

  it("offers a retry when the list could not be read", async () => {
    const listSessions = vi
      .fn()
      .mockRejectedValueOnce(anIdentityError(503, "service_unavailable"))
      .mockResolvedValueOnce({ sessions: [aSession()] });
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions,
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("This device")).toBeInTheDocument();
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it("never renders the service's own words when the list fails", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi
          .fn()
          .mockRejectedValue(
            anIdentityError(500, "internal", { detail: "dial tcp 10.0.0.4:5432: connection refused" }),
          ),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load your sessions/i);
    expect(document.body.textContent).not.toContain("10.0.0.4");
    expect(document.body.textContent).not.toContain("5432");
  });

  it("says the list is empty rather than failing", async () => {
    // `[]` and never `null`, and it is a fine answer rather than an error.
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [] })),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    expect(await screen.findByText("No active sessions")).toBeInTheDocument();
  });

  it("revokes a session by its id and removes the row", async () => {
    const { identity } = renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() =>
          Promise.resolve({
            sessions: [
              aSession({ current: true }),
              aSession({
                id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1)",
                ip: "198.51.100.22",
                current: false,
              }),
            ],
          }),
        ),
        revokeSession: vi.fn(() => Promise.resolve()),
      }),
    );

    // The second row's Revoke — the non-current session.
    const revoke = await screen.findAllByRole("button", { name: "Revoke" });
    fireEvent.click(revoke[1]);

    await waitFor(() =>
      expect(identity.revokeSession).toHaveBeenCalledWith("tok_abc", "7c9e6679-7425-40de-944b-e07fc1f90ae7"),
    );
    // The row leaves with the click that revoked it, and the current session
    // stays — a revoke is one session, not "sign out everywhere".
    expect(screen.queryByText("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1)")).not.toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("revoking the current session forgets the token and goes to sign in", async () => {
    // The service allows revoking the session you are using, and the 204 sets
    // no `Set-Cookie` — so the browser keeps a credential that is now dead.
    // The login flow's answer to a dead session is to forget the token; this
    // is the same case reached by a different route.
    const { identity } = renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(identity.revokeSession).toHaveBeenCalledWith("tok_abc", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
    // Asserted on the STORE, not on the screen: a screen that merely hid its
    // controls would pass a "signed out" query, and a reload would still be
    // signed in.
    await waitFor(() => expect(createTokenStore().get()).toBeNull());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("keeps the row when the revoke is refused, because the session is still alive", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.reject(anIdentityError(404, "not_found"))),
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not end that session/i);
    // A control that disappeared on a failure would be claiming an end it did
    // not achieve.
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("does not revoke twice on a double submit", async () => {
    let settle: () => void = () => {};
    const revokeSession = vi.fn(
      () => new Promise<void>((resolve) => (settle = () => resolve())),
    );
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession,
      }),
    );

    const revoke = await screen.findByRole("button", { name: "Revoke" });
    fireEvent.click(revoke);
    fireEvent.click(revoke);
    fireEvent.click(revoke);

    expect(revokeSession).toHaveBeenCalledTimes(1);
    settle();
    await waitFor(() => expect(screen.queryByText("This device")).not.toBeInTheDocument());
  });
});

describe("what this screen deliberately does not have", () => {
  it("offers exactly the controls whose routes the forwarder allows", async () => {
    // Second factor and API tokens have no route this app can reach — see
    // `REPORT-parlor-profile-v2-01.md` §3 — so they are ABSENT here rather than
    // greyed out. A greyed control is still a promise the API cannot keep, and
    // this screen's whole claim is that every control on it does something.
    renderSettings();
    await screen.findByText("Not verified");

    // One session row, so one Revoke; the display name is unset, so no Clear
    // name and a disabled Save. The order is the screen's reading order.
    expect(controlNames()).toEqual([
      "Save name",
      "Resend verification email",
      "Revoke",
      "Sign out",
      "Delete account",
    ]);
  });

  it("says nothing about a capability it cannot reach", async () => {
    renderSettings();
    await screen.findByText("Not verified");

    // Display name, sessions and delete-account are here now; what is left is
    // second factor (withheld by decision — FEATURE-PARITY §7a) and API tokens
    // (refused by the forwarder). Not even a heading that hints at one.
    for (const absent of [/second factor/i, /api (key|token)/i]) {
      expect(document.body.textContent).not.toMatch(absent);
    }
  });
});

describe("the delete account panel", () => {
  it("requires typing the personal account name before the confirm enables", async () => {
    renderSettings();
    await screen.findByText("Not verified");

    // Wait for the accounts list to load — the button is disabled until the
    // personal account's name is known.
    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete my account" });
    // The confirm is disabled until the input matches the personal account's
    // name exactly — the reference product's shape for an irreversible action.
    expect(confirm).toBeDisabled();

    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Kaka" } });
    expect(confirm).toBeEnabled();
    expect(dialog).toHaveTextContent("Kaka");
  });

  it("does not delete when the typed name does not match", async () => {
    const { identity } = renderSettings();
    await screen.findByText("Not verified");

    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    // The confirm is disabled, so the click is a no-op — nothing was sent.
    expect(identity.deleteMyAccount).not.toHaveBeenCalled();
  });

  it("deletes the account, forgets the token, and goes to register", async () => {
    const { identity } = renderSettings();
    await screen.findByText("Not verified");

    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Kaka" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    await waitFor(() => expect(identity.deleteMyAccount).toHaveBeenCalledWith("tok_abc"));
    // Asserted on the STORE, not on the screen: the 204 ended every
    // credential, and a screen that merely hid its controls would pass a
    // "signed out" query while a reload would still be signed in.
    await waitFor(() => expect(createTokenStore().get()).toBeNull());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/register"));
  });

  it("renders the service's own 409 detail naming the accounts to transfer", async () => {
    // A caller who is the sole owner of a team account is refused, and the
    // problem document's detail names each account by name and slug precisely
    // so the caller can act. That detail is the service's own user-facing
    // sentence, not an internal detail.
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        deleteMyAccount: vi.fn(() =>
          Promise.reject(
            anIdentityError(409, "account_ownership_conflict", {
              detail: 'sole owner of a team account: "Acme" (acme). Transfer ownership to somebody else.',
            }),
          ),
        ),
      }),
    );

    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Kaka" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/sole owner of a team account/);
    expect(alert).toHaveTextContent(/Acme/);
    // The token survives a refusal: the account still exists, and clearing the
    // credential would strand somebody inside a session they still hold.
    expect(createTokenStore().get()).not.toBeNull();
  });

  it("renders a network failure as one plain sentence", async () => {
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        deleteMyAccount: vi
          .fn()
          .mockRejectedValue(new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080")),
      }),
    );

    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Kaka" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not delete your account/i);
    expect(alert).not.toHaveTextContent(/ECONNREFUSED/);
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
  });

  it("does not delete twice on a double submit", async () => {
    let settle: () => void = () => {};
    const deleteMyAccount = vi.fn(
      () => new Promise<void>((resolve) => (settle = () => resolve())),
    );
    renderSettings(
      stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        verificationStatus: unverified(),
        requestEmailVerification: accepted(),
        logout: vi.fn(() => Promise.resolve()),
        listSessions: vi.fn(() => Promise.resolve({ sessions: [aSession()] })),
        revokeSession: vi.fn(() => Promise.resolve()),
        deleteMyAccount,
      }),
    );

    const deleteButton = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Kaka" } });
    const confirm = within(dialog).getByRole("button", { name: "Delete my account" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(deleteMyAccount).toHaveBeenCalledTimes(1);
    settle();
    await waitFor(() => expect(createTokenStore().get()).toBeNull());
  });
});