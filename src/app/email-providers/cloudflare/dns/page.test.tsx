import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CloudflareDnsRecordsPage from "./page";
import { type EmailProviderConnection } from "@/lib/box";
import {
  anEmailProviderConnection,
  aDnsVerification,
  stubBox,
} from "@/test/support/box";
import { anAccountListItem } from "@/test/support/tenancy";
import { anIdentityError, aUser, stubIdentity } from "@/test/support/identity";
import { createTokenStore } from "@/lib/token-store";
import { renderWithProviders } from "@/test/support/render";

/**
 * `/email-providers/cloudflare/dns` — the records a customer publishes, and
 * the one explicit check.
 *
 * Three properties are held here, and each one was proved able to fail:
 *
 *  1. THE RECORDS RENDER, value for value. Not a link to Cloudflare's docs,
 *     not a description of a record — the name and the exact string a person
 *     pastes into their DNS provider. The red proof was replacing the rendered
 *     value with a hint ("see your DNS provider") and watching the value
 *     assertions fail.
 *  2. VERIFICATION IS EXPLICIT. Nothing calls the verify method until the
 *     button is pressed; a page-load check is what D10 postponed, and the
 *     test that holds it asserts the stub was not called after render.
 *  3. EACH OF THE THREE OUTCOMES RENDERS ITS OWN SENTENCE, and the `unknown`
 *     one renders the translated reason rather than the service's code.
 */

const TOKEN = "tok_abc";

/** A clipboard, stubbed on the jsdom global that has none. */
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

function renderDnsRecords({
  connections = [anEmailProviderConnection()],
  verify = vi.fn(() => Promise.resolve(aDnsVerification())),
}: {
  connections?: EmailProviderConnection[];
  verify?: () => Promise<ReturnType<typeof aDnsVerification>>;
} = {}) {
  return renderWithProviders(<CloudflareDnsRecordsPage />, {
    identity: stubIdentity({
      me: vi.fn(() => Promise.resolve(aUser())),
      listAccounts: vi.fn(() => Promise.resolve([anAccountListItem()])),
    }),
    box: stubBox({
      listEmailProviderConnections: vi.fn(() => Promise.resolve(connections)),
      verifyEmailProviderConnection: verify,
    }),
  });
}

describe("CloudflareDnsRecordsScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createTokenStore().set(TOKEN);
  });

  it("renders every record with the name and value to publish", async () => {
    renderDnsRecords();

    // The SPF record's exact value, from Cloudflare's own documented set.
    expect(await screen.findByText("v=spf1 include:_spf.mx.cloudflare.net ~all")).toBeTruthy();
    // The three bounce MX hosts, one row each.
    expect(screen.getByText("route1.mx.cloudflare.net")).toBeTruthy();
    expect(screen.getByText("route2.mx.cloudflare.net")).toBeTruthy();
    expect(screen.getByText("route3.mx.cloudflare.net")).toBeTruthy();
    // The DKIM selector, and the DMARC policy.
    expect(screen.getByText("TXT · cf-bounce._domainkey.example.com")).toBeTruthy();
    expect(screen.getByText("v=DMARC1; p=none;")).toBeTruthy();
  });

  it("renders six rows for a complete record set, one per host and per policy", async () => {
    // Three MX rows, SPF, DKIM and DMARC. The row count is what keeps the
    // three bounce hosts from collapsing into one row reading "plus route2 and
    // route3": a customer pasting records off this screen has to paste six
    // rows, and the screen that says six is the screen that showed six.
    // Red proof: rendering a single MX record passed every value assertion
    // above and still left two hosts off the page.
    renderDnsRecords();
    await screen.findByText("route1.mx.cloudflare.net");

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(6);
  });

  it("says the DKIM record has no value yet rather than inventing one", async () => {
    renderDnsRecords({
      connections: [
        anEmailProviderConnection({ config: { zone_id: "z", from_address: "no-reply@example.com" } }),
      ],
    });

    expect(await screen.findByText(/Cloudflare issues one DKIM key per domain/)).toBeTruthy();
    expect(screen.getByText("No value reported yet — see the note above.")).toBeTruthy();
    // And no placeholder is on screen for a customer to paste.
    const { container } = renderDnsRecords();
    await screen.findByText(/Cloudflare issues one DKIM key per domain/);
    expect(container.textContent).not.toContain("p=…");
    expect(container.textContent).not.toContain("REPLACE");
  });

  it("does not check anything until the button is pressed", async () => {
    const verify = vi.fn(() => Promise.resolve(aDnsVerification()));
    renderDnsRecords({ verify });

    await screen.findByText("route1.mx.cloudflare.net");
    // D10's other half: a check on load is automated verification, which is
    // the thing recorded as post-launch. Red proof: moving this call into a
    // `useEffect` made the screen answer before anybody asked and this
    // assertion fail on the first render.
    expect(verify).not.toHaveBeenCalled();
  });

  it("checks when asked and renders verified", async () => {
    const verify = vi.fn(() => Promise.resolve(aDnsVerification({ state: "verified" })));
    renderDnsRecords({ verify });
    await screen.findByText("route1.mx.cloudflare.net");

    fireEvent.click(screen.getByRole("button", { name: "Check these records" }));

    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Every record is published and matches/),
    ).toBeTruthy();
  });

  it("renders not yet as a wait, with the propagation window named", async () => {
    const verify = vi.fn(() => Promise.resolve(aDnsVerification({ state: "not_yet" })));
    renderDnsRecords({ verify });
    await screen.findByText("route1.mx.cloudflare.net");

    fireEvent.click(screen.getByRole("button", { name: "Check these records" }));

    expect(await screen.findByText(/not every record is published yet/)).toBeTruthy();
    // The honest part: this is the expected state of a correct setup for its
    // first quarter hour, so the sentence names the window rather than
    // reporting a fault.
    expect(screen.getByText(/5 to 15 minutes/)).toBeTruthy();
  });

  it("renders couldn't check with the translated reason, never the service's code", async () => {
    const verify = vi.fn(() =>
      Promise.resolve(
        aDnsVerification({ state: "unknown", reason: "box_unreachable", checked_at: null }),
      ),
    );
    renderDnsRecords({ verify });
    await screen.findByText("route1.mx.cloudflare.net");

    fireEvent.click(screen.getByRole("button", { name: "Check these records" }));

    expect(await screen.findByText(/We could not complete the check/)).toBeTruthy();
    expect(screen.getByText(/we could not reach it/)).toBeTruthy();
    // The reason is a closed set the screen translates. A raw code in the DOM
    // is an internal identifier in front of a customer.
    const { container } = renderDnsRecords({ verify });
    await screen.findByText("route1.mx.cloudflare.net");
    fireEvent.click(screen.getByRole("button", { name: "Check these records" }));
    await screen.findByText(/We could not complete the check/);
    expect(container.textContent).not.toContain("box_unreachable");
  });

  it("renders a failed check as this screen's own sentence", async () => {
    const verify = vi.fn(() => Promise.reject(new Error("socket closed")));
    renderDnsRecords({ verify });
    await screen.findByText("route1.mx.cloudflare.net");

    fireEvent.click(screen.getByRole("button", { name: "Check these records" }));

    // Never the thrown message: a proxy's 502 carries a host and a port.
    expect(await screen.findByText("We could not check those records. Try again.")).toBeTruthy();
  });

  it("copies a record as the line a DNS provider's dialogue asks for", async () => {
    const writeText = stubClipboard();
    renderDnsRecords();
    await screen.findByText("route1.mx.cloudflare.net");

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);

    expect(writeText).toHaveBeenCalledWith("MX cf-bounce.example.com route1.mx.cloudflare.net");
  });

  it("keeps the verify button's name while it is busy", async () => {
    // A control that renames itself mid-interaction loses its own label for
    // anyone navigating by name.
    let release = (): void => {};
    const verify = vi.fn(
      () =>
        new Promise<ReturnType<typeof aDnsVerification>>((resolve) => {
          release = () => resolve(aDnsVerification());
        }),
    );
    renderDnsRecords({ verify });
    await screen.findByText("route1.mx.cloudflare.net");

    fireEvent.click(screen.getByRole("button", { name: "Check these records" }));

    const busy = await screen.findByRole("button", { name: "Check these records" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    release();
    await screen.findByText(/Every record is published and matches/);
  });

  it("renders the empty state when no Cloudflare connection exists", async () => {
    renderDnsRecords({
      connections: [anEmailProviderConnection({ id: 9, provider: "smtp" })],
    });

    expect(await screen.findByText(/No Cloudflare connection to publish records for/)).toBeTruthy();
  });

  it("says a connection that names no sending domain has nothing to publish yet", async () => {
    // Rather than building names from a string nobody can publish.
    renderDnsRecords({
      connections: [anEmailProviderConnection({ account: "not-an-address", config: {} })],
    });

    expect(await screen.findByText(/does not name a sending domain/)).toBeTruthy();
    expect(screen.queryByText("route1.mx.cloudflare.net")).toBeNull();
  });

  it("renders the signed-out state instead of the records", async () => {
    // No token and a 401 from the session read: the state a visitor gets, and
    // the reason no record is rendered for them.
    window.localStorage.clear();
    renderWithProviders(<CloudflareDnsRecordsPage />, {
      identity: stubIdentity({
        me: vi.fn(() => Promise.reject(anIdentityError(401, "unauthenticated"))),
        listAccounts: vi.fn(() => Promise.resolve([])),
      }),
      box: stubBox(),
    });

    expect(await screen.findByText("Sign in to connect a provider")).toBeTruthy();
  });
});
