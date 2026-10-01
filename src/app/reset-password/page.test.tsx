import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ResetPasswordPage from "./page";
import { anIdentityError, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

/**
 * The token a real link carries.
 *
 * `RECOVERY_LINK_TEMPLATE` is deployment configuration, and every example in
 * identity spells it `https://…/reset?token={token}` — which is why this page
 * reads `token` out of the query string. The value here is a real shape: courier
 * renders a 256-bit base62 token.
 */
const TOKEN = "0Kq3Zs1oQw7bXn0K9dLpR2vT4yE6hJ8cF1gM5nA2qU0";
const NEW_PASSWORD = "a brand new password";

const redeemOk = () => vi.fn(async () => undefined);

/**
 * `NO_TOKEN` rather than `undefined` as the default sentinel.
 *
 * A default parameter of `token: string | undefined = TOKEN` fires on an
 * EXPLICIT `undefined` too, so the one call site that means "render this page
 * with no token in the URL" would silently get a token and render the form. The
 * absence has to be a value the default cannot swallow.
 */
const NO_TOKEN = Symbol("no token in the query string");

async function renderResetPage(
  token: string | typeof NO_TOKEN = TOKEN,
  identity = stubIdentity(),
) {
  const searchParams =
    token === NO_TOKEN ? {} : { token: token as unknown as string };
  const result = renderWithProviders(
    await ResetPasswordPage({ searchParams: Promise.resolve(searchParams) }),
    { identity },
  );
  return { identity, ...result };
}

function typePair(password: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirmation },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}

/**
 * `/reset-password`.
 *
 * Five states, each one a thing a real person hits: a working link, a link that
 * was already spent or has expired, a password the service will not take, a
 * deployment that cannot send, and a network that is down. None of them is a
 * blank screen and none of them is a raw fetch error.
 */
beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

afterEach(cleanup);

