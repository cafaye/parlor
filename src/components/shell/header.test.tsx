import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShellHeader } from "./header";
import { SESSION_TOKEN_KEY, createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

/**
 * The header is the session-aware surface: it is the only place a signed-in
 * person can see that they are signed in, and the only place they can leave.
 *
 * Sign-out is asserted all the way down to the token that was sent, because
 * "the link disappeared" is also what a broken `me()` call looks like.
 */
beforeEach(() => {
  localStorage.clear();
});

function storeToken(token: string) {
  createTokenStore().set(token);
}

describe("shell header", () => {
  it("links the brand home", () => {
    const identity = stubIdentity();

    renderWithProviders(<ShellHeader />, { identity });

    expect(screen.getByRole("link", { name: "parlor" })).toHaveAttribute("href", "/");
  });

  describe("when signed out", () => {
    it("offers a sign in link", () => {
      const identity = stubIdentity();

      renderWithProviders(<ShellHeader />, { identity });

      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    });

    it("offers a create account link", () => {
      const identity = stubIdentity();

      renderWithProviders(<ShellHeader />, { identity });

      expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
        "href",
        "/register",
      );
    });

    it("does not offer a sign out control", () => {
      const identity = stubIdentity();

      renderWithProviders(<ShellHeader />, { identity });

      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });

    it("never asks the service who we are when there is no token", async () => {
      // The short-circuit is the point: a signed-out visitor should not spend a
      // round trip to learn they are signed out.
      const identity = stubIdentity();

      renderWithProviders(<ShellHeader />, { identity });

      await Promise.resolve();
      expect(identity.me).not.toHaveBeenCalled();
    });
  });

  describe("when a session is stored", () => {
    it("shows neither state while the session is still being resolved", () => {
      // A signed-in person reloading the page must not see "Sign in" flash
      // before their name arrives, so the unresolved state renders nothing.
      const identity = stubIdentity({ me: vi.fn(() => new Promise<never>(() => undefined)) });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });

      expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });

    it("asks the service who we are", async () => {
      const identity = stubIdentity({ me: vi.fn(async () => aUser()) });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });

      await waitFor(() => expect(identity.me).toHaveBeenCalledWith("tok_abc"));
    });

    it("shows the signed in email", async () => {
      const identity = stubIdentity({ me: vi.fn(async () => aUser()) });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });

      expect(await screen.findByText("kaka@example.com")).toBeInTheDocument();
    });

    it("offers sign out instead of sign in", async () => {
      const identity = stubIdentity({ me: vi.fn(async () => aUser()) });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });

      expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    });

    it("returns to the signed out header when the stored token is rejected", async () => {
      // An expired or revoked token is the normal case after a server restart.
      // It must land on the signed out header, not on a broken one.
      const identity = stubIdentity({
        me: vi.fn(async () => {
          throw anIdentityError(401, "unauthorized");
        }),
      });
      storeToken("tok_stale");

      renderWithProviders(<ShellHeader />, { identity });

      expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    });

    it("forgets a rejected token so the next load does not retry it", async () => {
      const identity = stubIdentity({
        me: vi.fn(async () => {
          throw anIdentityError(401, "unauthorized");
        }),
      });
      storeToken("tok_stale");

      renderWithProviders(<ShellHeader />, { identity });

      await waitFor(() => expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull());
    });
  });

  describe("signing out", () => {
    it("sends the stored token when the control is used", async () => {
      const identity = stubIdentity({
        me: vi.fn(async () => aUser()),
        logout: vi.fn(async () => undefined),
      });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

      await waitFor(() => expect(identity.logout).toHaveBeenCalledWith("tok_abc"));
    });

    it("clears the stored token", async () => {
      const identity = stubIdentity({
        me: vi.fn(async () => aUser()),
        logout: vi.fn(async () => undefined),
      });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

      await waitFor(() => expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull());
    });

    it("returns to the signed out header", async () => {
      const identity = stubIdentity({
        me: vi.fn(async () => aUser()),
        logout: vi.fn(async () => undefined),
      });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

      expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    });

    it("ends the local session even when the service call fails", async () => {
      // Waiting on a DELETE that is already failing would strand someone in a
      // session they asked to leave. The local half always happens.
      const identity = stubIdentity({
        me: vi.fn(async () => aUser()),
        logout: vi.fn(async () => {
          throw anIdentityError(502, "unavailable");
        }),
      });
      storeToken("tok_abc");

      renderWithProviders(<ShellHeader />, { identity });
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

      expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
      await waitFor(() => expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull());
    });
  });
});
