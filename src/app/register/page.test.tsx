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
