import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";

import CloudflareConnectPage from "./page";
import {
  type Box,
  type BoxClient,
  type EmailProviderConnection,
  BoxError,
} from "@/lib/box";
import { aBox, anEmailProviderConnection, stubBox } from "@/test/support/box";
import { anAccountListItem } from "@/test/support/tenancy";
import { aUser, stubIdentity } from "@/test/support/identity";
import { createTokenStore } from "@/lib/token-store";
import { renderWithProviders } from "@/test/support/render";

/**
 * `/email-providers/cloudflare` — the connection form.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE FOR
 * ---------------------------------------------------------------------------
 * The form is the one place a provider credential exists in this app, and
 * the property the whole packet turns on is that it crosses once, in one
 * direction, and is never shown again. So beyond the happy path and the
 * failure sentences, four tests hold the boundary:
 *
 *   1. the submitted value is not rendered into the success state, and the
 *      input is cleared the moment the submit lands;
 *   2. a stored connection — one the stub resolves while the form is open —
 *      prefills NOTHING, least of all the credential field;
 *   3. an answer that carries credential-shaped keys anyway is not rendered;
 *   4. the load fails and refuses in sentences this app wrote, never the
 *      service's message.
 */

const TOKEN = "tok_abc";
const BOX_ID = "8f2c1a44-0000-4000-8000-000000000002";
const THE_CREDENTIAL = "cf-token-the-form-must-not-echo";

function typeCredential(value = THE_CREDENTIAL) {
  fireEvent.change(screen.getByLabelText("Credential"), { target: { value } });
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Account"), {
    target: { value: "no-reply@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Box"), { target: { value: BOX_ID } });
  typeCredential();
}

/** The create call, as a mock: typed so the call arguments stay readable. */
type CreateMock = MockedFunction<BoxClient["createEmailProviderConnection"]>;

function renderForm({
  boxes = [aBox()],
  connections = [] as EmailProviderConnection[],
  create,
}: {
  boxes?: Box[];
  connections?: EmailProviderConnection[];
  create?: CreateMock;
} = {}) {
  const createMock: CreateMock =
    create ?? vi.fn(() => Promise.resolve(anEmailProviderConnection()));
  const box = stubBox({
    listBoxes: vi.fn(() => Promise.resolve(boxes)),
    listEmailProviderConnections: vi.fn(() => Promise.resolve(connections)),
    createEmailProviderConnection: createMock,
  });
  const result = renderWithProviders(<CloudflareConnectPage />, {
    identity: stubIdentity({
      me: vi.fn(() => Promise.resolve(aUser())),
      listAccounts: vi.fn(() =>
        Promise.resolve([
          anAccountListItem({ id: "8f2c1a44-0000-4000-8000-000000000001" }),
        ]),
      ),
    }),
    box,
  });
  return { ...result, box, create: createMock };
}

describe("CloudflareConnectScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createTokenStore().set(TOKEN);
  });

  it("submits the credential once and clears the field on success", async () => {
    const create = vi.fn(() => Promise.resolve(anEmailProviderConnection()));
    const { container } = renderForm({ create });

    await screen.findByLabelText("Credential");
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Connect Cloudflare Email" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    // The caller's own token, the account the chosen box belongs to, and the
    // credential traveling IN — the one direction it ever moves.
    expect(create).toHaveBeenCalledWith(
      TOKEN,
      "8f2c1a44-0000-4000-8000-000000000001",
      expect.objectContaining({ credential: THE_CREDENTIAL, provider: "cloudflare" }),
    );

    // The value's life in the browser ends here: the input is cleared, and
    // the success sentence is this file's own — the credential is not
    // echoed into it.
    await waitFor(() =>
      expect(screen.getByText(/Connected\. The credential is sealed/)).toBeTruthy(),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Credential").value).toBe("");
    expect(container.textContent ?? "").not.toContain(THE_CREDENTIAL);
  });

  it("never prefills a field from a stored connection — there is none to read", async () => {
    // The form takes no connection as a prop; this resolves one while the
    // form is open anyway, and the fields stay empty. That is the
    // architectural guarantee made visible: the rendered form is the same
    // object whether connections exist or not.
    renderForm({ connections: [anEmailProviderConnection()] });

    await screen.findByLabelText("Credential");
    expect(screen.getByLabelText<HTMLInputElement>("Credential").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Account").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Zone id").value).toBe("");
  });

  it("does not render credential-shaped keys even when the answer carries them", async () => {
    const answered = {
      ...anEmailProviderConnection(),
      sealed_credential: JSON.stringify({ v: 1, alg: "RSA-OAEP+A256GCM", data: "c2VhbGVk" }),
      credential: THE_CREDENTIAL,
    } as unknown as EmailProviderConnection;
    const { container } = renderForm({ create: vi.fn(() => Promise.resolve(answered)) });

    await screen.findByLabelText("Credential");
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Connect Cloudflare Email" }));

    await waitFor(() => expect(screen.getByText(/Connected\. The credential is sealed/)).toBeTruthy());
    expect(container.textContent ?? "").not.toContain(THE_CREDENTIAL);
    expect(container.textContent ?? "").not.toContain("sealed_credential");
    expect(container.textContent ?? "").not.toContain("c2VhbGVk");
  });

  it("keeps the typed credential in the field when the submit fails", async () => {
    // A person who mistyped a 40-character token should not paste it twice.
    const create = vi.fn(() => Promise.reject(new BoxError("nope", { status: 500 })));
    renderForm({ create });

    await screen.findByLabelText("Credential");
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Connect Cloudflare Email" }));

    expect(await screen.findByText("We could not store that connection. Try again.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Credential").value).toBe(THE_CREDENTIAL);
  });

  it("names the duplicate the unique index upstream declares", async () => {
    const create = vi.fn(() => Promise.reject(new BoxError("conflict", { status: 409 })));
    renderForm({ create });

    await screen.findByLabelText("Credential");
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Connect Cloudflare Email" }));

    expect(await screen.findByText(/That box already has a Cloudflare connection/)).toBeTruthy();
  });

  it("explains the refusal for a box with no key to seal to", async () => {
    const create = vi.fn(() => Promise.reject(new BoxError("no key", { status: 422 })));
    renderForm({ create });

    await screen.findByLabelText("Credential");
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Connect Cloudflare Email" }));

    expect(await screen.findByText(/has not reported a public key yet/)).toBeTruthy();
  });

  it("refuses an empty credential before the wire", async () => {
    const create = vi.fn(() => Promise.resolve(anEmailProviderConnection()));
    renderForm({ create });

    await screen.findByLabelText("Credential");
    fireEvent.change(screen.getByLabelText("Account"), {
      target: { value: "no-reply@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Box"), { target: { value: BOX_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Cloudflare Email" }));

    expect(await screen.findByText("Enter the credential to seal.")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a box before it offers a credential field at all", async () => {
    renderForm({ boxes: [] });

    expect(await screen.findByText("Enroll a box first")).toBeTruthy();
    expect(screen.queryByLabelText("Credential")).toBeNull();
  });
});
