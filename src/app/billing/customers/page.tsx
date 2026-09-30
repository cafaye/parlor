import type { Metadata } from "next";

import { CustomersScreen } from "./customers-screen";

export const metadata: Metadata = {
  title: "Customers · parlor",
};

/**
 * `/billing/customers` — billing's customer records.
 *
 * The framing sentence is in this server component rather than the client
 * screen, because it is the most load-bearing sentence in the packet: billing
 * scopes this collection by nothing, and the page has to say so before a
 * reader sees a list of other people's email addresses.
 */
export default function CustomersPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-1 text-sm text-muted">
          Every customer on the platform, and the identity user or account each one is
          for. Billing does not scope this by account yet.
        </p>
      </header>
      <CustomersScreen />
    </main>
  );
}
