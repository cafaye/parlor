import { createFileRoute } from "@tanstack/react-router";

import PlansPage from "@/app/billing/plans/page";

/**
 * `/billing/plans` — Plans.
 */
export const Route = createFileRoute("/billing/plans")({
  head: () => ({ meta: [{ title: "Plans · parlor" }] }),
  component: Plans,
});

function Plans() {
  return <PlansPage />;
}
