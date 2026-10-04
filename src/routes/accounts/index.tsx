import { createFileRoute } from "@tanstack/react-router";

import AccountsPage from "@/app/accounts/page";

/**
 * `/accounts` — the accounts you belong to.
 *
 * `index.tsx` and not `accounts.tsx` is what makes this the index of the
 * directory, which is what keeps `/accounts/$accountId` next to it as a sibling
 * rather than a child layout. The list page renders the signed-out state
 * itself rather than branching on the session here, so the shell has one answer
 * to "is anybody signed in" (see `src/lib/auth.tsx`).
 */
export const Route = createFileRoute("/accounts/")({
  component: Accounts,
});

function Accounts() {
  return <AccountsPage />;
}