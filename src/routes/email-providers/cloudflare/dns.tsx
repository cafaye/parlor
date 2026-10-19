import { createFileRoute } from "@tanstack/react-router";

import CloudflareDnsRecordsPage from "@/app/email-providers/cloudflare/dns/page";

/**
 * `/email-providers/cloudflare/dns` — the records to publish, and one check.
 *
 * D10: the Cloudflare Email connection ships with the required DNS records
 * rendered to the customer, plus ONE explicit verify. Automated continuous
 * verification is recorded as post-launch, and this route is where that
 * decision is visible: nothing here runs a check on load, and nothing
 * schedules one.
 */
export const Route = createFileRoute("/email-providers/cloudflare/dns")({
  head: () => ({ meta: [{ title: "Cloudflare Email DNS records · Cafaye" }] }),
  component: CloudflareDnsRecords,
});

function CloudflareDnsRecords() {
  return <CloudflareDnsRecordsPage />;
}
