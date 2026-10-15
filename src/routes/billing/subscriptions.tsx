import { createFileRoute } from "@tanstack/react-router";

import SubscriptionsPage from "@/app/billing/subscriptions/page";

/**
 * `/billing/subscriptions` — Subscriptions.
 */
export const Route = createFileRoute("/billing/subscriptions")({
  head: () => ({ meta: [{ title: "Subscriptions · parlor" }] }),
  component: Subscriptions,
});

function Subscriptions() {
  return <SubscriptionsPage />;
}
