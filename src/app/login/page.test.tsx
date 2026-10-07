import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";
import { ShellHeader } from "@/components/shell/header";
import { createTokenStore } from "@/lib/token-store";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useNavigation: () => ({ push, refresh: vi.fn() }) }));

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
 * Every render below goes through this helper rather than through
 * `<LoginPage />` directly.
 *
 * It used to be async: the page component was async, because it awaited
 * `searchParams` to decide whether to announce a completed reset, and JSX
 * cannot hold a promise. That is no longer true — the route resolves the
 * location and hands a plain object down, so the page is a synchronous
 * function and this helper is synchronous with it. Nothing below had to change
 * when that happened, which is the point of the page taking an object rather
 * than reaching for the router itself.
 */
function loginPage(query: Record<string, string> = {}) {
  return LoginPage({ searchParams: query });
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
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/sign in/i);
  });

  it("marks the email field for autofill", () => {
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  });

  it("marks the password field as the current one, not a new one", () => {
    // autocomplete="new-password" here makes password managers offer to
    // generate a replacement instead of filling in the one they already have.
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("points people without an account at registration", () => {
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("offers the way out to somebody who cannot sign in", () => {
    // The affordance the whole password-reset flow hangs off. It is rendered
    // unconditionally rather than after a failed attempt: a link that appeared
    // only once the form had refused you would be leaking something about the
    // address, and this page is the one screen that must never do that.
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.getByRole("link", { name: /forgot your password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("says nothing about a changed password on a plain arrival", () => {
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.queryByText(/password has been changed/i)).toBeNull();
  });

  it("offers the way to ask for a verification link", () => {
    // The entry point for somebody who signed up, closed the tab, and never
    // verified — the audience `POST /v1/email-verifications` cannot serve with a
    // banner, because `GET /v1/email-verification` answers for the caller's own
    // address and they are the one who is not signed in.
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    expect(screen.getByRole("link", { name: /verify your email/i })).toHaveAttribute(
      "href",
      "/verify-email",
    );
  });

  it("offers it without saying anything about the address, before any attempt", () => {
    // Same rule as the "forgot your password" link above it: a control that
    // appeared only after a refused attempt would be reporting something about the
    // address, and this is the screen that must never do that.
    renderWithProviders(loginPage(), { identity: stubIdentity() });

    const link = screen.getByRole("link", { name: /verify your email/i });
    expect(link).toBeVisible();
    // Asking a question is not the same as being told an answer: the link names
    // nothing, and nothing on this screen claims to know whether the address
    // behind it has an account.
    expect(link.textContent).not.toMatch(/no account|not found|already/i);
  });

  describe("arriving back from a completed reset", () => {
    /**
     * Synchronous, and NOT `async`, for the reason `loginPage` above is not:
     * the page takes an object and returns JSX, so there is nothing to await.
     * The call sites kept their `await` when the page stopped being async and
     * nothing noticed, because awaiting a non-promise is legal — which is
     * exactly why it is worth removing rather than leaving.
     * `@typescript-eslint/await-thenable` reports every one of them.
     */
    function renderArrival(query: Record<string, string>) {
      return renderWithProviders(loginPage(query), { identity: stubIdentity() });
    }

    it("says the password changed and asks for a sign in", () => {
      // `/reset-password` redirects here after a 204, which mints no session.
      // Without this sentence a person is told nothing about why the sign-in
      // they are about to attempt is with a password that used to fail.
      renderArrival({ "password-changed": "1" });

      expect(screen.getByRole("status")).toHaveTextContent(
        /password has been changed.*sign in with the new one/i,
      );
    });

    it("reads only the parameter's presence, so its value cannot change a word", () => {
      // A value somebody can type must not reach the rendered page. The one
      // signal is that the key is there at all.
      renderArrival({ "password-changed": "anything at all" });

      expect(screen.getByRole("status")).toHaveTextContent(/password has been changed/i);
    });

    it("keeps the reset token out of the page if one is pasted into the URL", () => {
      const token = "0Kq3Zs1oQw7bXn0K9dLpR2vT4yE6hJ8cF1gM5nA2qU0";

      renderArrival({ "password-changed": "1", token });

      expect(document.body.textContent).not.toContain(token);
    });

    it("announces politely rather than interrupting", () => {
      // `role="alert"` would cut across whatever was being read on arrival, for
      // a message that is good news and not urgent.
      renderArrival({ "password-changed": "1" });

      expect(screen.getByRole("status")).not.toHaveAttribute("aria-live", "assertive");
    });
  });

  describe("with correct credentials", () => {
    function acceptsLogin() {
      return stubIdentity({
        // The session arm of the union, which is what `login` resolves now: the
        // token is inside it rather than at the top level, and the auth context
        // writes it to the store on this arm only.
        login: vi.fn(() =>
          Promise.resolve({
            kind: "session" as const,
            session: { token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" },
          }),
        ),
        me: vi.fn(() => Promise.resolve(aUser())),
      });
    }

    it("sends them to the service", async () => {
      const identity = acceptsLogin();
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(identity.login).toHaveBeenCalledWith(CREDENTIALS));
    });

    it("keeps the returned token", async () => {
      // Until the BFF packet moves the token into an HttpOnly cookie, this
      // localStorage entry is the whole session. Lose it and the header signs
      // the person out on the next render.
      renderWithProviders(loginPage(), { identity: acceptsLogin() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(createTokenStore().get()).toBe("tok_abc"));
    });

    it("goes home afterwards", async () => {
      renderWithProviders(loginPage(), { identity: acceptsLogin() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    });

    it("leaves the header signed in", async () => {
      renderWithProviders(
        <>
          <ShellHeader />
          {loginPage()}
        </>,
        { identity: acceptsLogin() },
      );

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(await screen.findByText(aUser().email)).toBeInTheDocument();
    });

    it("does not say anything went wrong", async () => {
      renderWithProviders(loginPage(), { identity: acceptsLogin() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("when the account has a confirmed second factor", () => {
    const CHALLENGE = "ch_1";

    /**
     * A stub whose login answers the 202 and whose second leg mints a session.
     *
     * The challenge is a fixed string so a test can assert it is never
     * rendered: it is a one-time credential, and the prompt must ask for a code
     * without showing the thing that authorises it.
     */
    function stubsWithSecondFactor() {
      return stubIdentity({
        login: vi.fn(() =>
          Promise.resolve({ kind: "mfa_required" as const, challenge: CHALLENGE, expiresAt: "2026-10-01T00:00:00Z" }),
        ),
        completeSecondFactor: vi.fn(() =>
          Promise.resolve({ token: "tok_abc", expires_at: "2026-10-01T00:00:00Z" }),
        ),
        me: vi.fn(() => Promise.resolve(aUser())),
      });
    }

    function fillInCode(code: string) {
      fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
    }

    function submitCode() {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    }

    it("asks for the code without a reload", async () => {
      // The 202 is the service saying "accepted, now a second factor" — the
      // prompt is the next step of the SAME sign-in, not a new page. The
      // credentials were never refused, so nothing is said about them.
      renderWithProviders(loginPage(), { identity: stubsWithSecondFactor() });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByLabelText("Code")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("never renders the challenge", async () => {
      // The challenge is a one-time credential for the leg that spends it. It
      // lives in component state for the span of the prompt and nowhere else —
      // a screen that displayed it would be showing a credential to anybody
      // who can read the page.
      renderWithProviders(loginPage(), { identity: stubsWithSecondFactor() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByLabelText("Code");
      expect(document.body.textContent).not.toContain(CHALLENGE);
    });

    it("sends the challenge and the code to the service", async () => {
      const identity = stubsWithSecondFactor();
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("482913");
      submitCode();

      await waitFor(() =>
        expect(identity.completeSecondFactor).toHaveBeenCalledWith({
          challenge: CHALLENGE,
          code: "482913",
        }),
      );
    });

    it("completes the sign-in on the correct code", async () => {
      // The 200 mints the session, and the token lands in the same store the
      // password path writes — which is what re-renders the header and starts
      // the `me` fetch.
      renderWithProviders(loginPage(), { identity: stubsWithSecondFactor() });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("482913");
      submitCode();

      await waitFor(() => expect(createTokenStore().get()).toBe("tok_abc"));
    });

    it("goes home afterwards", async () => {
      renderWithProviders(loginPage(), { identity: stubsWithSecondFactor() });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("482913");
      submitCode();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    });

    it("leaves the header signed in", async () => {
      renderWithProviders(
        <>
          <ShellHeader />
          {loginPage()}
        </>,
        { identity: stubsWithSecondFactor() },
      );

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("482913");
      submitCode();

      expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(await screen.findByText(aUser().email)).toBeInTheDocument();
    });

    it("a recovery code works through the same field", async () => {
      // The service accepts either shape — a six-digit TOTP code or a recovery
      // code — in the one field. A second form for the second shape would be a
      // distinction the service does not make.
      const identity = stubsWithSecondFactor();
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("7KQF-4W2X-5DTR-M3HN");
      submitCode();

      await waitFor(() =>
        expect(identity.completeSecondFactor).toHaveBeenCalledWith({
          challenge: CHALLENGE,
          code: "7KQF-4W2X-5DTR-M3HN",
        }),
      );
      await waitFor(() => expect(createTokenStore().get()).toBe("tok_abc"));
    });

    it("a refused code shows the refusal and does not sign in", async () => {
      const identity = stubIdentity({
        login: vi.fn(() =>
          Promise.resolve({ kind: "mfa_required" as const, challenge: CHALLENGE, expiresAt: "2026-10-01T00:00:00Z" }),
        ),
        completeSecondFactor: vi.fn(() => Promise.reject(anIdentityError(401, "unauthorized"))),
      });
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("000000");
      submitCode();

      expect(await alertText()).toMatch(/code was not accepted/i);
      expect(createTokenStore().get()).toBeNull();
      expect(push).not.toHaveBeenCalled();
    });

    it("a refused code gives the same sentence for every cause", async () => {
      // A wrong TOTP code, a spent recovery code and a used step are three
      // different facts the service answers with one 401 and one body, on
      // purpose: an attacker who can tell them apart learns which to keep
      // trying. This screen keeps that collapse — the sentence is the same
      // whatever the service's detail says.
      const causes = [
        { detail: "the totp code is wrong" },
        { detail: "the recovery code was already spent" },
        { detail: "that step was already used" },
      ];
      const sentences: string[] = [];

      for (const cause of causes) {
        const identity = stubIdentity({
          login: vi.fn(() =>
            Promise.resolve({ kind: "mfa_required" as const, challenge: CHALLENGE, expiresAt: "2026-10-01T00:00:00Z" }),
          ),
          completeSecondFactor: vi.fn(() =>
            Promise.reject(anIdentityError(401, "unauthorized", cause)),
          ),
        });
        renderWithProviders(loginPage(), { identity });

        fillIn(CREDENTIALS);
        submit();
        await screen.findByLabelText("Code");

        fillInCode("000000");
        submitCode();
        sentences.push(await alertText());

        cleanup();
      }

      expect(new Set(sentences).size).toBe(1);
    });

    it("a locked factor shows the retry window", async () => {
      // The 423's `Retry-After` is the one fact worth having from a lockout:
      // the wait, not a bare "try again". Fifteen minutes is the service's
      // window after five failures.
      const identity = stubIdentity({
        login: vi.fn(() =>
          Promise.resolve({ kind: "mfa_required" as const, challenge: CHALLENGE, expiresAt: "2026-10-01T00:00:00Z" }),
        ),
        completeSecondFactor: vi.fn(() =>
          Promise.reject(anIdentityError(423, "account_locked", { retryAfter: 900 })),
        ),
      });
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("000000");
      submitCode();

      expect(await alertText()).toMatch(/try again in 15 minutes/i);
    });

    it("a deployment that cannot verify a second factor says so", async () => {
      // A 503 is `MFA_ENCRYPTION_KEY` unset — a deployment problem, not a
      // wrong code. Presenting it as a refusal would send somebody to check an
      // app that is producing perfectly good codes.
      const identity = stubIdentity({
        login: vi.fn(() =>
          Promise.resolve({ kind: "mfa_required" as const, challenge: CHALLENGE, expiresAt: "2026-10-01T00:00:00Z" }),
        ),
        completeSecondFactor: vi.fn(() =>
          Promise.reject(anIdentityError(503, "service_unavailable")),
        ),
      });
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fillInCode("482913");
      submitCode();

      const text = await alertText();
      expect(text).toMatch(/deployment cannot verify a second factor/i);
      expect(text).not.toMatch(/code was not accepted/i);
    });

    it("offers a way back to the password form", async () => {
      // A person who cannot complete the second factor — no phone, no recovery
      // codes — is otherwise stuck on a page with no exit: the password form
      // is gone and the only forward path is one they cannot take. The
      // challenge is abandoned, not spent, and the email and password survive
      // the round trip.
      renderWithProviders(loginPage(), { identity: stubsWithSecondFactor() });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByLabelText("Code");

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(await screen.findByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveValue(CREDENTIALS.email);
      expect(createTokenStore().get()).toBeNull();
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("when the service refuses the credentials", () => {
    function refusesLogin() {
      return stubIdentity({
        login: vi.fn(() => Promise.reject(anIdentityError(401, "unauthorized"))),
      });
    }

    it("says the credentials were not accepted", async () => {
      renderWithProviders(loginPage(), { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      expect(await alertText()).toMatch(/invalid email or password/i);
    });

    it("gives the same sentence for an unknown address", async () => {
      // Two refusals, two renders, one string. If these ever diverge, this
      // screen is an account-existence oracle and the service's single 401 is
      // the only thing standing between a stranger and a list of who has an
      // account here.
      renderWithProviders(loginPage(), { identity: refusesLogin() });
      fillIn({ email: "nobody@example.com", password: CREDENTIALS.password });
      submit();
      const unknownAddress = await alertText();

      cleanup();

      renderWithProviders(loginPage(), { identity: refusesLogin() });
      fillIn({ email: CREDENTIALS.email, password: "the wrong password" });
      submit();
      const wrongPassword = await alertText();

      expect(unknownAddress).toBe(wrongPassword);
    });

    it("does not repeat the address that was typed", async () => {
      renderWithProviders(loginPage(), { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      expect(await alertText()).not.toContain(CREDENTIALS.email);
    });

    it("keeps no token", async () => {
      renderWithProviders(loginPage(), { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(createTokenStore().get()).toBeNull();
    });

    it("stays on the page", async () => {
      renderWithProviders(loginPage(), { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(push).not.toHaveBeenCalled();
    });

    it("does not blame the password field for a refused sign in", async () => {
      // The service said nothing about which half was wrong, so neither do we.
      renderWithProviders(loginPage(), { identity: refusesLogin() });

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
          {loginPage()}
        </>,
        { identity: refusesLogin() },
      );

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });

    it("keeps the address so it does not have to be typed again", async () => {
      renderWithProviders(loginPage(), { identity: refusesLogin() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Email")).toHaveValue(CREDENTIALS.email);
    });
  });

  describe("before anything is sent", () => {
    it("refuses an empty form without asking the service", async () => {
      const identity = stubIdentity();
      renderWithProviders(loginPage(), { identity });

      submit();

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(identity.login).not.toHaveBeenCalled();
    });

    it("refuses an address that is not one", async () => {
      const identity = stubIdentity();
      renderWithProviders(loginPage(), { identity });

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
      renderWithProviders(loginPage(), { identity });

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
      renderWithProviders(loginPage(), { identity });

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
        login: vi.fn(() => Promise.reject(anIdentityError(503, "unavailable"))),
      });
      renderWithProviders(loginPage(), { identity });

      fillIn(CREDENTIALS);
      submit();

      const text = await alertText();
      expect(text).not.toMatch(/invalid email or password/i);
      expect(text).toMatch(/went wrong/i);
    });
  });
});
