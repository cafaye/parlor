import { ChargesScreen } from "./charges-screen";

/**
 * `/billing/charges` — Charges.
 *
 * A server component: the heading and the one line of orientation are static,
 * and only the list needs the browser. The split is the one
 * `src/app/accounts/page.tsx` uses, and it keeps `"use client"` off everything
 * that does not genuinely need it.
 *
 * Billing is optional in the launch stack, so every screen under `/billing`
 * renders its own unconfigured state rather than an error — the deployment
 * shape where `BILLING_URL` is unset is a real deployment, not a broken one.
 */
export default function ChargesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">parlor</p>
        <h1 className="text-2xl font-semibold tracking-tight">Charges</h1>
        <p className="text-sm text-muted">Everything this account has been charged, and the receipt for each.</p>
      </header>
      <ChargesScreen />
    </main>
  );
}
