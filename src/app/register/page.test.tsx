import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegisterPage from "./page";
import { anIdentityError, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const CREDENTIALS = { email: "kaka@example.com", password: "correct horse" };

function fillIn({ email, password }: { email: string; password: string }) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

/**
 * The register screen, end to end against a scripted service.
 *
 * The 422 case is the one worth the ink: the service answers with a
 * problem+json body listing per-field failures, and the promise this screen
 * makes is that the person sees which field is wrong, in place, without
 * having to match the message up to a label by eye.
 */
beforeEach(() => {
  localStorage.clear();
});

describe("register page", () => {
  it("names itself as the account creation screen", () => {
    renderWithProviders(<RegisterPage />, { identity: stubIdentity() });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your account");
  });

  it("asks for an email address", () => {
    renderWithProviders(<RegisterPage />, { identity: stubIdentity() });

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("asks for a password without echoing it", () => {
    renderWithProviders(<RegisterPage />, { identity: stubIdentity() });

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("states the minimum password length before the person types one", () => {
    renderWithProviders(<RegisterPage />, { identity: stubIdentity() });

    expect(screen.getByText("8 characters minimum.")).toBeInTheDocument();
  });

  it("points people who already have an account at sign in", () => {
    renderWithProviders(<RegisterPage />, { identity: stubIdentity() });

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  describe("with a valid address", () => {
    it("sends the credentials to the service", async () => {
      const identity = stubIdentity({
        register: vi.fn(async () => ({ id: "usr_1", email: CREDENTIALS.email })),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(identity.register).toHaveBeenCalledWith(CREDENTIALS));
    });

    it("confirms the account was created", async () => {
      const identity = stubIdentity({
        register: vi.fn(async () => ({ id: "usr_1", email: CREDENTIALS.email })),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("status")).toHaveTextContent(/account created/i);
    });

    it("does not sign anyone in by itself", async () => {
      // POST /v1/users answers with the new user and no token, so there is
      // nothing to persist. Pretending otherwise would show a signed-in header
      // over a session the service has never heard of.
      const identity = stubIdentity({
        register: vi.fn(async () => ({ id: "usr_1", email: CREDENTIALS.email })),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("status");
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });

    it("takes the password off the screen once it succeeds", async () => {
      // The form is replaced by the confirmation, so a password left in a
      // hidden input would be one shoulder-surf away from a shoulder's next
      // session.
      const identity = stubIdentity({
        register: vi.fn(async () => ({ id: "usr_1", email: CREDENTIALS.email })),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("status");
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    });
  });

  /**
   * ---------------------------------------------------------------------------
   * ASKING FOR THE VERIFICATION LINK, WHICH `POST /v1/users` DOES NOT DO
   * ---------------------------------------------------------------------------
   *
   * identity's contract is explicit: "Verification is not automatic at
   * registration. `POST /v1/users` does not send anything, and a client that wants
   * an address proved calls this route afterwards. That is one extra call in
   * exchange for a registration that cannot fail because a mail provider is down."
   *
   * So this screen makes the second call, and everything hard about it is the
   * failure handling: **the account exists from the moment the first call
   * returns.** A request that fails afterwards must not turn a created account
   * into "something went wrong", because the person would reasonably read that as
   * "no account" and register again — against a 409 on an address they just
   * proved they own.
   */
  describe("after the account exists", () => {
    const registered = (extra = {}) =>
      stubIdentity({
        register: vi.fn(async () => ({ id: "usr_1", email: CREDENTIALS.email })),
        requestEmailVerification: vi.fn(async () => ({ status: "accepted" })),
        ...extra,
      });

    it("asks for the verification link the registration did not send", async () => {
      const identity = registered();

      renderWithProviders(<RegisterPage />, { identity });
      fillIn(CREDENTIALS);
      submit();

      await waitFor(() =>
        expect(identity.requestEmailVerification).toHaveBeenCalledWith(CREDENTIALS.email),
      );
    });

    it("asks for it with the address the service returned, not the one that was typed", async () => {
      // The service normalizes to lower case and trims; `POST /v1/users` echoes the
      // stored address back. Following the echo rather than the input is what keeps
      // a lookup keyed on the account's own row.
      const identity = registered({
        register: vi.fn(async () => ({ id: "usr_1", email: "kaka@example.com" })),
      });

      renderWithProviders(<RegisterPage />, { identity });
      fillIn({ email: "  KAKA@Example.COM  ", password: CREDENTIALS.password });
      submit();

      await waitFor(() =>
        expect(identity.requestEmailVerification).toHaveBeenCalledWith("kaka@example.com"),
      );
    });

    it("says the link is on its way", async () => {
      renderWithProviders(<RegisterPage />, { identity: registered() });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("status")).toHaveTextContent(/link is on its way/i);
    });

    it("names the address it just created, which is safe here and only here", async () => {
      // THE DELIBERATE ASYMMETRY with `/verify-email`, which must not name an
      // address at all. Here the person typed it thirty seconds ago and the
      // service just created a row for it, so echoing it back confirms nothing
      // they do not already know — and "we sent a link to kaka@example.com" is the
      // sentence that makes the mail findable when two accounts exist on one
      // device. The rule is not "never name an address"; it is "never name one you
      // did not just create".
      renderWithProviders(<RegisterPage />, { identity: registered() });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("status")).toHaveTextContent(CREDENTIALS.email);
    });

    it("still says the account was created, not just that a mail is coming", async () => {
      renderWithProviders(<RegisterPage />, { identity: registered() });

      fillIn(CREDENTIALS);
      submit();

      // The primary fact. A screen that reported only the mail would leave a
      // person who never received it believing they had not signed up. And the
      // address is in it, in every branch — see `CREATED_AND_SENT`.
      expect(await screen.findByRole("status")).toHaveTextContent(
        `Account created for ${CREDENTIALS.email}`,
      );
    });

    it("offers the way to sign in", async () => {
      renderWithProviders(<RegisterPage />, { identity: registered() });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByRole("status");

      // The name is longer than a bare "Sign in" on purpose: the page's heading
      // carries an "Already have one? Sign in" link, and two links with the same
      // name and the same destination on one screen is an ambiguous name for a
      // screen reader and a coin flip for everybody else.
      expect(screen.getByRole("link", { name: /sign in to your new account/i })).toHaveAttribute(
        "href",
        "/login",
      );
      // And the heading's hint is still exactly one, not a second "Sign in".
      expect(screen.getAllByRole("link", { name: "Sign in" })).toHaveLength(1);
    });

    it("offers the resend for somebody who cannot find the mail", async () => {
      renderWithProviders(<RegisterPage />, { identity: registered() });

      fillIn(CREDENTIALS);
      submit();
      await screen.findByRole("status");

      // The resend action. It goes to the screen that asks rather than re-posting
      // here, so the one-minute cooldown is the service's to answer rather than
      // something this screen counts — a second post from this page would be a
      // promise the service cannot keep inside that window.
      expect(screen.getByRole("link", { name: /send it again/i })).toHaveAttribute(
        "href",
        "/verify-email",
      );
    });

    it("does not sign anyone in by sending a link", async () => {
      // Both of these routes are anonymous and neither mints a session. A signed-in
      // header here would be a session the service has never heard of.
      const identity = registered();

      renderWithProviders(<RegisterPage />, { identity });
      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("status");
      expect(identity.login).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });
  });

  describe("when the verification link cannot be asked for", () => {
    const accountCreatedThen = (thrown: unknown) =>
      stubIdentity({
        register: vi.fn(async () => ({ id: "usr_1", email: CREDENTIALS.email })),
        requestEmailVerification: vi.fn(async () => {
          throw thrown;
        }),
      });

    it("still says the account was created, because it was", async () => {
      renderWithProviders(
        <RegisterPage />,
        { identity: accountCreatedThen(anIdentityError(503, "service_unavailable")) },
      );

      fillIn(CREDENTIALS);
      submit();

      // The whole reason this branch exists. Reporting "something went wrong" here
      // would be read as "no account was created", and the obvious next move is to
      // register again — into a 409 for an address they just proved they own.
      expect(await screen.findByRole("status")).toHaveTextContent(/account created/i);
    });

    it("does not send anybody to an inbox when the deployment cannot send", async () => {
      renderWithProviders(
        <RegisterPage />,
        { identity: accountCreatedThen(anIdentityError(503, "service_unavailable")) },
      );

      fillIn(CREDENTIALS);
      submit();

      // `RequestVerification` checks the mailer before it looks anything up, so
      // this 503 is about the deployment and says nothing about the address.
      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(/cannot send email/i);
      expect(status).not.toHaveTextContent(/on its way/i);
    });

    it("keeps the resend available, because the link is still worth asking for later", async () => {
      renderWithProviders(
        <RegisterPage />,
        { identity: accountCreatedThen(anIdentityError(503, "service_unavailable")) },
      );

      fillIn(CREDENTIALS);
      submit();
      await screen.findByRole("status");

      expect(screen.getByRole("link", { name: /send it again/i })).toHaveAttribute(
        "href",
        "/verify-email",
      );
    });

    it("does not claim a mail is coming when something else failed", async () => {
      // A network failure here is the same situation as the 503: the account
      // exists, and no message was sent.
      const thrown = new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080");
      renderWithProviders(<RegisterPage />, { identity: accountCreatedThen(thrown) });

      fillIn(CREDENTIALS);
      submit();

      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(/account created/i);
      expect(status).not.toHaveTextContent(/on its way/i);
      // And the failure itself never reaches the page: a proxy's address is not
      // something to put in front of a person.
      expect(status).not.toHaveTextContent(/ECONNREFUSED/);
      expect(status).not.toHaveTextContent(/10\.0\.0\.4/);
    });
  });

  describe("when the service rejects the address", () => {
    const rejects422 = () =>
      stubIdentity({
        register: vi.fn(async () => {
          throw anIdentityError(422, "validation_failed", {
            title: "Validation failed",
            fieldErrors: [{ field: "email", code: "invalid_format" }],
          });
        }),
      });

    it("says the submission failed", async () => {
      renderWithProviders(<RegisterPage />, { identity: rejects422() });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    });

    it("puts the failure next to the email field", async () => {
      renderWithProviders(<RegisterPage />, { identity: rejects422() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() =>
        expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
          /enter a valid email address/i,
        ),
      );
    });

    it("marks the email field invalid", async () => {
      renderWithProviders(<RegisterPage />, { identity: rejects422() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true"));
    });

    it("leaves the password field alone when only the email failed", async () => {
      renderWithProviders(<RegisterPage />, { identity: rejects422() });

      fillIn(CREDENTIALS);
      submit();

      await waitFor(() => expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true"));
      expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid", "true");
    });

    it("reports a short password under the password field", async () => {
      const identity = stubIdentity({
        register: vi.fn(async () => {
          throw anIdentityError(422, "validation_failed", {
            fieldErrors: [{ field: "password", code: "too_short" }],
          });
        }),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn({ email: CREDENTIALS.email, password: "a-much-longer-password" });
      submit();

      await waitFor(() =>
        expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/use at least 8/i),
      );
    });

    it("keeps what was typed so it does not have to be typed again", async () => {
      renderWithProviders(<RegisterPage />, { identity: rejects422() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Email")).toHaveValue(CREDENTIALS.email);
    });

    it("does not report success", async () => {
      renderWithProviders(<RegisterPage />, { identity: rejects422() });

      fillIn(CREDENTIALS);
      submit();

      await screen.findByRole("alert");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("when the address is already registered", () => {
    it("says so", async () => {
      // Registration is the one surface where this may be revealed: it is the
      // answer the person needs, and it is already known to whoever owns the
      // inbox. Login below is the opposite case.
      const identity = stubIdentity({
        register: vi.fn(async () => {
          throw anIdentityError(409, "conflict", { detail: "email already registered" });
        }),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(/already registered/i);
    });

    it("does not echo the address back", async () => {
      const identity = stubIdentity({
        register: vi.fn(async () => {
          throw anIdentityError(409, "conflict");
        }),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("alert")).not.toHaveTextContent(CREDENTIALS.email);
    });
  });

  describe("before anything is sent", () => {
    it("refuses a password shorter than the service's minimum", async () => {
      const identity = stubIdentity();
      renderWithProviders(<RegisterPage />, { identity });

      fillIn({ email: CREDENTIALS.email, password: "short" });
      submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(/use at least 8/i);
      expect(identity.register).not.toHaveBeenCalled();
    });

    it("refuses an address that is not one", async () => {
      const identity = stubIdentity();
      renderWithProviders(<RegisterPage />, { identity });

      fillIn({ email: "kaka@", password: CREDENTIALS.password });
      submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(/valid email address/i);
      expect(identity.register).not.toHaveBeenCalled();
    });

    it("refuses an empty form without asking the service", async () => {
      const identity = stubIdentity();
      renderWithProviders(<RegisterPage />, { identity });

      submit();

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(identity.register).not.toHaveBeenCalled();
    });

    it("puts each local failure next to its own field", async () => {
      const identity = stubIdentity();
      renderWithProviders(<RegisterPage />, { identity });

      fillIn({ email: "kaka@", password: "short" });
      submit();

      await waitFor(() =>
        expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(/valid email address/i),
      );
      expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/use at least 8/i);
    });
  });

  describe("while the request is in flight", () => {
    it("will not send a second one", async () => {
      // A double submit is two accounts, or a confusing 409 on the second.
      const identity = stubIdentity({
        register: vi.fn(() => new Promise<never>(() => undefined)),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();
      submit();

      await waitFor(() => expect(identity.register).toHaveBeenCalledTimes(1));
      // Drain the queue before counting again: a second request that had been
      // let through would have started by now, and asserting straight after
      // the waitFor would pass a broken guard.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(identity.register).toHaveBeenCalledTimes(1);
    });

    it("disables the control so the state is visible", async () => {
      const identity = stubIdentity({
        register: vi.fn(() => new Promise<never>(() => undefined)),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      expect(await screen.findByRole("button", { name: "Create account" })).toBeDisabled();
    });
  });

  describe("when the service is unreachable", () => {
    it("says something went wrong without leaking the failure", async () => {
      const identity = stubIdentity({
        register: vi.fn(async () => {
          throw anIdentityError(503, "unavailable", { detail: "dial tcp 10.0.0.4:5432" });
        }),
      });
      renderWithProviders(<RegisterPage />, { identity });

      fillIn(CREDENTIALS);
      submit();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/went wrong/i);
      expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
    });
  });
});
