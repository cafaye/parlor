import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VerifyEmailConfirmPage from "./page";
import { createTokenStore } from "@/lib/token-store";
import { aUser, anIdentityError, stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

/**
 * The token a real verification link carries.
 *
 * `RECOVERY_LINK_TEMPLATE` is deployment configuration and every example in
 * identity spells it `?token={token}`, rendered by `internal/courier`'s
 * `LinkTemplate` for a `verify_email` message — which courier delivers as its
 * `welcome` type, because its `NotificationType` has no `email_verification`.
 * The value is a real shape: courier renders 256 bits of base62.
 */
const TOKEN = "0Kq3Zs1oQw7bXn0K9dLpR2vT4yE6hJ8cF1gM5nA2qU0";

const verifyOk = () => vi.fn(async () => undefined);

const SESSION_TOKEN = "tok_signed_in_for_the_verification_tests";

/**
 * Sign in the way the app does.
 *
 * Through the store rather than `localStorage.setItem`, because the store writes
 * a JSON envelope and reads one back. Writing the bare token string makes `get()`
 * fail its parse and return null — which renders as a *signed-out* tree, so the
 * signed-in assertions below would pass while testing the signed-out branch.
 */
function signIn() {
  createTokenStore().set(SESSION_TOKEN);
}

/** A signed-in stub: `me` answers, which is what resolves the session to `authed`. */
function signedIn() {
  return stubIdentity({
    me: vi.fn(async () => aUser()),
    redeemEmailVerification: verifyOk(),
  });
}

/**
 * `NO_TOKEN` rather than `undefined` as the default sentinel.
 *
 * A default parameter of `token: string | undefined = TOKEN` fires on an EXPLICIT
 * `undefined` too, so the one call site that means "render this page with no
 * token in the URL" would silently get a token and render the button. The absence
 * has to be a value the default cannot swallow.
 */
const NO_TOKEN = Symbol("no token in the query string");

async function renderConfirmPage(
  token: string | typeof NO_TOKEN = TOKEN,
  identity = stubIdentity({ redeemEmailVerification: verifyOk() }),
) {
  const searchParams = token === NO_TOKEN ? {} : { token: token as unknown as string };
  const result = renderWithProviders(
    await VerifyEmailConfirmPage({ searchParams: Promise.resolve(searchParams) }),
    { identity },
  );
  return { identity, ...result };
}

function verify() {
  fireEvent.click(screen.getByRole("button", { name: "Verify my email" }));
}

/** The unusable-link state, reached with a real 404 from a stubbed service. */
async function renderUnusable() {
  await renderConfirmPage(
    TOKEN,
    stubIdentity({
      redeemEmailVerification: vi.fn().mockRejectedValue(anIdentityError(404, "not_found")),
    }),
  );
  verify();
  await screen.findByRole("alert");
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

afterEach(cleanup);

/**
 * `/verify-email/confirm` — the page a verification mail's link lands on.
 *
 * The half of the surface that costs somebody nothing to get wrong: a 204 changes
 * no credential, so every failure here is recoverable by asking for a new link
 * and every success leaves the reader exactly where they were, still signed in.
 */
describe("the confirmation screen", () => {
  it("names itself", async () => {
    await renderConfirmPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/verify your email/i);
  });

  it("does not verify on load, because a link preview would spend the token", async () => {
    // Mail clients, chat apps and link scanners fetch a URL to preview it. A
    // verify-on-load screen would confirm an address nobody clicked anything for,
    // and leave the link dead for the person who then did click it.
    const identity = stubIdentity({ redeemEmailVerification: verifyOk() });

    await renderConfirmPage(TOKEN, identity);

    expect(identity.redeemEmailVerification).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Verify my email" })).toBeTruthy();
  });

  it("posts the token from the URL and nothing else", async () => {
    const identity = stubIdentity({ redeemEmailVerification: verifyOk() });

    await renderConfirmPage(TOKEN, identity);
    verify();

    await waitFor(() => {
      expect(identity.redeemEmailVerification).toHaveBeenCalledWith({ token: TOKEN });
    });
  });

  it("keeps its name while it is busy, so it stays findable by voice", async () => {
    let resolve: () => void = () => {};
    const redeemEmailVerification = vi.fn(
      () => new Promise<void>((settle) => (resolve = settle)),
    );
    await renderConfirmPage(TOKEN, stubIdentity({ redeemEmailVerification }));

    verify();

    // `disabled` + `aria-busy`, never a renamed control: a button that became
    // "Verifying…" mid-interaction loses the name somebody navigated by.
    const button = screen.getByRole("button", { name: "Verify my email" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();

    resolve();
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  });

  it("does not submit twice on a double submit", async () => {
    // The token is single-use, so a second call is a guaranteed 404 that would
    // replace a working confirmation with "this link cannot be used".
    let resolve: () => void = () => {};
    const redeemEmailVerification = vi.fn(
      () => new Promise<void>((settle) => (resolve = settle)),
    );
    await renderConfirmPage(TOKEN, stubIdentity({ redeemEmailVerification }));

    verify();
    verify();
    verify();

    expect(redeemEmailVerification).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  });
});

/**
 * A 204 from `RedeemVerification`.
 *
 * **It revokes nothing and mints nothing**, which is the difference from a reset
 * redemption and the reason the destination below is not "sign in again". The
 * account could already sign in with exactly the same password before this click
 * and still can after it, so a reader who was signed in stays signed in.
 */
describe("a verified address", () => {
  it("says the address is verified", async () => {
    await renderConfirmPage();

    verify();

    expect(await screen.findByRole("status")).toHaveTextContent(/verified/i);
  });

  it("sends a signed-out reader to sign in, which is the only route forward", async () => {
    await renderConfirmPage();

    verify();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("sends a signed-in reader into the app instead of a sign-in form", async () => {
    // The property that distinguishes this flow from the reset one. A verification
    // revokes nothing, so a reader who was signed in when they clicked is still
    // signed in — and a success state that said "sign in again" would be telling
    // them to do a thing they do not need, on a screen whose whole claim is that
    // confirming an address changes nothing.
    signIn();
    await renderConfirmPage(TOKEN, signedIn());

    verify();
    fireEvent.click(await screen.findByRole("button", { name: "Continue to your accounts" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/accounts"));
  });

  it("never asks a signed-in reader to sign in", async () => {
    signIn();
    await renderConfirmPage(TOKEN, signedIn());

    verify();

    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("does not claim a mail was sent, because none was", async () => {
    // This route sends nothing. A sentence borrowed from the request screen would
    // send somebody to an inbox for a mail this click did not cause.
    await renderConfirmPage();

    verify();
    await screen.findByRole("status");

    expect(document.body.textContent).not.toMatch(/on its way|check your inbox/i);
  });
});

/**
 * ---------------------------------------------------------------------------
 * THE STALE-TOKEN STATE
 * ---------------------------------------------------------------------------
 *
 * `ErrTokenNotFound` is ONE sentinel covering four cases — never existed,
 * expired, already spent, minted for another flow — and there is no honest way to
 * tell them apart. Every assertion below is about the same sentence being the
 * answer to all four, and about it never speculating which one it was.
 */
describe("a link that cannot be used", () => {
  it("says the link cannot be used, for a 404", async () => {
    await renderUnusable();

    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be used/i);
  });

  it("never says a 404 link expired, which would confirm the token was real", async () => {
    // Naming "expired" turns a guess into a probe: it tells anybody testing
    // tokens that the one they held had once been a good one.
    await renderUnusable();

    expect(screen.getByRole("alert")).not.toHaveTextContent(/expired/i);
  });

  it("never says the link was already used, for the same reason", async () => {
    await renderUnusable();

    // The other three names are refused for the same reason as "expired": each one
    // narrows four cases to one, and a person probing tokens learns from the
    // narrowing.
    expect(screen.getByRole("alert")).not.toHaveTextContent(/already been used|already used/i);
  });

  it("offers a new link as a control that goes somewhere real", async () => {
    await renderUnusable();

    fireEvent.click(screen.getByRole("button", { name: "Request a new link" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/verify-email"));
  });

  it("keeps the token out of the rendered page on a failure", async () => {
    // The token is in the URL and must not be copied into anything a person reads
    // or a screenshot captures.
    await renderUnusable();

    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("does not render the service's detail, which is where an internal code lives", async () => {
    await renderConfirmPage(
      TOKEN,
      stubIdentity({
        redeemEmailVerification: vi.fn().mockRejectedValue(
          anIdentityError(404, "not_found", {
            detail: "recovery_tokens lookup failed on shard 3",
          }),
        ),
      }),
    );
    verify();

    expect(await screen.findByRole("alert")).not.toHaveTextContent(/shard/);
  });

  it("explains a link with no token in it, and offers a new one", async () => {
    // `RECOVERY_LINK_TEMPLATE` is deployment configuration: a deployment can put
    // the credential in a path segment, and then this screen has nothing to read.
    // That is a state with a way forward, not an exception.
    await renderConfirmPage(NO_TOKEN);

    expect(screen.getByRole("alert")).toHaveTextContent(/missing its verification code/i);
    expect(screen.queryByRole("button", { name: "Verify my email" })).toBeNull();
    expect(screen.getByRole("button", { name: "Request a new link" })).toBeTruthy();
  });

  it("does not post anything when there is no token to post", async () => {
    const identity = stubIdentity({ redeemEmailVerification: verifyOk() });

    await renderConfirmPage(NO_TOKEN, identity);

    expect(identity.redeemEmailVerification).not.toHaveBeenCalled();
  });
});

describe("the other failures after the button", () => {
  it("renders a truncated token as the same unusable link as any other dead one", async () => {
    // The document says `minLength: 43` and lists a 422. A running identity was
    // asked with `{"token":"too-short"}` and answered **404** — `RedeemVerification`
    // goes straight to `tokens.Live(digest)` and `tokenRequest` validates nothing —
    // so a link a mail client cut in half is one of the dead ones and gets one
    // sentence. This test pins that it is not a special case with its own wording.
    await renderConfirmPage(
      "too-short",
      stubIdentity({
        redeemEmailVerification: vi.fn().mockRejectedValue(anIdentityError(404, "not_found")),
      }),
    );

    verify();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot be used/i);
    // Same way forward as the other three cases behind the one sentinel.
    expect(screen.getByRole("button", { name: "Request a new link" })).toBeTruthy();
  });

  it("renders a network failure as one plain sentence", async () => {
    const thrown = new TypeError("Failed to fetch. ECONNREFUSED 10.0.0.4:8080");
    await renderConfirmPage(
      TOKEN,
      stubIdentity({ redeemEmailVerification: vi.fn().mockRejectedValue(thrown) }),
    );

    verify();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent(/ECONNREFUSED/);
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4/);
  });
});