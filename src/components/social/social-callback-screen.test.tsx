/**
 * The social callback screen, and the four answers it can have.
 *
 * The screen's whole job is a hard problem with an easy-looking solution, so
 * most of this file is about which answer it refuses to give. The three bodies
 * `completeSocialLogin` can return are mutually exclusive on the wire, and
 * reading the wrong one is how a client ends up claiming a session that was
 * never minted — a link body read as an empty session, or an MFA challenge read
 * as a success. Every one of those is asserted here by what the screen does NOT
 * do as much as by what it renders.
 *
 * The other thing pinned here is the exchange happening EXACTLY ONCE, because
 * the authorization code is one-shot and a second request would fail on a spent
 * code — reported to the person as "this did not work", which is the worst
 * available reading of a sign-in that actually worked.
 */
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SocialCallbackScreen } from "@/components/social/social-callback-screen";
import type { SocialSignIn } from "@/lib/identity";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useNavigation: () => ({ push, refresh: vi.fn() }) }));

/** What a provider sends on success: a code and the state it was given. */
const ROUND_TRIP = { code: "the-code", state: "st_1" };

function callback(query: Record<string, string> = ROUND_TRIP) {
  return <SocialCallbackScreen provider="github" searchParams={query} />;
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

describe("a completed round trip", () => {
  it("keeps the token the service minted", async () => {
    // The exchange happens in an effect, so this is the first thing that can
    // possibly be true — there is no synchronous path to a token.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "session" as const,
        session: { token: "tok_social", expires_at: "2026-10-01T00:00:00Z" },
      }))),
      me: vi.fn(() => Promise.resolve(({ id: "usr_1", email: "kaka@example.com" }))),
    });
    renderWithProviders(callback(), { identity });

    await waitFor(() => expect(createTokenStore().get()).toBe("tok_social"));
  });

  it("sends the provider and the three parameters to the service", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "session" as const,
        session: { token: "tok_social", expires_at: "2026-10-01T00:00:00Z" },
      }))),
    });
    renderWithProviders(callback(), { identity });

    await waitFor(() =>
      expect(identity.completeSocialLogin).toHaveBeenCalledWith("github", ROUND_TRIP),
    );
  });

  it("goes home afterwards, the way the password path does", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "session" as const,
        session: { token: "tok_social", expires_at: "2026-10-01T00:00:00Z" },
      }))),
    });
    renderWithProviders(callback(), { identity });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("never shows an error on the way", async () => {
    // The states are exclusive. A page that rendered the working sentence and
    // then an alert would be telling somebody a sign-in failed while it was
    // succeeding, and the alert is the assertive one.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "session" as const,
        session: { token: "tok_social", expires_at: "2026-10-01T00:00:00Z" },
      }))),
    });
    renderWithProviders(callback(), { identity });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * The property the whole route shape exists for.
   *
   * React runs an effect once per mount in normal operation, so "call it once"
   * is not a thing most screens have to be told. It becomes one here because the
   * cost of getting it wrong is a SPENT CODE: the second request fails on the
   * first having consumed it, and the failure a person sees is "this sign-in did
   * not work" for a sign-in that worked. A re-render, a remount or a StrictMode
   * double-invoke must not be able to cause it.
   *
   * The assertion is on the CALL count rather than on the rendered result,
   * because a screen that exchanged twice and rendered the first answer
   * correctly looks identical to one that exchanged once.
   */
  it("exchanges the code exactly once, however many times it re-renders", async () => {
    // The window this guard exists for is the one BEFORE the first answer
    // arrives: `landing` is still `working`, so any guard that is not the latch
    // cannot tell a second invocation from the first. A pending promise holds
    // that window open deliberately -- React's StrictMode double-invoke lands in
    // exactly it, and so does any parent that re-renders while the request is in
    // flight.
    //
    // Asserted on the CALL COUNT rather than on the rendered result, because a
    // screen that exchanged twice and rendered the first answer correctly looks
    // identical to one that exchanged once.
    let release: (value: SocialSignIn) => void = () => undefined;
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(
        () =>
          new Promise<SocialSignIn>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const { rerender } = renderWithProviders(callback(), { identity });

    await waitFor(() => expect(identity.completeSocialLogin).toHaveBeenCalledTimes(1));

    // Re-render while the exchange is still in flight, twice, with fresh query
    // objects -- which is what a parent that rebuilds its props does.
    rerender(callback());
    rerender(callback({ ...ROUND_TRIP }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      identity.completeSocialLogin,
      "a second exchange spends a one-shot authorization code and fails on a spent one",
    ).toHaveBeenCalledTimes(1);

    release({
      kind: "session",
      session: { token: "tok_social", expires_at: "2026-10-01T00:00:00Z" },
    });
    await waitFor(() => expect(createTokenStore().get()).toBe("tok_social"));
  });
});

