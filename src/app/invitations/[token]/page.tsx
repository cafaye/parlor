import { InvitationScreen } from "./invitation-screen";

/**
 * `/invitations/[token]` — redeeming an invitation.
 *
 * A page that hands the route parameter over.
 * All the behaviour is in the client screen, which is where the accept decision
 * and the four failure states live.
 *
 * Params are a plain object, for the same reason they are on the account page.
 */
export default function InvitationPage({ params }: { params: { token: string } }) {
  const { token } = params;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <InvitationScreen token={token} />
    </main>
  );
}
