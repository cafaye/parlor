import { createFileRoute } from "@tanstack/react-router";

import VerifyEmailPage from "@/app/verify-email/page";

/**
 * `/verify-email` — asking for a verification link, and asking again.
 *
 * The sibling at `/verify-email/confirm` is `noindex` and this one is not,
 * because they carry different things in the URL. This page takes no credential
 * in its query; the confirm page spends one. The rule is not "never name an
 * address", it is "never name one you did not just create", and the index
 * directive follows the credential rather than the route.
 */
export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify your email · parlor" }] }),
  component: VerifyEmail,
});

function VerifyEmail() {
  return <VerifyEmailPage />;
}