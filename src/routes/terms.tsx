import { createFileRoute } from "@tanstack/react-router";

import { LegalPlaceholder, ProsePage } from "@/components/ui";

/**
 * `/terms` — the terms of service page.
 *
 * A placeholder, deliberately, and this is the fleet's own recorded decision
 * rather than this file's: anywaye has not published terms of service, and a
 * website that invented them would be printing claims nobody made — so the
 * page says so, and points the operator at the policy generators the precedent
 * suggests. See `LegalPlaceholder` for the body and `ProsePage` for the
 * layout; neither carries legal text, and adding any is a legal decision
 * rather than a copy change.
 *
 * Reads no session, fetches nothing, holds no state.
 */
export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service · parlor" }] }),
  component: TermsPage,
});

export default function TermsPage() {
  return (
    <ProsePage title="Terms of Service">
      <LegalPlaceholder document="Terms of Service" />
    </ProsePage>
  );
}
