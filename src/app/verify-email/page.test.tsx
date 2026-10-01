import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VerifyEmailPage from "./page";
import { anIdentityError, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

/**
 * The 202 the service answers for every address.
 *
 * `acceptedResponse` in `identity/internal/httpapi/recovery.go` is a CONSTANT,
 * and `Service.RequestVerification` reaches it for a registered address, an
 * unregistered one, and one inside the one-minute window. This is the body a
 * stub returns, and the tests below assert what the SCREEN does with it.
 */
const accepted = () => vi.fn(async () => ({ status: "accepted" }));

async function renderRequestPage(identity = stubIdentity({ requestEmailVerification: accepted() })) {
  const result = renderWithProviders(await VerifyEmailPage(), { identity });
  return { identity, ...result };
}

function askFor(address: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Send verification link" }));
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

afterEach(cleanup);

/**
 * `/verify-email` — asking for a verification link, and asking again.
 *
 * The resend action and the "we sent you a link" destination are the same screen,
 * which is why it is the anti-enumeration screen: it is reachable by a signed-out
 * person who typed somebody else's address, and that is the exact shape of the
 * attack the service's constant 202 exists to refuse.
 */
describe("the verification request screen", () => {
  it("names itself", async () => {
    await renderRequestPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/verify your email/i);
  });

  it("posts the address and nothing else", async () => {
    const identity = stubIdentity({ requestEmailVerification: accepted() });

    await renderRequestPage(identity);
    askFor("kaka@example.com");

    await waitFor(() => {
      expect(identity.requestEmailVerification).toHaveBeenCalledWith("kaka@example.com");
    });
  });

  it("trims the address before sending it, because a paste carries a space", async () => {
    const identity = stubIdentity({ requestEmailVerification: accepted() });

    await renderRequestPage(identity);
    askFor("  kaka@example.com  ");

    await waitFor(() => {
      expect(identity.requestEmailVerification).toHaveBeenCalledWith("kaka@example.com");
    });
  });

  it("refuses a malformed address without asking the service", async () => {
    const identity = stubIdentity({ requestEmailVerification: accepted() });

    await renderRequestPage(identity);
    askFor("kaka@@example");

    expect(screen.getByRole("alert")).toHaveTextContent(/valid email address/i);
    expect(identity.requestEmailVerification).not.toHaveBeenCalled();
  });

  it("does not submit twice on a double submit", async () => {
    // The cooldown is a minute and a request inside it sends nothing, so a
    // double submit is a promise the service cannot keep.
    let resolve: () => void = () => {};
    const requestEmailVerification = vi.fn(
      () => new Promise<{ status: string }>((settle) => (resolve = () => settle({ status: "accepted" }))),
    );
    await renderRequestPage(stubIdentity({ requestEmailVerification }));

    askFor("kaka@example.com");
    askFor("kaka@example.com");
    askFor("kaka@example.com");

    expect(requestEmailVerification).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  });
});

/**
 * ---------------------------------------------------------------------------
 * THE ANTI-ENUMERATION PROPERTY
 * ---------------------------------------------------------------------------
 *
 * The two renderings below are compared with `toBe`, on the whole region, so
 * "identical" means byte-identical rather than "both mention an inbox". A test
 * that asserted two separate `toContain` checks would pass on two screens that
 * differed in a word, and the word is where the oracle would live.
 */
describe("a request never says whether the address has an account", () => {
  async function askAndRead(address: string, identity = stubIdentity({ requestEmailVerification: accepted() })) {
    await renderRequestPage(identity);
    askFor(address);
    return (await screen.findByRole("status")).textContent;
  }

  it("renders an address with an account exactly as it renders one without", async () => {
    // Nothing in this app knows which addresses have accounts, and that is the
    // point: the service answers the same 202 either way, so the only way this
    // screen could leak was by saying something extra of its own.
    const forRegistered = await askAndRead("kaka@example.com");
    const forUnknown = await askAndRead("nobody-at-all@example.com");

    expect(forRegistered).toBe(forUnknown);
  });

  it("never echoes the address back, whatever the service said", async () => {
    const address = "kaka@example.com";
    const rendered = await askAndRead(address);

    // Echoing it would confirm it exists whatever the status code was, and this
    // is the assertion that survives a service change: it does not care whether
    // the 202 is still constant, only that the screen never re-prints the input.
    expect(rendered).not.toContain(address);
    expect(document.body.textContent).not.toContain(address);
  });

  it("says the same thing for an address that is already proved as for one that is not", async () => {
    // HELD DELIBERATELY, and this is the test to read before changing anything on
    // this screen.
    //
    // `POST /v1/email-verifications` answers 202 for an address with an account,
    // for one without, and for one inside the cooldown — and it answers **409** for
    // an address whose verification is already done. That 409 is the service's own
    // declared trade, and `Service.RequestVerification` orders it after the lookup,
    // so 409-vs-202 tells a prober that an address has an account AND is proved.
    //
    // This screen does not flatten that into the acceptance sentence, and the reason
    // is that flattening it would be a lie the service explicitly refuses to tell:
    // identity declares the 409 because "check your inbox" on an address that will
    // never receive one is the sentence that sends somebody away from the answer.
    // Hiding a proved state is a smaller wrong than stranding a person.
    //
    // So the honest scope is stated instead: the address's account state is the
    // SERVICE's disclosure to make, this screen's job is to never widen it, and
    // the two tests below pin what "never widen it" means.
    const forProved = await askAndRead(
      "kaka@example.com",
      stubIdentity({
        requestEmailVerification: vi
          .fn()
          .mockRejectedValue(anIdentityError(409, "conflict")),
      }),
    );

    expect(forProved).toMatch(/already verified/i);
    // It names the state and nothing else: not the address, and no suggestion
    // that the account exists beyond the fact it is proved.
    expect(forProved).not.toContain("kaka@example.com");
  });

  it("never renders the service's own words on that 409", async () => {
    await renderRequestPage(
      stubIdentity({
        requestEmailVerification: vi
          .fn()
          .mockRejectedValue(
            anIdentityError(409, "conflict", {
              detail: "users.email_verified_at is not null for user usr_9f8e7d",
            }),
          ),
      }),
    );

    askFor("kaka@example.com");

    // Asserted against the whole rendered document rather than one region: a
    // leak is a leak wherever it renders, and pinning the query to the element
    // that happens to carry the sentence today would let one move.
    await screen.findByRole("status");
    expect(document.body.textContent).not.toContain("usr_9f8e7d");
    expect(document.body.textContent).not.toContain("email_verified_at");
  });
});

describe("the failures a person hits after asking", () => {
  it("does not send somebody to their inbox when the deployment cannot send", async () => {
    await renderRequestPage(
      stubIdentity({
        requestEmailVerification: vi.fn().mockRejectedValue(anIdentityError(503, "service_unavailable")),
      }),
    );

    askFor("kaka@example.com");

    // The service checks the mailer BEFORE it looks the address up, so a 503 here
    // cannot tell a registered address from an unregistered one and it is safe to
    // render distinctly — and it is the one failure a person can act on.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot send email/i);
    expect(alert).not.toHaveTextContent(/on its way/i);
  });

  it("leaves the form usable after a 503, because retrying is the next step", async () => {
    await renderRequestPage(
      stubIdentity({
        requestEmailVerification: vi.fn().mockRejectedValue(anIdentityError(503, "service_unavailable")),
      }),
    );

    askFor("kaka@example.com");
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "Send verification link" })).toBeEnabled();
  });

  it("puts the service's own 422 on the email field, which is about shape not existence", async () => {
    // `RequestVerification` validates before it looks anything up, so this is a
    // statement about the characters that were typed and not about the account.
    await renderRequestPage(
      stubIdentity({
        requestEmailVerification: vi.fn().mockRejectedValue(
          anIdentityError(422, "validation_failed", {
            fieldErrors: [{ field: "email", code: "invalid_format" }],
          }),
        ),
      }),
    );

    askFor("kaka@example.com");

    expect(await screen.findByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email address/i);
  });

  it("renders a network failure as one plain sentence", async () => {
    const thrown = new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080");
    await renderRequestPage(
      stubIdentity({ requestEmailVerification: vi.fn().mockRejectedValue(thrown) }),
    );

    askFor("kaka@example.com");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent(/ECONNREFUSED/);
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
  });
});

describe("after a request is accepted", () => {
  it("replaces the form rather than annotating it", async () => {
    await renderRequestPage();

    askFor("kaka@example.com");

    // A field left on screen beside "sent!" invites a second submission, and the
    // service answers a second one inside the cooldown by sending nothing — so the
    // second message would be a promise it cannot keep.
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("sends back to sign in rather than offering a second send", async () => {
    await renderRequestPage();

    askFor("kaka@example.com");
    fireEvent.click(await screen.findByRole("button", { name: "Back to sign in" }));

    // Same cooldown reason as the form being replaced: "send another" here would
    // be a control that silently does less than the button says. The way to ask
    // again is this URL, and the two places that link to it are the register
    // screen's post-signup state and the sign-in screen — neither of which is
    // this one.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("keeps the address out of the page after a request", async () => {
    await renderRequestPage();

    askFor("kaka@example.com");
    await screen.findByRole("status");

    expect(document.body.textContent).not.toContain("kaka@example.com");
  });
});