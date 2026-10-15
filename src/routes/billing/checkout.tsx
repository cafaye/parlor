import { createFileRoute, useLocation } from "@tanstack/react-router";

import CheckoutPage from "@/app/billing/checkout/page";
import { searchParamsOf } from "@/lib/search-params";

/**
 * `/billing/checkout` — start a subscription.
 *
 * The one billing route with a query parameter: the plan arrives as a **slug**,
 * because that is the handle the pricing page links with (a slug is a public
 * handle; a uuid is not something a person should ever see in a URL). The plan
 * is read here and handed down as a plain object, the way
 * `src/routes/reset-password.tsx` hands down a token — one line at the route
 * that owns the location, and a screen that never reaches into the router.
 */
export const Route = createFileRoute("/billing/checkout")({
  head: () => ({ meta: [{ title: "Checkout · parlor" }] }),
  component: Checkout,
});

function Checkout() {
  const { searchStr } = useLocation();

  return <CheckoutPage searchParams={searchParamsOf(searchStr)} />;
}