describe("the reset screen", () => {
  it("names itself", async () => {
    await renderResetPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/new password/i);
  });

  it("says the link works once, because it does", async () => {
    await renderResetPage();

    expect(screen.getByText(/works once/i)).toBeTruthy();
  });

  it("asks for the password as a NEW one, so a manager offers to generate it", async () => {
    // `current-password` here would be a password manager offering to fill in the
    // password somebody is trying to replace.
    await renderResetPage();

    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("does not redeem on load, because a link preview would spend the token", async () => {
    const identity = stubIdentity({ redeemPasswordReset: redeemOk() });

    await renderResetPage(TOKEN, identity);

    // Mail clients, chat apps and link scanners fetch a URL to preview it. A
    // redeem-on-load screen would set somebody's password before they chose one,
    // and leave the link dead for the person who then clicked it.
    expect(identity.redeemPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy();
  });
});

describe("spending the link", () => {
  it("posts the token from the URL with the new password", async () => {
    const identity = stubIdentity({ redeemPasswordReset: redeemOk() });

    await renderResetPage(TOKEN, identity);
    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    await waitFor(() => {
      expect(identity.redeemPasswordReset).toHaveBeenCalledWith({
        token: TOKEN,
        password: NEW_PASSWORD,
      });
    });
  });

  it("returns to sign in saying the password changed", async () => {
    const identity = stubIdentity({ redeemPasswordReset: redeemOk() });

    await renderResetPage(TOKEN, identity);
    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    // The 204 mints no session — redeeming revokes every session the account
    // holds — so signing in again is the only route forward, and the sign-in
    // screen needs to say why it is being asked for the new password.
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/login?password-changed=1");
    });
  });

  it("does not submit a second time on a double submit", async () => {
    // The token is single-use, so a second call is guaranteed to 404 and would
    // replace a working page with "this link cannot be used".
    let resolve: () => void = () => {};
    const redeemPasswordReset = vi.fn(
      () => new Promise<void>((settle) => (resolve = settle)),
    );
    await renderResetPage(TOKEN, stubIdentity({ redeemPasswordReset }));

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();
    submit();
    submit();

    expect(redeemPasswordReset).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("refuses a mismatched pair without asking the service", async () => {
    const identity = stubIdentity({ redeemPasswordReset: redeemOk() });

    await renderResetPage(TOKEN, identity);
    typePair(NEW_PASSWORD, `${NEW_PASSWORD}x`);
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(identity.redeemPasswordReset).not.toHaveBeenCalled();
  });

  it("refuses a short password without asking the service", async () => {
    const identity = stubIdentity({ redeemPasswordReset: redeemOk() });

    await renderResetPage(TOKEN, identity);
    typePair("short", "short");
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(identity.redeemPasswordReset).not.toHaveBeenCalled();
  });
});

describe("a link that cannot be used", () => {
  it("says the link is unusable and offers a new one, for a 404", async () => {
    // One 404 covers a token that never existed, one that expired, one already
    // spent, and one belonging to another flow. The screen says one sentence for
    // all four because there is no honest way to tell them apart.
    await renderResetPage(
      TOKEN,
      stubIdentity({
        redeemPasswordReset: vi.fn().mockRejectedValue(anIdentityError(404, "not_found")),
      }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be used/i);
    expect(screen.getByRole("button", { name: "Request a new link" })).toBeTruthy();
  });

  it("never says a 404 link expired, which would confirm the token was real", async () => {
    await renderResetPage(
      TOKEN,
      stubIdentity({
        redeemPasswordReset: vi.fn().mockRejectedValue(anIdentityError(404, "not_found")),
      }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    const alert = await screen.findByRole("alert");
    // Naming "expired" would turn a guess into a probe: it would tell a person
    // probing tokens that the one they held had once been good.
    expect(alert).not.toHaveTextContent(/expired/i);
  });

  it("does not render the service's detail, which is where an internal code lives", async () => {
    await renderResetPage(
      TOKEN,
      stubIdentity({
        redeemPasswordReset: vi.fn().mockRejectedValue(
          anIdentityError(404, "not_found", { detail: "recovery_tokens lookup failed on shard 3" }),
        ),
      }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    expect(await screen.findByRole("alert")).not.toHaveTextContent(/shard/);
  });

  it("explains a link with no token in it, and offers a new one", async () => {
    // `RECOVERY_LINK_TEMPLATE` is deployment configuration: a deployment can put
    // the credential in a path segment, and then this screen has nothing to read.
    // That is a state with a way forward, not an exception.
    await renderResetPage(NO_TOKEN);

    expect(screen.getByRole("alert")).toHaveTextContent(/missing its reset code/i);
    expect(screen.getByRole("button", { name: "Request a new link" })).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("does not post anything when there is no token to post", async () => {
    const identity = stubIdentity({ redeemPasswordReset: redeemOk() });

    await renderResetPage(undefined, identity);

    expect(identity.redeemPasswordReset).not.toHaveBeenCalled();
  });
});

describe("the failures a person hits after the form", () => {
  it("puts the service's own weak-password 422 on the password field", async () => {
    // The service validates before it hashes, so a short value comes back as a
    // `{field: "password", code: "too_short"}` rather than as a sentence.
    await renderResetPage(
      TOKEN,
      stubIdentity({
        redeemPasswordReset: vi.fn().mockRejectedValue(
          anIdentityError(422, "validation_failed", {
            fieldErrors: [{ field: "password", code: "too_short" }],
          }),
        ),
      }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    expect(await screen.findByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    // And the form is still usable: the token was not spent.
    expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy();
  });

  it("does not send somebody to their inbox when the deployment cannot send", async () => {
    await renderResetPage(
      TOKEN,
      stubIdentity({
        redeemPasswordReset: vi.fn().mockRejectedValue(anIdentityError(503, "service_unavailable")),
      }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot send email/i);
    expect(alert).not.toHaveTextContent(/inbox/i);
  });

  it("renders a network failure as one plain sentence", async () => {
    const thrown = new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080");
    await renderResetPage(
      TOKEN,
      stubIdentity({ redeemPasswordReset: vi.fn().mockRejectedValue(thrown) }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent(/ECONNREFUSED/);
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
  });

  it("keeps the token out of the rendered page on a failure", async () => {
    // The token is in the URL and must not be copied into anything a person reads
    // or a screenshot captures.
    await renderResetPage(
      TOKEN,
      stubIdentity({
        redeemPasswordReset: vi.fn().mockRejectedValue(anIdentityError(404, "not_found")),
      }),
    );

    typePair(NEW_PASSWORD, NEW_PASSWORD);
    submit();

    await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain(TOKEN);
  });
});