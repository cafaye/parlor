import { createFileRoute } from "@tanstack/react-router";

import AccountPage from "@/app/accounts/[accountId]/page";

/**
 * `/accounts/$accountId` — one account.
 *
 * The param is `$accountId` here and `[accountId]` was the old spelling; both
 * are the same segment, and this is the one the router types. It is handed down
 * as the plain object the page already takes, so the page never learns that a
 * router exists.
 *
 * The heading is rendered by the screen, not here. The account's *name* is the
 * natural `h1` and it is not known until the client has asked the service, so a
 * route that rendered "Account" and let the screen overwrite it would produce
 * two `h1`s on one page.
 */
export const Route = createFileRoute("/accounts/$accountId")({
  head: () => ({ meta: [{ title: "Account · parlor" }] }),
  component: Account,
});

function Account() {
  const { accountId } = Route.useParams();

  return <AccountPage params={{ accountId }} />;
}