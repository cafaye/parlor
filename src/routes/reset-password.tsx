import { createFileRoute, useLocation } from "@tanstack/react-router";

import ResetPasswordPage from "@/app/reset-password/page";
import { searchParamsOf } from "@/lib/search-params";

/**
 * `/reset-password` — spending an emailed reset link.
 *
 * Two things happen here and both are the route file's job. The token is read
 * off the resolved location and handed down as a plain object; and the page is
 * marked `noindex, nofollow`, because the query string of this URL is a live
 * bearer credential and indexing it would publish that credential to a search
 * engine. The two are one decision — reading a credential and refusing to
 * index the page that carries it — and they live together on purpose.
 */
export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Choose a new password · parlor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { searchStr } = useLocation();

  return <ResetPasswordPage searchParams={searchParamsOf(searchStr)} />;
}