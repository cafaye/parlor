import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BoxesPage from "./page";
import type { Box, BoxClient } from "@/lib/box";
import { BoxError } from "@/lib/box";
import { aBoxCapability, aBoxError, aBox, stubBox } from "@/test/support/box";
import { anAccountListItem } from "@/test/support/tenancy";
import { aUser, anIdentityError, stubIdentity } from "@/test/support/identity";
import { createTokenStore } from "@/lib/token-store";
import { renderWithProviders } from "@/test/support/render";
import { ENROLL_COMMAND } from "./enroll-capability";
import { INSTALL_BLOCK } from "./install-inputs";

/**
 * `/boxes` — installations with status and phase.
 *
 * The screen's data is two reads that never touch a socket: the identity
 * accounts list and, per account, Box's member-scoped boxes read. Both
 * clients are stubs, so every assertion here is about what the screen does
 * with an answer and not about whether it can get one.
 */

const TOKEN = "tok_abc";

/**
 * A promise plus the handle that settles it — written as an object rather
 * than a bare `let` because TypeScript narrows a `let` initialised to null
 * and never widens it, so the call site ends up with `release?: never`.
 */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** A signed-in stub whose account list is whatever `accounts` says. */
/**
 * The accounts a caller belongs to. The id is a uuid because the
 * forwarder value-matches the account segment as one, and a screen that
 * passed anything else would be refused before Box was contacted.
 */
const ACCOUNT = { id: "8f2c1a44-0000-4000-8000-000000000001", name: "Acme Corp" };

function signedIn(accounts = [anAccountListItem(ACCOUNT)], overrides = {}) {
  return stubIdentity({
    me: vi.fn(() => Promise.resolve(aUser())),
    listAccounts: vi.fn(() => Promise.resolve(accounts)),
    ...overrides,
  });
}

describe("BoxesScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // A signed-in tree needs two things: a token in the store and a scripted
    // `me()` — the token is what the session query and every tenancy call are
    // keyed on, so a test that set the stub and left this out would fail on
    // the session rather than on anything about the screen.
    createTokenStore().set(TOKEN);
  });

  it("shows the installations with the service's own status and phase words", async () => {
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() =>
          Promise.resolve([
            aBox({ status: "active", current_phase: "complete" }),
            aBox({
              id: 4,
              box_id: "9a3c1b22-0000-4000-8000-000000000003",
              status: "enrolling",
              current_phase: "pending",
            }),
          ]),
        ),
      }),
      tokens: undefined,
    });

    expect(await screen.findByText("8f2c1a44…")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    // The second row is the state a reader has to understand: a capability
    // is live and the box has not enrolled.
    expect(screen.getByText("Enrolling")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(
      screen.getByText("A capability is live for this box and it has not enrolled yet."),
    ).toBeTruthy();
  });

  it("shows an empty state when no account has a box", async () => {
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({ listBoxes: vi.fn(() => Promise.resolve([])) }),
      tokens: undefined,
    });

    expect(await screen.findByText("No boxes yet")).toBeTruthy();
  });

  it("renders the list failure as its own sentence, with a retry", async () => {
    const listBoxes = vi.fn(() => Promise.reject(aBoxError(503, "unavailable")));
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({ listBoxes }),
      tokens: undefined,
    });

    expect(await screen.findByText("We could not load your boxes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(listBoxes).toHaveBeenCalledTimes(2));
  });

  it("says nothing is configured when this deployment runs no Box", async () => {
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.reject(aBoxError(503, "box_not_configured"))),
      }),
      tokens: undefined,
    });

    expect(await screen.findByText("Boxes are not configured on this deployment.")).toBeTruthy();
  });

  it("shows a signed-out visitor the sign-in state", async () => {
    renderWithProviders(<BoxesPage />, {
      identity: stubIdentity({
        me: vi.fn(() => Promise.reject(anIdentityError(401, "unauthenticated"))),
        listAccounts: vi.fn(() => Promise.resolve([])),
      }),
      box: stubBox(),
    });

    // No token in the store means no session to exchange, so the screen's
    // own signed-out branch is the state a visitor gets.
    expect(await screen.findByText("Sign in to see your boxes")).toBeTruthy();
  });

  it("keeps loading until the per-account read settles", async () => {
    const gate = deferred<Box[]>();
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({ listBoxes: vi.fn(() => gate.promise) }),
      tokens: undefined,
    });

    expect(await screen.findByText("Loading your boxes…")).toBeTruthy();
    gate.settle([aBox()]);
    expect(await screen.findByText("8f2c1a44…")).toBeTruthy();
  });

  it("names the account each box belongs to", async () => {
    renderWithProviders(<BoxesPage />, {
      identity: signedIn([anAccountListItem({ ...ACCOUNT, name: "Acme" })]),
      box: stubBox({ listBoxes: vi.fn(() => Promise.resolve([aBox()])) }),
    });

    expect(await screen.findByText("Acme")).toBeTruthy();
  });

  it("renders no control that acts on a box — the list is read-only", async () => {
    // The box acts on a capability, never the reverse. A control in these rows
    // that could disable, enroll or decommission a box would be an action on a
    // machine this screen has no authority over, so the assertion is the
    // absence of every button in the rendered rows. A link would be the detail
    // route, which does not exist yet and is absent rather than disabled.
    //
    // SCOPED TO THE LIST, and that is the whole point of the scoping. The page
    // above carries copy buttons for the two paths — which ARE controls, and
    // are supposed to be there — so a document-wide assertion would now fail
    // on the affordance that replaced the dashboard framing rather than on
    // anything a row does.
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({ listBoxes: vi.fn(() => Promise.resolve([aBox()])) }),
    });

    expect(await screen.findByText(/Active|Enrolling|Disabled/)).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Your boxes" }));
    expect(rows.queryByRole("button")).not.toBeInTheDocument();
    expect(rows.queryByRole("link")).not.toBeInTheDocument();
  });
});

