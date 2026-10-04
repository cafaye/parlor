import { createFileRoute } from "@tanstack/react-router";

import CustomersPage from "@/app/billing/customers/page";

/**
 * `/billing/customers` — billing's customer records.
 *
 * The screen labels this as the whole platform's list, because the service
 * scopes that collection by nothing (AGENTS.md, "Billing"). It is not behind
 * account tenancy and must not be presented as somebody's billing page; the
 * route file does not restate that, because the screen is where the reader is.
 */
export const Route = createFileRoute("/billing/customers")({
  head: () => ({ meta: [{ title: "Customers · parlor" }] }),
  component: Customers,
});

function Customers() {
  return <CustomersPage />;
}