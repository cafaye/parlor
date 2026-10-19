import { describe, expect, it } from "vitest";

import {
  INSTALL_BLOCK,
  INSTALL_INPUTS,
  buildInstallBlock,
  type InstallInput,
} from "./install-inputs";

/**
 * The pin on the complete parameterized install.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GUARDS, AND WHAT IT IS TRANSCRIBED FROM
 * ---------------------------------------------------------------------------
 * The card renders `INSTALL_BLOCK` — the whole `cafe box init` output — so a
 * stranger sees every variable the installer reads, with no hidden ones. The
 * three expected sets below are transcribed INDEPENDENTLY from the
 * installer's own behavior, not from `install-inputs.ts`:
 *
 *   * required: the five names the installer refuses without on every
 *     adapter (`KIT_SUBSTRATE_ACME_EMAIL` first at step 5 of the walk,
 *     `KIT_SUBSTRATE_DATABASES` next, then the SMTP host/username/password —
 *     the refusals name them; the inbound secret is required only on
 *     smtp/postmark and optional on cloudflare, so it is optional and not in
 *     this set);
 *   * optional: the nine `box init` prints commented out (the six always-optional
 *     plus the two cloudflare keys and the inbound secret which is optional
 *     on cloudflare);
 *   * defaults: the nine `box init` prints as working defaults.
 *
 * The block is BUILT from the one list, so asserting the block against these
 * sets pins both halves: a variable dropped from `INSTALL_INPUTS` disappears
 * from the block and goes red here, and a variable added to the list that the
 * installer does not read fails the exact-set assertion. The control at the
 * bottom proves the pin can fail.
 */

const EXPECTED_REQUIRED = [
  "KIT_SUBSTRATE_ACME_EMAIL",
  "KIT_SUBSTRATE_DATABASES",
  "KIT_SUBSTRATE_SMTP_HOST",
  "KIT_SUBSTRATE_SMTP_USERNAME",
  "KIT_SUBSTRATE_SMTP_PASSWORD",
];

const EXPECTED_OPTIONAL = [
  "KIT_SUBSTRATE_BOX_ID",
  "KIT_SUBSTRATE_REGISTRY_CAPABILITY",
  "KIT_SUBSTRATE_APP_BASE_URL",
  "KIT_SUBSTRATE_IDENTITY_OIDC_ISSUER",
  "KIT_SUBSTRATE_IDENTITY_OIDC_LOGIN_UI_URL",
  "KIT_SUBSTRATE_CLOUDFLARE_API_KEY",
  "KIT_SUBSTRATE_CF_ACCOUNT_ID",
  "KIT_SUBSTRATE_COURIER_INBOUND_RESEND_SECRET",
  "KIT_SUBSTRATE_KUBECONFIG",
];

const EXPECTED_DEFAULTS = [
  "KIT_SUBSTRATE_BOX_URL",
  "KIT_SUBSTRATE_REGISTRY_URL",
  "KIT_SUBSTRATE_SMTP_ADAPTER",
  "KIT_SUBSTRATE_SMTP_PORT",
  "KIT_SUBSTRATE_POSTGRES_EXTENSIONS",
  "KIT_SUBSTRATE_IDENTITY_MFA_ENCRYPTION_KEY",
  "KIT_SUBSTRATE_IDENTITY_OAUTH_ENCRYPTION_KEY",
  "KIT_SUBSTRATE_MAIL_FROM",
  "KIT_SUBSTRATE_MAIL_FROM_NAME",
];

/** The names the block actually exports live (lines starting with `export `). */
function liveExports(block: string): string[] {
  return block
    .split("\n")
    .filter((line) => line.startsWith("export "))
    .map((line) => line.slice("export ".length).split("=")[0]);
}

/** The pin both the page and the control below assert through. */
function expectPinned(block: string, inputs: InstallInput[]): void {
  expect(liveExports(block).sort()).toEqual([...EXPECTED_REQUIRED].sort());
  for (const name of EXPECTED_OPTIONAL) {
    expect(block).toContain(`# export ${name}=`);
  }
  for (const name of EXPECTED_DEFAULTS) {
    expect(block).toContain(`#   ${name}=`);
  }
  // Nothing the installer does not read: the list holds exactly the three
  // expected sets, no more.
  expect(inputs.map((input) => input.name).sort()).toEqual(
    [...EXPECTED_REQUIRED, ...EXPECTED_OPTIONAL, ...EXPECTED_DEFAULTS].sort(),
  );
}

describe("the complete parameterized install", () => {
  it("exports live exactly the inputs the installer refuses without", () => {
    expectPinned(INSTALL_BLOCK, INSTALL_INPUTS);
  });

  it("renders every required input with its meaning beside it", () => {
    for (const input of INSTALL_INPUTS.filter((entry) => entry.kind === "required")) {
      expect(INSTALL_BLOCK).toContain(`export ${input.name}='${input.value}'`);
      expect(INSTALL_BLOCK).toContain(input.meaning);
    }
  });

  it("ends in the front door the block parameterizes", () => {
    expect(INSTALL_BLOCK.trimEnd().endsWith("curl -fsSL https://cafaye.com/box/install | bash")).toBe(
      true,
    );
  });

  it("carries no real hostname and no real secret in its examples", () => {
    // `box init`'s own example values: example.com hosts and angle-bracket
    // secrets. Every URL in the block is either the front door the walk
    // proved (`cafaye.com`), one of `box init`'s own working defaults
    // (`svc.cafaye.com`), or an example placeholder — anything else would be
    // a hostname the card teaches somebody to trust.
    const urls = INSTALL_BLOCK.match(/https?:\/\/[^\s'"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/example\.com|cafaye\.com/);
    }
    // And no real-looking secret: a pasted credential would be live the
    // moment somebody runs the block unedited.
    expect(INSTALL_BLOCK).not.toMatch(/sk-|cap_[A-Za-z0-9]{8,}/);
  });

  it("would go red if a required variable were dropped from the list", () => {
    // THE CONTROL. A pin that has only ever been green has verified nothing:
    // rebuild the block from a list missing one required input and assert the
    // same pin fails on it.
    const dropped = INSTALL_INPUTS.filter((input) => input.name !== "KIT_SUBSTRATE_ACME_EMAIL");
    expect(() => expectPinned(buildInstallBlock(dropped), dropped)).toThrow();
  });
});
