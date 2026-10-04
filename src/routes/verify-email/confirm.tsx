import { createFileRoute } from "@tanstack/react-router";

import VerifyEmailConfirmPage from "@/app/verify-email/confirm/page";
import { searchParamsOf } from "@/lib/search-params";

/**
 * `/verify-email/confirm` — spending an emailed verification link.
 *
 * The token is read here and nowhere else, so there is exactly one place that
 * knows what the link carries, and it is `noindex, nofollow` for the same
 * reason `/reset-password` is: the query string is a live credential.
 *
 * Note the singular/plural split the file path makes obvious — `confirm` is a
 * page that spends a flow somebody started, `email-verifications` on the
 * service is a route that starts one. The directory tree does not get to
 * flatten that distinction.
 */
export const Route = createFileRoute("/verify-email/confirm")({
  head: () => ({
    meta: [
      { title: "Verify your email · parlor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: VerifyEmailConfirm,
});

function VerifyEmailConfirm() {
  const { searchStr } = Route.useLocation();

  return <VerifyEmailConfirmPage searchParams={searchParamsOf(searchStr)} />;
}