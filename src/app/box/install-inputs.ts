/**
 * The complete parameterized install, in one list.
 *
 * ---------------------------------------------------------------------------
 * AUTHORITY, AND WHY THERE IS ONE LIST
 * ---------------------------------------------------------------------------
 * Transcribed from `cafe box init` — the `internal/cli/box_init.go` worker's
 * output, read off the built binary (`/tmp/cafe-boxinit box init`) on
 * 2026-10-16. That command is the authority; do NOT re-derive this list from
 * the install script, from memory, or from an older walk. `box init` prints
 * required vs optional vs working-defaults, each with its one-line meaning
 * and its example value, and this file transcribes all three groups with both.
 *
 * The rendered block below (`INSTALL_BLOCK`) is BUILT from this list, not
 * maintained beside it: a variable dropped from `INSTALL_INPUTS` disappears
 * from the block, and the pinning test (`install-block.test.ts`) holds the
 * expected required set independently, so the drift reads as red rather than
 * as a quieter page. One list, one builder, one pin.
 *
 * The walk that motivates it: a bare `curl … | bash` died at step 5 demanding
 * `KIT_SUBSTRATE_BOX_ID`, and re-run, one variable per run after that — a
 * stranger has no way to know those exist. The card renders this whole block
 * so there are no hidden variables left.
 *
 * Example values are `box init`'s own: `example.com` hosts and
 * `<angle-bracket>` secrets, never a real hostname and never a real secret.
 */

export type InstallInputKind = "required" | "optional" | "default";

export interface InstallInput {
  name: string;
  kind: InstallInputKind;
  /** The one-line meaning, in `box init`'s own words. */
  meaning: string;
  /** The example value for required/optional; the working value for defaults. */
  value: string;
  /** Tag `box init` prints after the value: [replace], [keep], or (working default). */
  tag: string;
}

export const INSTALL_INPUTS: InstallInput[] = [
  // Required — the installer refuses, one per run, without each one.
  {
    name: "KIT_SUBSTRATE_ACME_EMAIL",
    kind: "required",
    meaning:
      "the address Let's Encrypt emails about this box's certificates; example.com is refused, so it must be real",
    value: "you@example.com",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_DATABASES",
    kind: "required",
    meaning:
      "the comma-separated service names; this is the value the Cluster manifest provisions — keep it unless you changed the manifest",
    value: "identity,gateway,courier,parlor",
    tag: "[keep]",
  },
  {
    name: "KIT_SUBSTRATE_SMTP_HOST",
    kind: "required",
    meaning: "your mail relay's host",
    value: "smtp.example.com",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_SMTP_USERNAME",
    kind: "required",
    meaning: "your mail relay's username",
    value: "relay-user",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_SMTP_PASSWORD",
    kind: "required",
    meaning: "your mail relay's password — a secret; never commit it, and it is never printed",
    value: "<your-smtp-password>",
    tag: "[replace]",
  },
  // KIT_SUBSTRATE_COURIER_INBOUND_RESEND_SECRET is required for smtp/postmark
  // and optional for cloudflare — see install.sh's cloudflare branch (a
  // Cloudflare Email Sending operator has no webhook dashboard value to copy,
  // and courier boots without it). It lives here as optional so the block
  // does not demand a value a cloudflare-only install cannot provide, while
  // the meaning still names the smtp/postmark requirement. The installer is
  // the authority; this list is the copy (install.sh line: `case
  // "$KIT_SUBSTRATE_SMTP_ADAPTER" … cloudflare … else … inbound …`).
  // Optional — each may be left unset; set only what you need.
  {
    name: "KIT_SUBSTRATE_BOX_ID",
    kind: "optional",
    meaning:
      "this box's enrolled uuid; needed ONLY when an artifact is private, and what the registry capability is bound to",
    value: "<the uuid cafe box enroll prints for this box>",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_REGISTRY_CAPABILITY",
    kind: "optional",
    meaning:
      "the single-use cap_ token cafe box enroll prints; needed ONLY when an artifact is private — public artifacts demand nothing",
    value: "<the cap_… token cafe box enroll prints>",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_APP_BASE_URL",
    kind: "optional",
    meaning:
      "the public origin a browser reaches; set it to give the box a mail path, leave it unset for no mail path",
    value: "https://app.example.com",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_IDENTITY_OIDC_ISSUER",
    kind: "optional",
    meaning:
      "the URL identity publishes as its issuer; set it with the login UI below, or leave both unset for no OIDC",
    value: "https://auth.example.com",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_IDENTITY_OIDC_LOGIN_UI_URL",
    kind: "optional",
    meaning:
      "the page the browser is sent to in order to sign in; set it with the issuer above, or neither",
    value: "https://app.example.com/sign-in/oidc",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_CLOUDFLARE_API_KEY",
    kind: "optional",
    meaning:
      "Cloudflare API token with Email Sending:Edit — required when adapter is cloudflare; a secret; mint at dash.cloudflare.com → My Profile → API Tokens",
    value: "<your-cloudflare-api-token>",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_CF_ACCOUNT_ID",
    kind: "optional",
    meaning:
      "the Cloudflare account id the token belongs to — required when adapter is cloudflare",
    value: "<your-cloudflare-account-id>",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_COURIER_INBOUND_RESEND_SECRET",
    kind: "optional",
    meaning:
      "the webhook signing secret from your mail provider's dashboard (Resend: the endpoint's Signing Secret) — a secret; required for smtp/postmark, optional for cloudflare",
    value: "<the signing secret from your provider>",
    tag: "[replace]",
  },
  {
    name: "KIT_SUBSTRATE_KUBECONFIG",
    kind: "optional",
    meaning:
      "a kubeconfig path, to install into a cluster that ALREADY exists instead of provisioning the host; a fresh box leaves it unset",
    value: "</path/to/kubeconfig>",
    tag: "[replace]",
  },
  // Working defaults — do NOT set these unless you are changing the default.
  {
    name: "KIT_SUBSTRATE_BOX_URL",
    kind: "default",
    meaning: "where a capability is redeemed",
    value: "https://box.svc.cafaye.com",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_REGISTRY_URL",
    kind: "default",
    meaning: "where a capability is exchanged for a registry credential",
    value: "https://registry.svc.cafaye.com",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_SMTP_ADAPTER",
    kind: "default",
    meaning: "courier's mail adapter (smtp, postmark, or cloudflare — cloudflare recommended)",
    value: "smtp",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_SMTP_PORT",
    kind: "default",
    meaning: "the SMTP submission port",
    value: "587",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_POSTGRES_EXTENSIONS",
    kind: "default",
    meaning: "the Postgres extension list",
    value: "vector",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_IDENTITY_MFA_ENCRYPTION_KEY",
    kind: "default",
    meaning:
      "identity's MFA key — generated on the box on first creation and read back thereafter",
    value: "(generated)",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_IDENTITY_OAUTH_ENCRYPTION_KEY",
    kind: "default",
    meaning: "identity's OAuth key — unset keeps the OAuth surface off",
    value: "(unset)",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_MAIL_FROM",
    kind: "default",
    meaning: "courier's From address — falls back to courier's own default",
    value: "(courier's default)",
    tag: "(working default)",
  },
  {
    name: "KIT_SUBSTRATE_MAIL_FROM_NAME",
    kind: "default",
    meaning: "courier's From display name — falls back to courier's own default",
    value: "(courier's default)",
    tag: "(working default)",
  },
];

