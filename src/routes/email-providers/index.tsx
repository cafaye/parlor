import { createFileRoute } from "@tanstack/react-router";

import EmailProvidersPage from "@/app/email-providers/page";

/**
 * `/email-providers` — the index of the directory, which is what keeps
 * `/email-providers/cloudflare` next to it as a sibling rather than a child
 * layout. The same shape `accounts/` uses: `index.tsx` for the list,
 * `$accountId` beside it for the one.
 */
export const Route = createFileRoute("/email-providers/")({
  head: () => ({ meta: [{ title: "Email providers · Cafaye" }] }),
  component: EmailProviders,
});

function EmailProviders() {
  return <EmailProvidersPage />;
}
