import { Link } from "@tanstack/react-router";

import { SettingsScreen } from "./settings-screen";

/**
 * `/settings` — the profile screen, version 2.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS HERE, AND WHAT IS STILL ABSENT
 * ---------------------------------------------------------------------------
 * Version 1 shipped the four controls the API supported then. The routes the
 * report listed as waiting — `PATCH /v1/me` for a display name, `GET
 * /v1/sessions` and `DELETE /v1/sessions/{id}` for the session list, and the
 * four routes under `/v1/mfa` for the second factor — have since landed on
 * identity's master, and the sections that waited for them are here. What is
 * still absent is absent for the same reason it was then, and in the same
 * form: not greyed, not "coming soon", not behind a disabled control.
 *
 *   * **API tokens** await `/v1/accounts/{id}/api-keys`, refused by the
 *     forwarder for the same reason.
 *
 * A disabled control is a promise the API cannot keep, and a "coming soon"
 * heading is a promise this app cannot date. Both are worse than a shorter
 * screen, because a person plans around them. What is here is a set of
 * controls that each call a route the forwarder's allow-list carries, so every
 * one of them does what its label says.
 *
 * The server/client split is the same one `accounts/page.tsx` uses: the heading
 * and the line of orientation are static, and only the panels need the browser.
 */
export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      {/* The header block: eyebrow, heading, supporting line — the same
          composition as the account screens and the auth screens. The eyebrow
          adds no copy: "parlor" is the product name already on the page (the
          shell brand). The heading keeps its rung. The hairline under it is
          the shared workspace rule: it closes the page header and opens the
          working surface, the same rule the accounts pages carry. */}
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">parlor</p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">
          Your name, your address, your second factor, and everywhere you are signed in.
        </p>
      </header>
      <SettingsScreen />
    </main>
  );
}

/**
 * What a signed-out visitor is shown instead of the panels.
 *
 * Kept here rather than in the client screen, for the reason `accounts/page.tsx`
 * keeps its own: the sentence is static, and the screen carries no branch for a
 * state it cannot produce.
 */
export function SignedOut() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h2 className="text-base font-medium">Sign in to see your settings</h2>
      <p className="mt-1 text-sm text-muted">
        Everything on this page belongs to one person, so there is nothing to show
        until we know who you are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" to="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}