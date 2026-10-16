import { createFileRoute, useLocation } from "@tanstack/react-router";

import PlansPage from "@/app/billing/plans/page";
import { searchParamsOf } from "@/lib/search-params";

/**
 * `/billing/plans` — Plans.
 *
 * The route owns the location, for the same reason the checkout route does:
 * `?account=<uuid>` is the billing account the person chose, and it is read
 * here and handed down as a plain string so the screen never reaches into the
 * router.
 */
export const Route = createFileRoute("/billing/plans")({
  head: () => ({ meta: [{ title: "Plans · parlor" }] }),
  component: Plans,
});

function Plans() {
  const { searchStr } = useLocation();

  return <PlansPage searchParams={searchParamsOf(searchStr)} />;
}
