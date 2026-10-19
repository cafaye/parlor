import { CloudflareDnsRecordsScreen } from "./dns-records-screen";

/**
 * `/email-providers/cloudflare/dns` — the DNS records a Cloudflare Email
 * sending domain needs, and the one explicit check.
 *
 * A server component: the heading and orientation are static, and the record
 * table with its copy controls and verify button needs the browser.
 *
 * The route hangs off `/email-providers/cloudflare` because the records belong
 * to a connection and the connection form is where a person goes to make one.
 * It is a literal segment under it rather than a wildcard, for the reason the
 * connect route gives: Cloudflare Email is the one provider with a screen, and
 * a `$provider` here would advertise a record set for `smtp` that nobody has
 * written.
 */
export default function CloudflareDnsRecordsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Cafaye</p>
        <h1 className="text-2xl font-semibold tracking-tight">Cloudflare Email DNS records</h1>
        <p className="text-sm text-muted">
          Publish these records in the zone this connection sends from. Mail from a domain
          without them is not authenticated, and lands in spam.
        </p>
      </header>
      <CloudflareDnsRecordsScreen />
    </main>
  );
}
