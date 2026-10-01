import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ForgotPasswordPage from "./page";
import { anIdentityError, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const ADDRESS = "kaka@example.com";

function renderPage(identity = stubIdentity()) {
  const result = renderWithProviders(<ForgotPasswordPage />, { identity });
  return { identity, ...result };
}

function typeAddress(value: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

/**
 * `/forgot-password`.
 *
 * The property under test is the enumeration one, and it is tested from both
 * sides. The service answers a constant `202 {"status":"accepted"}` for a
 * registered address and an unregistered one; this suite asserts the SCREEN
 * renders one sentence for both, and — the half that is easy to get wrong — that
 * the failures which are safe to distinguish (a malformed address, a deployment
 * that cannot send) are still distinguishable.
 */
beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

afterEach(cleanup);

describe("the forgot password screen", () => {
  it("names itself", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/reset your password/i);
  });

  it("offers a way back to sign in, because some arrivals are not stuck", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("marks the address for autofill", () => {
    renderPage();

    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  });
});

describe("asking for a link", () => {
  it("posts the address the person typed, trimmed", async () => {
    const { identity } = renderPage(stubIdentity({ requestPasswordReset: vi.fn(async () => ({ status: "accepted" })) }));

    typeAddress(`  ${ADDRESS}  `);
    submit();

    await waitFor(() => {
      expect(identity.requestPasswordReset).toHaveBeenCalledWith(ADDRESS);
    });
  });

  it("sends nothing for an empty form rather than asking about a blank address", () => {
    const { identity } = renderPage(
      stubIdentity({ requestPasswordReset: vi.fn(async () => ({ status: "accepted" })) }),
    );

    submit();

    // The refusal is on the screen, and no request was made.
    expect(screen.getByRole("alert")).toHaveTextContent(/email is required/i);
    expect(identity.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("refuses a malformed address before a round trip", () => {
    const { identity } = renderPage(
      stubIdentity({ requestPasswordReset: vi.fn(async () => ({ status: "accepted" })) }),
    );

    typeAddress("kaka@@example");
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent(/valid email address/i);
    expect(identity.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("does not send a second request on a double submit", async () => {
    // The token in a real request is a credential and the service would mint a
    // second one; `inFlight` is a ref precisely because `disabled` lands a frame
    // after the click.
    let resolve: (value: { status: string }) => void = () => {};
    const requestPasswordReset = vi.fn(
      () => new Promise<{ status: string }>((settle) => (resolve = settle)),
    );
    renderPage(stubIdentity({ requestPasswordReset }));

    typeAddress(ADDRESS);
    submit();
    submit();
    submit();

    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    resolve({ status: "accepted" });
    await screen.findByText(/reset link is on its way/i);
  });
});

describe("the answer, which must not distinguish an address that exists", () => {
  it("says one sentence for an accepted request, naming no address", async () => {
    renderPage(stubIdentity({ requestPasswordReset: vi.fn(async () => ({ status: "accepted" })) }));

    typeAddress(ADDRESS);
    submit();

    const said = await screen.findByRole("status");
    expect(said).toHaveTextContent(/if that address has an account here/i);
    // The sentence is the whole defence in this hop. Echoing the address back
    // would confirm it exists even though the service refused to say so.
    expect(said.textContent).not.toContain(ADDRESS);
  });

  it("renders the same sentence whichever address was typed", async () => {
    // The service's 202 is a constant, so the only thing that could reintroduce
    // the oracle on this screen is rendering something address-specific.
    const accepted = vi.fn(async () => ({ status: "accepted" }));

    const known = renderPage(stubIdentity({ requestPasswordReset: accepted }));
    typeAddress(ADDRESS);
    submit();
    const forKnown = (await screen.findByRole("status")).textContent;
    cleanup();

    renderPage(stubIdentity({ requestPasswordReset: accepted }));
    typeAddress("nobody-here@example.com");
    submit();
    const forUnknown = (await screen.findByRole("status")).textContent;

    expect(forUnknown).toBe(forKnown);
    known.unmount();
  });

  it("takes the form away on success, so a second message cannot be asked for", async () => {
    // A request inside identity's one-minute cooldown sends nothing and still
    // answers 202, so a second attempt would be a promise the service cannot keep.
    renderPage(stubIdentity({ requestPasswordReset: vi.fn(async () => ({ status: "accepted" })) }));

    typeAddress(ADDRESS);
    submit();

    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "Send reset link" })).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

describe("the failures, each one actionable", () => {
  it("does not tell somebody to check their inbox when this deployment cannot send", async () => {
    // The 503 is the whole reason it is a 503 and not a 500: the caller can act
    // on it. identity checks the mailer BEFORE the address lookup, so rendering
    // this differently cannot leak whether the address exists.
    renderPage(
      stubIdentity({
        requestPasswordReset: vi
          .fn()
          .mockRejectedValue(anIdentityError(503, "service_unavailable")),
      }),
    );

    typeAddress(ADDRESS);
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot send email/i);
    expect(alert).not.toHaveTextContent(/on its way/i);
    // And the form is still there, because retrying is the actual next step.
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
  });

  it("places a service's 422 on the address field", async () => {
    // The one failure that names a field, and it is safe because the service
    // validated the shape before looking anything up.
    renderPage(
      stubIdentity({
        requestPasswordReset: vi
          .fn()
          .mockRejectedValue(
            anIdentityError(422, "validation_failed", {
              fieldErrors: [{ field: "email", code: "invalid_format" }],
            }),
          ),
      }),
    );

    typeAddress(ADDRESS);
    submit();

    expect(await screen.findByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email address/i);
  });

  it("renders a network failure as one plain sentence, with nothing from the error", async () => {
    // A `fetch` rejection's message is where a host and a port live.
    const thrown = new TypeError("Failed to fetch. http://localhost:8080 refused the connection");
    renderPage(stubIdentity({ requestPasswordReset: vi.fn().mockRejectedValue(thrown) }));

    typeAddress(ADDRESS);
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent(/localhost/);
    expect(alert).not.toHaveTextContent(/connection/i);
  });

  it("does not claim a mail is on its way after a 500", async () => {
    renderPage(
      stubIdentity({ requestPasswordReset: vi.fn().mockRejectedValue(anIdentityError(500, "internal")) }),
    );

    typeAddress(ADDRESS);
    submit();

    expect(await screen.findByRole("alert")).not.toHaveTextContent(/on its way/i);
  });
});
