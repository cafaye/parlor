import { Link } from "@tanstack/react-router";

import { AdminScreen } from "./admin-screen";

/**
 * `/admin` — the system-admin console.
 *
 * A private surface, not a customer one: the heading names it as run by the
 * platform rather than by an account, and the screen below renders the gate
 * (anonymous, non-staff, staff) rather than branching on the session here.
 */
export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">parlor</p>
        <h1 className="text-2xl font-semibold tracking-tight">System admin</h1>
        <p className="text-sm text-muted">
          Platform operator tools. Available to staff only, and every action is
          checked server-side.
        </p>
      </header>
      <AdminScreen />
    </main>
  );
}

/**
 * What a signed-out visitor is shown instead of the console.
 *
 * Kept here rather than in the client screen so the sentence is static and the
 * screen does not carry a branch for a state it cannot produce.
 */
export function AdminSignedOut() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h2 className="text-base font-medium">Sign in to continue</h2>
      <p className="mt-1 text-sm text-muted">
        This area is for system administrators, so there is nothing to show until
        we know who you are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" to="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
