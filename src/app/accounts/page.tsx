import Link from "next/link";

import { AccountsScreen } from "./accounts-screen";

/**
 * `/accounts` — every account the signed-in person belongs to.
 *
 * A server component: the heading and the one line of orientation are static,
 * and only the list and the form need the browser. The split is the point of
 * the App Router, and it keeps `"use client"` off everything that does not
 * genuinely need it.
 */
export default function AccountsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-muted">
          The accounts you belong to, and the role you hold in each one.
        </p>
      </header>
      <AccountsScreen />
    </main>
  );
}

/**
 * What a signed-out visitor is shown instead of a list.
 *
 * Kept here rather than in the client screen so the sentence is static and the
 * screen does not carry a branch for a state it cannot produce.
 */
export function SignedOut() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h2 className="text-base font-medium">Sign in to see your accounts</h2>
      <p className="mt-1 text-sm text-muted">
        Accounts are per person, so there is nothing to show until we know who you
        are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
