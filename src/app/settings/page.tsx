import { Link } from "@tanstack/react-router";

import { SettingsScreen } from "./settings-screen";

/**
 * `/settings` — the profile screen, version 1.
 *
 * ---------------------------------------------------------------------------
 * THIS PAGE IS DELIBERATELY MOSTLY ABSENT, AND THE ABSENCE IS THE WORK
 * ---------------------------------------------------------------------------
 * `REPORT-parlor-profile-01.md` measured the identity API against the profile
 * screen the product wants and found routes for one of the four sections. There
 * is no route to read or write a display name, none to list sessions, none to
 * revoke one, and none to delete a user account; the service's only PATCHes
 * touch accounts, members and MFA enrollments. So those sections are not here
 * in any form — not greyed, not "coming soon", not behind a disabled control.
 *
 * A disabled control is a promise the API cannot keep, and a "coming soon"
 * heading is a promise this app cannot date. Both are worse than a shorter
 * screen, because a person plans around them. What is here is four controls
 * that each call a route the forwarder's allow-list already carries, so every
 * one of them does what its label says.
 *
 * The server/client split is the same one `accounts/page.tsx` uses: the heading
 * and the line of orientation are static, and only the panels need the browser.
 */
export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Your address, and the session you are signed in with.
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