describe("a round trip the provider refused", () => {
  it("asks the service, rather than deciding a decline from the URL", async () => {
    // The query carries no `code` when the provider reports a problem, so this
    // is a DIFFERENT SHAPE from a success rather than a different value of the
    // same one — and it is still identity's answer, not this screen's. Rendering
    // a caller-supplied `?error=` as "you cancelled" would draw a conclusion from
    // something anybody can type into a URL, and it would leave the one-shot
    // state cookie sitting in the browser because nothing ever cleared it.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(400, "invalid_request"))),
    });
    renderWithProviders(callback({ error: "access_denied", state: "st_1" }), { identity });

    await waitFor(() =>
      expect(identity.completeSocialLogin).toHaveBeenCalledWith("github", {
        state: "st_1",
        error: "access_denied",
      }),
    );
  });

  it("offers a way back rather than a blank screen", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(400, "invalid_request"))),
    });
    renderWithProviders(callback({ error: "access_denied", state: "st_1" }), { identity });

    expect(await screen.findByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("offers to start the same flow again", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(400, "invalid_request"))),
    });
    renderWithProviders(callback({ error: "access_denied", state: "st_1" }), { identity });

    expect(await screen.findByRole("link", { name: /try GitHub again/i })).toHaveAttribute(
      "href",
      "/v1/auth/oauth/github",
    );
  });

  it("signs nobody in", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(400, "invalid_request"))),
    });
    renderWithProviders(callback({ error: "access_denied", state: "st_1" }), { identity });

    await screen.findByRole("alert");
    expect(createTokenStore().get()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("says nothing about the status code or the service's own words", async () => {
    // The 400 covers a declined consent, a state that was never issued, a state
    // minted for another provider and a code the provider has retired. Which of
    // those it was is an oracle about the cookie, and the service collapses them
    // into one answer for that reason. So does this screen.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(new Error("dial tcp 10.0.0.4:5432: connection refused"))),
    });
    renderWithProviders(callback({ error: "access_denied", state: "st_1" }), { identity });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/400|invalid_request|invalid request|10\.0\.0\.4|5432/);
  });
});

describe("a round trip with no state at all", () => {
  it("does not ask the service anything", async () => {
    // A person who typed the path, or a link scanner. There is nothing to
    // exchange, so there is no reason to spend a request learning that.
    const identity = stubIdentity();
    renderWithProviders(callback({}), { identity });

    expect(await screen.findByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
    expect(identity.completeSocialLogin).not.toHaveBeenCalled();
  });

  it("says the sign-in did not finish", async () => {
    const identity = stubIdentity();
    renderWithProviders(callback({}), { identity });

    expect((await screen.findByRole("alert")).textContent).toMatch(/did not finish/i);
  });
});

describe("a link instead of a sign-in", () => {
  it("signs nobody in", async () => {
    // The flow started while somebody was ALREADY signed in, so identity
    // attached the provider identity to that account and minted nothing. There
    // is no `token` in that body — reading one is how a client claims a session
    // that does not exist, and treating this arm as a sign-in is the defect this
    // state exists to prevent.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "linked" as const,
        linked: { linked_provider: "github" },
      }))),
    });
    renderWithProviders(callback(), { identity });

    await screen.findByText(/no new session was created/i);
    expect(createTokenStore().get()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("says what actually happened", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "linked" as const,
        linked: { linked_provider: "github" },
      }))),
    });
    renderWithProviders(callback(), { identity });

    // Asserted on the copy rather than on `role="status"`: the working state is
    // itself a status region, so a role query resolves against it before the
    // exchange has answered and every one of these assertions would pass on a
    // screen that never left `working`.
    expect(await screen.findByText(/no new session was created/i)).toBeInTheDocument();
  });

  it("offers a way back rather than leaving the person on a dead page", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.resolve(({
        kind: "linked" as const,
        linked: { linked_provider: "github" },
      }))),
    });
    renderWithProviders(callback(), { identity });

    expect(await screen.findByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
  });
});