/** The front door the block ends in — the one command that takes a bare box to a running stack. */
export const INSTALL_SCRIPT_COMMAND = "curl -fsSL https://cafaye.com/box/install | bash";

function requiredLine(input: InstallInput): string {
  return `export ${input.name}='${input.value}'   # ${input.tag} ${input.meaning}`;
}

function optionalLine(input: InstallInput): string {
  return `# export ${input.name}='${input.value}'   # ${input.tag} ${input.meaning}`;
}

function defaultLine(input: InstallInput): string {
  return `#   ${input.name}=${input.value}   # ${input.meaning}`;
}

/**
 * The complete block `cafe box init` prints, built from the one list above.
 *
 * Required inputs are live `export`s — the installer refuses without each
 * one. Optional inputs are commented out — leave any unset you do not need.
 * Defaults are comments — do not set them unless changing the default. The
 * shape mirrors `box init`'s own so a reader can diff the two by eye.
 */
export function buildInstallBlock(inputs: InstallInput[]): string {
  const required = inputs.filter((input) => input.kind === "required");
  const optional = inputs.filter((input) => input.kind === "optional");
  const defaults = inputs.filter((input) => input.kind === "default");
  return [
    "# cafaye box install. Replace anything in <angle brackets> or on example.com,",
    "# keep the rest, then run this whole block in one shell.",
    "# Required — the installer refuses, one per run, without each of these:",
    ...required.map(requiredLine),
    "# Optional — each may be left unset; set only what you need:",
    ...optional.map(optionalLine),
    "# Working defaults — do NOT set these unless you are changing the default:",
    ...defaults.map(defaultLine),
    "",
    INSTALL_SCRIPT_COMMAND,
  ].join("\n");
}

/** What the card renders: the whole block, from the one list. */
export const INSTALL_BLOCK = buildInstallBlock(INSTALL_INPUTS);
