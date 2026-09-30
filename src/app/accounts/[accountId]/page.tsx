import type { Metadata } from "next";

import { AccountScreen } from "./account-screen";

export const metadata: Metadata = {
  title: "Account · parlor",
};

/**
 * `/accounts/[accountId]` — one account.
 *
 * A server component that does one thing: await the route parameter and hand
 * the id to the client. The account's *name* is the natural `h1` and it is not
 * known until the client has asked the service, so the heading is rendered by
 * the screen rather than here — a server component that rendered "Account" and
 * let the client overwrite it would produce two `h1`s on the same page.
 *
 * Params are typed explicitly rather than with Next 16's generated
 * `PageProps`: that global only exists after `next build` has written
 * `.next/types`, and `npm run typecheck` has to work on a fresh clone. Same
 * reasoning as the comment on the root layout.
 */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <AccountScreen accountId={accountId} />
    </main>
  );
}
