import { createFileRoute } from "@tanstack/react-router";

import PlansPage from "@/app/billing/plans/page";

/**
 * `/billing/plans` — the plan catalogue.
 *
 * Billing is a different service from identity, with its own client and its own
 * error type (`src/lib/billing.ts`), and no identity session token is sent to
 * it. Nothing about that is visible in this file, which is the point: the route
 * only names a path.
 */
export const Route = createFileRoute("/billing/plans")({
  head: () => ({ meta: [{ title: "Plans · parlor" }] }),
  component: Plans,
});

function Plans() {
  return <PlansPage />;
}