/**
 * The two paths, from the 2026-10-15 decision.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE GUARD
 * ---------------------------------------------------------------------------
 * `/box` leads with the two ways in and the boxes list sits under them, so
 * the page has two audiences and both are asserted: a signed-out visitor, who
 * is the reason the paths lead at all and who used to open this route on
 * "sign in to see your boxes", and a signed-in one, who gets the paths AND the
 * list. The list is the visual confirmation now; it is not the front door.
 *
 * The commands are the decision's fixed names, so a test that renders them is
 * also a test that the page did not invent a verb of its own. Every string
 * below is one a person types.
 */
describe("BoxesPage, the two paths", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createTokenStore().set(TOKEN);
  });

  const ANONYMOUS = {
    identity: stubIdentity({
      me: vi.fn(() => Promise.reject(anIdentityError(401, "unauthenticated"))),
      listAccounts: vi.fn(() => Promise.resolve([])),
    }),
    box: stubBox(),
  };

  it("shows both paths, with their commands, to a signed-out visitor", async () => {
    renderWithProviders(<BoxesPage />, ANONYMOUS);

    // The heading is the front door's, not the dashboard's.
    expect(await screen.findByRole("heading", { level: 1, name: "Cafaye Box" })).toBeTruthy();

    // Hosted: the sentence, then the two commands that take it.
    expect(screen.getByRole("heading", { name: "Use hosted — 30 seconds, free" })).toBeTruthy();
    expect(
      screen.getByText("You need api.cafaye.com and a key, and nothing else, to start.", {
        // The sentence shares its paragraph with the signup link, so the
        // element's own text nodes are the sentence and the trailing period
        // only. A substring match reads what a reader reads.
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "CAF_IDENTITY_URL=https://api.cafaye.com cafe login --email you@example.com --password-stdin",
      ),
    ).toBeTruthy();
    expect(screen.getByText("cafe add pantry/identity")).toBeTruthy();

    // Your box: the ownership sentence, the generator, the complete block,
    // and the enrollment.
    expect(screen.getByRole("heading", { name: "Deploy to your box — you own it" })).toBeTruthy();
    expect(screen.getByText("You own the box, and your data is not with us.")).toBeTruthy();
    // The generator, as its copyable command, and the sentence saying what
    // it generates. The sentence names the command too, so the command
    // itself is asserted through the control that copies it.
    expect(
      screen.getByRole("button", { name: "Copy cafe box init" }),
    ).toBeTruthy();
    // Not the bare one-liner: the walk proved it cannot complete an install,
    // so the card renders the whole parameterized block `cafe box init`
    // prints — required exports live, the rest commented, every meaning
    // beside its value.
    expect(
      screen.getByText("it generates the complete install block below", { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/export KIT_SUBSTRATE_ACME_EMAIL=/, { exact: false }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/# export KIT_SUBSTRATE_KUBECONFIG=/, { exact: false }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/curl -fsSL https:\/\/cafaye\.com\/box\/install \| bash/, {
        exact: false,
      }).length,
    ).toBeGreaterThanOrEqual(1);
    // The enroll is no longer a static placeholder: the mint is member-scoped,
    // so a signed-out visitor is invited to sign in first. The minted flow is
    // asserted in the capability-mint describe block below.
    expect(screen.getByText("to mint the enrollment token your box needs.", { exact: false })).toBeTruthy();
    // Two sign-in links now: the mint invitation in the "Your box" path and
    // the boxes list's own below it. Both go to the same place.
    for (const link of screen.getAllByRole("link", { name: "Sign in" })) {
      expect(link.getAttribute("href")).toBe("/login");
    }

    // And the hosted signup route, which is the other half of that path.
    expect(screen.getByRole("link", { name: "Create your hosted account" }).getAttribute("href")).toBe(
      "/register",
    );
  });

  it("keeps the paths above the list, and the list, for a signed-in visitor", async () => {
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([aBox({ status: "active", current_phase: "complete" })])),
      }),
    });

    // Both paths first.
    expect(await screen.findByRole("heading", { name: "Use hosted — 30 seconds, free" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Deploy to your box — you own it" })).toBeTruthy();

    // Then the list — the visual confirmation, under them.
    expect(screen.getByRole("heading", { level: 2, name: "Your boxes" })).toBeTruthy();
    expect(await screen.findByText("8f2c1a44…")).toBeTruthy();
    expect(screen.getByText("The install finished on this box.")).toBeTruthy();

    // "Below" is asserted on the document and not on the reading of it, because
    // the whole point of this packet is the ORDER: the paths lead, the list
    // confirms. A page that rendered the list first would still satisfy every
    // assertion above it.
    const paths = screen.getByRole("region", { name: "Two ways in" });
    const boxes = screen.getByRole("region", { name: "Your boxes" });
    expect(boxes.compareDocumentPosition(paths) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("does not render the list to a signed-out visitor", async () => {
    renderWithProviders(<BoxesPage />, ANONYMOUS);

    expect(await screen.findByText("Sign in to see your boxes")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Your boxes" })).not.toBeInTheDocument();
  });

  it("links to the install script the block downloads", async () => {
    renderWithProviders(<BoxesPage />, ANONYMOUS);

    // The audit path: the block's last line downloads `/box/install`, and the
    // line under the block links to those bytes rather than restating a
    // command that could drift from what they install.
    const script = await screen.findByRole("link", { name: "Read the install script" });
    expect(script.getAttribute("href")).toBe("/box/install");
  });

  it("copies a command from a control that names what it copies", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      renderWithProviders(<BoxesPage />, ANONYMOUS);

      // The accessible name carries the command, because four controls called
      // "Copy" are four controls a person navigating by name cannot tell
      // apart. It starts with the visible word, so label-in-name still holds.
      const copyLogin = await screen.findByRole("button", {
        name: "Copy CAF_IDENTITY_URL=https://api.cafaye.com cafe login --email you@example.com --password-stdin",
      });
      expect(copyLogin).toHaveTextContent("Copy");
      expect(copyLogin).not.toHaveTextContent("Copied");

      fireEvent.click(copyLogin);
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          "CAF_IDENTITY_URL=https://api.cafaye.com cafe login --email you@example.com --password-stdin",
        ),
      );

      // Confirmed by the label changing, and by the name NOT changing: a
      // control that renamed itself would lose the name it was just found by.
      await waitFor(() => expect(copyLogin).toHaveTextContent("Copied"));
      expect(
        screen.getByRole("button", {
          name: "Copy CAF_IDENTITY_URL=https://api.cafaye.com cafe login --email you@example.com --password-stdin",
        }),
      ).toBe(copyLogin);

      fireEvent.click(await screen.findByRole("button", { name: "Copy the install block" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(INSTALL_BLOCK));
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      writeText.mockClear();
    }
  });

  it("marks required, optional and default inputs the way the installer reads them", async () => {
    renderWithProviders(<BoxesPage />, ANONYMOUS);

    // The block teaches the refusal order: live exports for what the
    // installer refuses without, comments for the rest. One block on the
    // card — the copy button that carries it is unique.
    expect(await screen.findByRole("button", { name: "Copy the install block" })).toBeTruthy();
    expect(
      screen.getByText("the installer refuses, one per run, without each of these", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/export KIT_SUBSTRATE_SMTP_PASSWORD=/, { exact: false }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/# export KIT_SUBSTRATE_APP_BASE_URL=/, { exact: false }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      // The matcher normalizes whitespace, so the block's three-space
      // indent reads as one — which is also why this cannot be confused
      // with an optional `# export …` line.
      screen.getAllByText(/# KIT_SUBSTRATE_SMTP_PORT=587/, { exact: false }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The capability mint on `/box` — the missing step of the box journey.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE GUARD
 * ---------------------------------------------------------------------------
 * The "Your box" path used to end at `cafe box enroll --token <capability>`
 * with nowhere the capability came from. The mint below is member-scoped, so
 * the page has two answers and both are asserted: a signed-out visitor gets
 * one sentence and a sign-in link (never a mock of the minted state), and a
 * signed-in one gets a button that mints for a fresh box id and shows the
 * token once with its expiry and the two commands ready to paste. The token
 * is fed over stdin — it never appears in argv — and a failed mint names its
 * cause rather than spinning forever.
 */
describe("BoxesPage, the capability mint", () => {
  const UUID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  beforeEach(() => {
    window.localStorage.clear();
    createTokenStore().set(TOKEN);
  });

  function signedOutWithMint(mint: BoxClient["mintBoxCapability"]) {
    return {
      identity: stubIdentity({
        me: vi.fn(() => Promise.reject(anIdentityError(401, "unauthenticated"))),
        listAccounts: vi.fn(() => Promise.resolve([])),
      }),
      box: stubBox({ mintBoxCapability: mint }),
    };
  }

  it("invites a signed-out visitor to sign in first, and mints nothing", async () => {
    const mint = vi.fn(() => Promise.resolve(aBoxCapability()));
    renderWithProviders(<BoxesPage />, signedOutWithMint(mint));

    // Scoped to the two paths: the boxes list below carries its own
    // sign-in link, so a document-wide query would pass on that one while
    // this path silently lost its invitation.
    const paths = screen.getByRole("region", { name: "Two ways in" });
    const island = within(paths);
    expect(
      await island.findByText("to mint the enrollment token your box needs.", { exact: false }),
    ).toBeTruthy();
    const links = island.getAllByRole("link", { name: "Sign in" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/login");
    // No mock of the minted state: no button, no token, no command.
    expect(island.queryByRole("button", { name: /mint/i })).not.toBeInTheDocument();
    expect(screen.queryByText("cap_fixture_enrollment_token")).not.toBeInTheDocument();
    expect(mint).not.toHaveBeenCalled();
  });

  it("mints for a new box id and shows the box id, the once-shown token, its expiry and both commands", async () => {
    const capability = aBoxCapability();
    const mint = vi.fn(() => Promise.resolve(capability));
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: mint,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Mint an enrollment token" }));

    // The mint names a NEW box id: a uuid the screen generated, not one the
    // service invented, and the fixed enroll purpose is the client's contract
    // (asserted in box.test.ts), not this screen's.
    expect(mint).toHaveBeenCalledTimes(1);
    const calls = mint.mock.calls as unknown as [string, string, string][];
    const [sessionToken, accountId, boxId] = calls[0];
    expect(sessionToken).toBe(TOKEN);
    expect(accountId).toBe(ACCOUNT.id);
    expect(boxId).toMatch(UUID_PATTERN);

    // In order and labeled: the box id, the token shown once with its expiry
    // and the single-use sentence, then the enroll ready to paste. The
    // install is not repeated here — the complete block sits directly above
    // the island — so the minted view points at it and carries one block, not
    // two.
    expect(await screen.findByText(capability.box_id)).toBeTruthy();
    expect(screen.getAllByText(capability.token)).toHaveLength(1);
    expect(
      screen.getByText(`expires at ${new Date(capability.expires_at as string).toLocaleString()}`, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.getByText("can be used once", { exact: false })).toBeTruthy();
    expect(screen.getByText("The install block above already carries every value", {
      exact: false,
    })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the install block" })).toBeTruthy();
    expect(screen.getByText(ENROLL_COMMAND)).toBeTruthy();
    // The token is fed over stdin: the enroll command carries `--token -`,
    // never the token itself.
    expect(ENROLL_COMMAND).toContain("--token -");
    expect(ENROLL_COMMAND).not.toContain(capability.token);
    expect(screen.getByText("Minted under Acme Corp", { exact: false })).toBeTruthy();
  });

  it("mints again on regenerate and says the old token expires on its own", async () => {
    const mint = vi
      .fn()
      .mockResolvedValueOnce(aBoxCapability({ token: "cap_first_token" }))
      .mockResolvedValueOnce(
        aBoxCapability({ token: "cap_second_token", box_id: "8f2c1a44-0000-4000-8000-000000000008" }),
      );
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: mint,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Mint an enrollment token" }));
    expect(await screen.findByText("cap_first_token")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mint a new token" }));
    expect(await screen.findByText("cap_second_token")).toBeTruthy();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(screen.getByText("the old one expires on its own", { exact: false })).toBeTruthy();
  });

  it("renders an expired session as sign-in-again, not a spinner", async () => {
    const mint = vi.fn(() => Promise.reject(aBoxError(401, "unauthenticated")));
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: mint,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Mint an enrollment token" }));

    expect(await screen.findByText("Your session expired")).toBeTruthy();
    expect(screen.getByText("Sign in again to mint a token", { exact: false })).toBeTruthy();
  });

  it("renders a refused mint with the service's own message", async () => {
    const mint = vi.fn(() =>
      Promise.reject(
        new BoxError("box is already enrolled", { status: 422, code: "unprocessable" }),
      ),
    );
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: mint,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Mint an enrollment token" }));

    expect(await screen.findByText("The mint was refused")).toBeTruthy();
    expect(screen.getByText("box is already enrolled")).toBeTruthy();
  });

  it("renders an unreachable service as a retryable error, and the retry mints again", async () => {
    const mint = vi.fn(() => Promise.reject(new Error("boom")));
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: mint,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Mint an enrollment token" }));

    expect(await screen.findByText("We could not mint a token.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
  });

  it("says boxes are not configured when the deployment runs no Box", async () => {
    const mint = vi.fn(() => Promise.reject(aBoxError(503, "box_not_configured")));
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: mint,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Mint an enrollment token" }));

    expect(await screen.findByText("Boxes are not configured on this deployment.")).toBeTruthy();
  });

  it("says the token WILL be minted before anything is, never that it was", async () => {
    // The caption used to read post-mint before anything was minted. A
    // stranger reading "Minted under …" beside a mint button reasonably
    // concludes there is already a token — there is not.
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: vi.fn(() => Promise.resolve(aBoxCapability())),
      }),
    });

    expect(await screen.findByRole("button", { name: "Mint an enrollment token" })).toBeTruthy();
    expect(screen.queryByText(/Minted under/, { exact: false })).not.toBeInTheDocument();
    expect(
      screen.getByText("The token will be minted under Acme Corp", { exact: false }),
    ).toBeTruthy();
  });

  it("names the agent CLI path beside the browser mint", async () => {
    // The island mints for a browser session; an agent mints from its own
    // CLI. Both end in the same stdin enroll, and the card says so in one
    // sentence rather than leaving the agent to guess the verb.
    renderWithProviders(<BoxesPage />, {
      identity: signedIn(),
      box: stubBox({
        listBoxes: vi.fn(() => Promise.resolve([])),
        mintBoxCapability: vi.fn(() => Promise.resolve(aBoxCapability())),
      }),
    });

    expect(await screen.findByRole("button", { name: "Mint an enrollment token" })).toBeTruthy();
    expect(screen.getByText("cafe box mint", { exact: false })).toBeTruthy();
  });
});
