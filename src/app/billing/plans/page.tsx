import type { Metadata } from "next";

import { PlansScreen } from "./plans-screen";

export const metadata: Metadata = {
  title: "Plans · parlor",
};

/**
 * `/billing/plans` — the plan catalogue.
 *
 * A server component for the heading and the framing sentence, and a client
 * screen for the list. The heading lives here because it does not depend on
 * anything the client fetches, and the sentence under it lives here because it
 * is the most important thing on the page: it tells the reader this is a
 * catalogue and not their current plan, which is the one thing the contract
 * cannot tell them.
 */
export default function PlansPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-muted">
          The catalogue: what can be bought, at what price, on what cadence. This is not
          your current plan — billing does not record one yet.
        </p>
      </header>
      <PlansScreen />
    </main>
  );
}
