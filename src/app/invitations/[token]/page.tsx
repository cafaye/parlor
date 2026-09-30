import type { Metadata } from "next";

import { InvitationScreen } from "./invitation-screen";

export const metadata: Metadata = {
  title: "Invitation · parlor",
  // An invitation link is followed from an email, and a search engine indexing
  // a one-time token in a URL is a credential published to a third party. The
  // token is also a bearer secret: whoever holds it can join the account.
  robots: { index: false, follow: false },
};

/**
 * `/invitations/[token]` — redeeming an invitation.
 *
 * A server component that awaits the route parameter and hands over the token.
 * All the behaviour is in the client screen, which is where the accept decision
 * and the four failure states live.
 *
 * Params are typed explicitly rather than with Next 16's generated
 * `PageProps`: that global only exists after `next build` has written
 * `.next/types`, and `npm run typecheck` has to work on a fresh clone.
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <InvitationScreen token={token} />
    </main>
  );
}
