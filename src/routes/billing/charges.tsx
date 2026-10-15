import { createFileRoute } from "@tanstack/react-router";

import ChargesPage from "@/app/billing/charges/page";

/**
 * `/billing/charges` — Charges.
 */
export const Route = createFileRoute("/billing/charges")({
  head: () => ({ meta: [{ title: "Charges · parlor" }] }),
  component: Charges,
});

function Charges() {
  return <ChargesPage />;
}