describe("a second factor", () => {
  const CHALLENGE = {
    kind: "mfa_required" as const,
    challenge: { mfa_required: true, challenge: "chal_1", expires_at: "2026-10-01T00:10:00Z" },
  };

  it("signs nobody in", async () => {
    // A 202 that is NOT a session. A social sign-in that reads a challenge as a
    // success is a security defect, not a missing feature: the whole reason the
    // service sent it is that this login is not finished.
    const identity = stubIdentity({ completeSocialLogin: vi.fn(() => Promise.resolve(CHALLENGE)) });
    renderWithProviders(callback(), { identity });

    await screen.findByText(/second factor/i);
    expect(createTokenStore().get()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("says the sign-in is not finished", async () => {
    const identity = stubIdentity({ completeSocialLogin: vi.fn(() => Promise.resolve(CHALLENGE)) });
    renderWithProviders(callback(), { identity });

    expect(await screen.findByText(/second factor/i)).toBeInTheDocument();
    expect(await screen.findByText(/nobody is signed in/i)).toBeInTheDocument();
  });

  it("offers the other way in", async () => {
    // The honest way out of a dead end is a way forward. This app cannot FINISH
    // an MFA login from any surface — `POST /v1/session/mfa` is deliberately
    // absent from the forwarder's table — so this points at the screen that
    // exists rather than inventing a code entry form that could not be redeemed.
    const identity = stubIdentity({ completeSocialLogin: vi.fn(() => Promise.resolve(CHALLENGE)) });
    renderWithProviders(callback(), { identity });

    expect(await screen.findByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});

describe("a provider this app does not offer", () => {
  it("names no provider it does not recognise", async () => {
    // The forwarder's provider segment is deliberately OPEN, so a callback can
    // arrive naming anything. The buttons are a list this app offers; a name off
    // that list must not reach rendered copy, and the "try again" link is hidden
    // for it because following it would offer a control for a provider this app
    // has no button for.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(400, "invalid_request"))),
    });
    renderWithProviders(
      <SocialCallbackScreen provider="internal-sso" searchParams={ROUND_TRIP} />,
      { identity },
    );

    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/internal-sso|try .* again/i);
  });
});

describe("a provider that could not be reached", () => {
  it("says the provider is unreachable rather than that the person did something wrong", async () => {
    // 502 is "somebody upstream is broken", not "this sign-in was refused".
    // Telling somebody they did it wrong when a provider is down sends them away
    // from a page that would work on the second attempt.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(502, "service_unavailable"))),
    });
    renderWithProviders(callback(), { identity });

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be reached/i);
  });

  it("offers to try again", async () => {
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(502, "service_unavailable"))),
    });
    renderWithProviders(callback(), { identity });

    expect(await screen.findByRole("link", { name: /try GitHub again/i })).toBeInTheDocument();
  });
});

describe("an address that already has an account", () => {
  it("says so, and names no address", async () => {
    // The 409 on this route is the anti-account-takeover refusal, and it is the
    // one refusal here whose cause the person needs in order to act — for the
    // same reason registration may say "that address is taken". It names the
    // STATE and never an address, which the service's own detail does.
    const identity = stubIdentity({
      completeSocialLogin: vi.fn(() => Promise.reject(anIdentityError(409, "conflict", {
          detail: "an account already exists for kaka@example.com",
        }))),
    });
    renderWithProviders(callback(), { identity });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already an account/i);
    expect(alert.textContent).not.toContain("kaka@example.com");
  });
});

