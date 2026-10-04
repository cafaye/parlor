import { createFileRoute } from "@tanstack/react-router";

import InvitationPage from "@/app/invitations/[token]/page";

/**
 * `/invitations/$token` — redeeming an invitation.
 *
 * `noindex, nofollow`, and the reason is stronger here than on the other two
 * credential URLs: this one is not a query parameter but a PATH SEGMENT, so it
 * is the URL itself that has to stay out of an index. The token is also a
 * bearer secret — whoever holds it can join the account — which is the second
 * reason the route exists as it does.
 */
export const Route = createFileRoute("/invitations/$token")({
  head: () => ({
    meta: [
      { title: "Invitation · parlor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Invitation,
});

function Invitation() {
  const { token } = Route.useParams();

  return <InvitationPage params={{ token }} />;
}