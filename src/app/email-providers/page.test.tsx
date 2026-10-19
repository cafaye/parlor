import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EmailProvidersPage from "./page";
import {
  type EmailProviderConnection,
  type Box,
  BoxError,
  BOX_NOT_CONFIGURED_CODE,
} from "@/lib/box";
import { anEmailProviderConnection, aBox, stubBox } from "@/test/support/box";
import { anAccountListItem } from "@/test/support/tenancy";
import { aUser, stubIdentity } from "@/test/support/identity";
import { createTokenStore } from "@/lib/token-store";
import { renderWithProviders } from "@/test/support/render";

/**
 * `/email-providers` — the connection list, and the boundary-6 property.
 *
 * The rows are Box's answer rendered raw, and the property this file
 * exists to hold is that a stored credential is never among them. Two tests
 * carry it: the client's reader drops any credential-shaped key
 * (`box.test.ts`), and these two assert it against the DOM — with a
 * connection resolved through the stub that carries an envelope anyway,
 * because the screen must not render one even if a someday service sent it.
 */

const TOKEN = "tok_abc";

/** A cast used ONLY to smuggle credential-shaped keys into a resolver. */
function withEnvelope(row: EmailProviderConnection): EmailProviderConnection {
  // Smuggled in through a cast, because the point of the test is that the
  // screen renders from the type's fields and therefore cannot show either
  // of the two names a stored credential could arrive under — even when the
  // answer carries them anyway.
  const smuggled = row as unknown as Record<string, unknown>;
  smuggled.sealed_credential = JSON.stringify({ v: 1, alg: "RSA-OAEP+A256GCM", data: "c2VhbGVk" });
  smuggled.credential = "cf-token-the-screen-must-not-render";
  return row;
}

function renderProviders({
  connections = [anEmailProviderConnection()],
  boxes = [aBox()],
}: {
  connections?: EmailProviderConnection[];
  boxes?: Box[];
} = {}) {
  return renderWithProviders(<EmailProvidersPage />, {
    identity: stubIdentity({
      me: vi.fn(() => Promise.resolve(aUser())),
      listAccounts: vi.fn(() => Promise.resolve([anAccountListItem()])),
    }),
    box: stubBox({
      listEmailProviderConnections: vi.fn(() => Promise.resolve(connections)),
      listBoxes: vi.fn(() => Promise.resolve(boxes)),
    }),
  });
}

describe("EmailProvidersScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createTokenStore().set(TOKEN);
  });

  it("lists the connections with the state of the box each is sealed to", async () => {
    renderProviders();

    expect(await screen.findByText("Cloudflare Email")).toBeTruthy();
    // The provider-side identifier. It also appears below as the config
    // from_address, so the assertion is on "at least one" rather than on a
    // unique node.
    expect(screen.getAllByText("no-reply@example.com").length).toBeGreaterThan(0);
    // The status is the box's state, not a word this screen invented.
    expect(screen.getByText("Sealed to an active box")).toBeTruthy();
    // Non-secret config, as the service sent it.
    expect(screen.getByText("zone-1")).toBeTruthy();
  });

  it("never renders a stored credential, even when the answer carries one", async () => {
    const { container } = renderProviders({
      connections: [withEnvelope(anEmailProviderConnection())],
    });

    await screen.findByText("Cloudflare Email");
    const rendered = container.textContent ?? "";
    expect(rendered).not.toContain("cf-token-the-screen-must-not-render");
    expect(rendered).not.toContain("sealed_credential");
    expect(rendered).not.toContain("RSA-OAEP");
    expect(rendered).not.toContain("c2VhbGVk");
  });

  it("drops a non-string config value the client's reader already refused", async () => {
    // The reader keeps string values only; a row that arrived with a number
    // in config would have been rewritten before this screen saw it. What
    // this asserts is that the SCREEN renders the map as strings: there is no
    // code path here that would interpolate an object.
    renderProviders({
      connections: [anEmailProviderConnection({ config: { zone_id: "zone-9" } })],
    });

    expect(await screen.findByText("zone-9")).toBeTruthy();
  });

  it("renders the empty state with the way forward", async () => {
    renderProviders({ connections: [] });

    expect(await screen.findByText("No email providers connected")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect a provider" })).toBeTruthy();
  });

  it("says a box the account no longer lists is what the row is sealed to", async () => {
    renderProviders({ boxes: [] });

    expect(
      await screen.findByText("Sealed to a box this account no longer lists"),
    ).toBeTruthy();
  });

  it("renders the list failure as its own sentence", async () => {
    renderWithProviders(<EmailProvidersPage />, {
      identity: stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        listAccounts: vi.fn(() => Promise.resolve([anAccountListItem()])),
      }),
      box: stubBox({
        listEmailProviderConnections: vi.fn(() => Promise.reject(new Error("socket"))),
        listBoxes: vi.fn(() => Promise.resolve([aBox()])),
      }),
    });

    expect(await screen.findByText("We could not load your email providers.")).toBeTruthy();
  });

  it("says nothing is configured when this deployment runs no Box", async () => {
    renderWithProviders(<EmailProvidersPage />, {
      identity: stubIdentity({
        me: vi.fn(() => Promise.resolve(aUser())),
        listAccounts: vi.fn(() => Promise.resolve([anAccountListItem()])),
      }),
      box: stubBox({
        listEmailProviderConnections: vi.fn(() =>
          Promise.reject(
            new BoxError("not configured", {
              status: 503,
              code: BOX_NOT_CONFIGURED_CODE,
            }),
          ),
        ),
        listBoxes: vi.fn(() => Promise.resolve([aBox()])),
      }),
    });

    // A note, not an error: nothing failed, and there is nothing to retry.
    expect(await screen.findByText("Email providers are not configured on this deployment.")).toBeTruthy();
  });
});
