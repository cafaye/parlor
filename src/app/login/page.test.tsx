import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";
import { ShellHeader } from "@/components/shell/header";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const CREDENTIALS = { email: "kaka@example.com", password: "correct horse" };

function fillIn({ email, password }: { email: string; password: string }) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

async function alertText() {
  return (await screen.findByRole("alert")).textContent;
}

/**
 * The login screen, composed with the shell header it lives in.
 *
 * The failure case carries the weight: an unknown address and a wrong password
 * must produce one indistinguishable sentence, because anything else turns the
 * form into a way to test whether someone has an account here.
 */
beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

describe("login page", () => {
  it("names itself as the sign in screen", () => {
    renderWithProviders(<LoginPage />, { identity: stubIdentity() });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/sign in/i);
  });

  it("marks the email field for autofill", () => {
    renderWithProviders(<LoginPage />, { identity: stubIdentity() });

    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  });

  it("marks the password field as the current one, not a new one", () => {
    // autocomplete="new-password" here makes password managers offer to
    // generate a replacement instead of filling in the one they already have.
    renderWithProviders(<LoginPage />, { identity: stubIdentity() });

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("points people without an account at registration", () => {
    renderWithProviders(<LoginPage />, { identity: stubIdentity() });

    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  describe("with correct credentials", () => {
    function acceptsLogin() {
      return stubIdentity({
        login: vi.fn(async () => ({ token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" })),
        me: vi.fn(async () => aUser()),
      });
    }

    it("sends them to the service", async () => {
      const identity = acceptsLogin();
      renderWithProviders(<LoginPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(identity.login).toHaveBeenCalledWith(CREDENTIALS));
    });

    it("keeps the returned token", async () => {
      // Until the BFF packet moves the token into an HttpOnly cookie, this
      // localStorage entry is the whole session. Lose it and the header signs
      // the person out on the next render.
      renderWithProviders(<LoginPage />, { identity: acceptsLogin() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(createTokenStore().get()).toBe("tok_abc"));
    });

    it("goes home afterwards", async () => {
      renderWithProviders(<LoginPage />, { identity: acceptsLogin() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    });

    it("leaves the header signed in", async () => {
      renderWithProviders(
        <>
          <ShellHeader />
          <LoginPage />
        </>,
        { identity: acceptsLogin() },
      );

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(await screen.findByText(aUser().email)).toBeInTheDocument();
    });

    it("does not say anything went wrong", async () => {
      renderWithProviders(<LoginPage />, { identity: acceptsLogin() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("when the service refuses the credentials", () => {
    function refusesLogin() {
      return stubIdentity({
        login: vi.fn(async () => {
          throw anIdentityError(401, "unauthorized");
        }),
      });
    }

    it("says the credentials were not accepted", async () => {
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      expect(await alertText()).toMatch(/invalid email or password/i);
    });

    it("gives the same sentence for an unknown address", async () => {
      // Two refusals, two renders, one string. If these ever diverge, this
      // screen is an account-existence oracle and the service's single 401 is
      // the only thing standing between a stranger and a list of who has an
      // account here.
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });
      fillIn({ email: "nobody@example.com", password: CREDENTIALS.password });
      submit();
      const unknownAddress = await alertText();

      cleanup();

      renderWithProviders(<LoginPage />, { identity: refusesLogin() });
      fillIn({ email: CREDENTIALS.email, password: "the wrong password" });
      submit();
      const wrongPassword = await alertText();

      expect(unknownAddress).toBe(wrongPassword);
    });

    it("does not repeat the address that was typed", async () => {
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      expect(await alertText()).not.toContain(CREDENTIALS.email);
    });

    it("keeps no token", async () => {
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(createTokenStore().get()).toBeNull();
    });

    it("stays on the page", async () => {
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(push).not.toHaveBeenCalled();
    });

    it("does not blame the password field for a refused sign in", async () => {
      // The service said nothing about which half was wrong, so neither do we.
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid", "true");
    });

    it("leaves the header signed out", async () => {
      renderWithProviders(
        <>
          <ShellHeader />
          <LoginPage />
        </>,
        { identity: refusesLogin() },
      );

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });

    it("keeps the address so it does not have to be typed again", async () => {
      renderWithProviders(<LoginPage />, { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Email")).toHaveValue(CREDENTIALS.email);
    });
  });

  describe("before anything is sent", () => {
    it("refuses an empty form without asking the service", async () => {
      const identity = stubIdentity();
      renderWithProviders(<LoginPage />, { identity });

      submit();

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(identity.login).not.toHaveBeenCalled();
    });

    it("refuses an address that is not one", async () => {
      const identity = stubIdentity();
      renderWithProviders(<LoginPage />, { identity });

      fillIn({ email: "kaka@", password: CREDENTIALS.password });
      submit();

      expect(await alertText()).toMatch(/valid email address/i);
      expect(identity.login).not.toHaveBeenCalled();
    });
  });

  describe("while the request is in flight", () => {
    it("will not send a second one", async () => {
      const identity = stubIdentity({
        login: vi.fn(() => new Promise<never>(() => undefined)),
      });
      renderWithProviders(<LoginPage />, { identity });

      fillIn(CREDENTIALS);
      submit();
      submit();

      await waitFor(() => expect(identity.login).toHaveBeenCalledTimes(1));
      // Drain the queue before counting again: a second request that had been
      // let through would have started by now, and asserting straight after
      // the waitFor would pass a broken guard.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(identity.login).toHaveBeenCalledTimes(1);
    });

    it("disables the control so the state is visible", async () => {
      const identity = stubIdentity({
        login: vi.fn(() => new Promise<never>(() => undefined)),
      });
      renderWithProviders(<LoginPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("button", { name: "Sign in" })).toBeDisabled();
    });
  });

  describe("when the service is unreachable", () => {
    it("does not blame the credentials for a service failure", async () => {
      // A 401 means "those are wrong". A 503 means "we could not find out", and
      // telling someone their password is invalid when the service is down
      // sends them off to reset a password that was fine.
      const identity = stubIdentity({
        login: vi.fn(async () => {
          throw anIdentityError(503, "unavailable");
        }),
      });
      renderWithProviders(<LoginPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      const text = await alertText();
      expect(text).not.toMatch(/invalid email or password/i);
      expect(text).toMatch(/went wrong/i);
    });
  });
});
