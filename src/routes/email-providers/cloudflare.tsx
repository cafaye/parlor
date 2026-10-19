import { createFileRoute } from "@tanstack/react-router";

import CloudflareConnectPage from "@/app/email-providers/cloudflare/page";

/**
 * `/email-providers/cloudflare` — the connection form.
 *
 * A literal segment and not `$provider`, deliberately: Cloudflare Email is
 * the one provider with a screen, and a wildcard here would advertise a
 * form for every provider in the model (`smtp` included) that nobody has
 * built. A second provider is a second file beside this one, which is what
 * makes adding one a decision rather than a default.
 */
export const Route = createFileRoute("/email-providers/cloudflare")({
  head: () => ({ meta: [{ title: "Connect Cloudflare Email · Cafaye" }] }),
  component: CloudflareConnect,
});

function CloudflareConnect() {
  return <CloudflareConnectPage />;
}
