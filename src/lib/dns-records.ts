/**
 * The DNS records a Cloudflare Email Service SENDING domain requires.
 *
 * ---------------------------------------------------------------------------
 * WHERE THESE VALUES COME FROM
 * ---------------------------------------------------------------------------
 * Cloudflare Email Service ("Email Sending") publishes the exact record set a
 * domain needs before any mail it sends will be delivered rather than filed as
 * spam: three MX records on a `cf-bounce` subdomain for bounce processing, an
 * SPF record on the same subdomain, a DKIM record on the `cf-bounce._domainkey`
 * selector, and a DMARC record on `_dmarc`. This file transcribes them, and
 * the transcription is the whole of the value it offers — see
 * `docs/cloudflare-email-dns-records.md` for the source lines they were read
 * from, and for the reason nothing here is invented.
 *
 * THE ONE VALUE THIS APP DOES NOT HOLD IS THE DKIM PUBLIC KEY. Cloudflare
 * issues it per domain (`v=DKIM1; h=sha256; k=rsa; p=<key>`, "DKIM public key
 * (provided by Cloudflare)"), so it is not a constant this module could carry.
 * It arrives on the connection's non-secret `config` — the only party that can
 * ask Cloudflare for it is the box, because the credential that authorises the
 * question is sealed to the box's public key and this app cannot open it. A
 * connection whose config has not carried the key yet renders that record with
 * no value and says why, rather than rendering a blank `p=` for somebody to
 * publish.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE MXN PRIORITIES ARE NOT
 * ---------------------------------------------------------------------------
 * The docs say the MX priorities are "assigned automatically by Cloudflare", so
 * this module renders no priority. Inventing 10/20/30 would be exactly the
 * class of error the module exists to avoid: a rendered number that looks
 * authoritative and is this app's opinion.
 */

/** The record type, as Cloudflare's docs write it. */
export type DnsRecordType = "MX" | "TXT";

/** One record to publish, in the zone, for one sending domain. */
export type DnsRecord = {
  type: DnsRecordType;
  /**
   * The name to publish, relative to the zone: `cf-bounce`, `cf-bounce._domainkey`,
   * `_dmarc`. `@` is never used on the sending side — every sending record
   * lives on the `cf-bounce` subdomain or on `_dmarc`, and none on the apex.
   */
  name: string;
  /**
   * The exact value to publish, or `""` when the value is Cloudflare's to
   * issue and it has not been reported on this connection yet. An empty string
   * on a `providerIssued` record is a fact about this app's knowledge, never a
   * value to paste.
   */
  value: string;
  /** One sentence saying what publishing this record achieves. */
  purpose: string;
  /**
   * True when the value is issued per domain by Cloudflare and this module
   * therefore cannot know it: only the DKIM key. Marked so the screen can say
   * "Cloudflare issues this one" instead of rendering an empty box.
   */
  providerIssued: boolean;
};

/** What the screen needs about a connection before it can render its records. */
export type SendingFacts = {
  /**
   * The sending domain, or `null` when the connection does not name one. Every
   * record name is derived from it, so a null domain means no records at all
   * rather than a record set with invented names.
   */
  domain: string | null;
  /** The Cloudflare-issued DKIM public key, or `null` until the box reports it. */
  dkimPublicKey: string | null;
};

/** What the screen renders: the records, and the facts they were built from. */
export type DnsRecordSet = {
  facts: SendingFacts;
  records: DnsRecord[];
  /**
   * True when every record can be published as rendered: a sending domain is
   * named and the one Cloudflare-issued value has been reported. A screen uses
   * this to decide between "publish these" and "publish these, except the one
   * your box has not reported yet".
   */
  publishable: boolean;
};

/**
 * The three hosts that receive bounce mail for a sending domain.
 *
 * Collapsed into one value each rather than a "plus the other two" sentence,
 * because a customer copying records off a screen has to paste three rows.
 */
const BOUNCE_MX_HOSTS = ["route1.mx.cloudflare.net", "route2.mx.cloudflare.net", "route3.mx.cloudflare.net"];

/** The SPF include Cloudflare Email Service documents for a sending domain. */
const SPF_VALUE = "v=spf1 include:_spf.mx.cloudflare.net ~all";

/**
 * The DKIM record, with the key left blank.
 *
 * The tags and their order are the documented value: `v=DKIM1; h=sha256;
 * k=rsa; p=<key>`. This module knows every part but the key.
 */
function dkimValue(dkimPublicKey: string | null): string {
  if (dkimPublicKey === null) return "";
  return `v=DKIM1; h=sha256; k=rsa; p=${dkimPublicKey.trim()}`;
}

/**
 * The DMARC policy, and why it is `p=none`.
 *
 * Cloudflare documents three policies and names `p=none` the recommended one
 * for new setups, so rendering it is following the provider's own guidance
 * rather than choosing for the customer. `rua` is deliberately absent: it
 * names an address this app would have to invent, and an aggregate-report
 * mailbox nobody asked for is a record that stops being correct the day the
 * customer reads their DMARC reports.
 */
const DMARC_VALUE = "v=DMARC1; p=none;";

/**
 * Reads the sending facts off a connection's non-secret fields.
 *
 * The domain comes from the connection's `from_address` config when it carries
 * one, and falls back to `account`, which the connect screen describes as "the
 * address or zone name this connection sends from". Anything that is not an
 * address with a host is refused rather than guessed at: a bare `example`
 * without a dot is a local part, not a domain, and rendering
 * `cf-bounce.example` would be worse than rendering nothing.
 */
export function sendingFacts(connection: {
  account: string;
  config: Readonly<Record<string, string>>;
}): SendingFacts {
  const candidates = [connection.config.from_address, connection.account];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const trimmed = candidate.trim();
    const host = trimmed.includes("@") ? trimmed.slice(trimmed.lastIndexOf("@") + 1) : trimmed;
    if (isDomain(host)) return {
      domain: host.toLowerCase(),
      dkimPublicKey: readKey(connection.config.dkim_public_key),
    };
  }
  return { domain: null, dkimPublicKey: readKey(connection.config.dkim_public_key) };
}

/**
 * A host worth building record names from: a dot, labels that are not empty,
 * and no port or path.
 *
 * This is deliberately a shape check and not a public-suffix check. The zone a
 * customer publishes in is Cloudflare's to know and this app's to be told, so
 * the only distinction being drawn here is between "a domain" and "some other
 * string".
 */
function isDomain(host: string): boolean {
  if (host === "" || host.includes("/") || host.includes(":")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && !label.startsWith("-") && !label.endsWith("-"));
}

/** The Cloudflare-issued DKIM key, or null when the connection has not carried one. */
function readKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The record set for one connection.
 *
 * Pure, and total: a connection with no sending domain answers an empty set
 * with `publishable: false`, which is a rendered state ("we do not know what
 * to publish yet") rather than a thrown exception on a screen.
 */
export function cloudflareSendingRecords(connection: {
  account: string;
  config: Readonly<Record<string, string>>;
}): DnsRecordSet {
  const facts = sendingFacts(connection);
  if (facts.domain === null) {
    return { facts, records: [], publishable: false };
  }

  const domain = facts.domain;
  const records: DnsRecord[] = [
    ...BOUNCE_MX_HOSTS.map((host) => ({
      type: "MX" as const,
      name: `cf-bounce.${domain}`,
      value: host,
      purpose: "Receives bounce mail for this domain, so Cloudflare learns which addresses are bad.",
      providerIssued: false,
    })),
    {
      type: "TXT",
      name: `cf-bounce.${domain}`,
      value: SPF_VALUE,
      purpose: "Authorises Cloudflare to send mail from this domain. Publish one SPF record per name.",
      providerIssued: false,
    },
    {
      type: "TXT",
      name: `cf-bounce._domainkey.${domain}`,
      value: dkimValue(facts.dkimPublicKey),
      purpose: "Signs mail from this domain, so a receiving server can tell it was not altered in transit.",
      providerIssued: true,
    },
    {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: DMARC_VALUE,
      purpose:
        "Tells receiving servers what to do when a message fails SPF and DKIM. p=none only reports, which is the safe starting point.",
      providerIssued: false,
    },
  ];

  return { facts, records, publishable: facts.dkimPublicKey !== null };
}

/**
 * The record as one pasteable line, for a copy control.
 *
 * `MX cf-bounce.example.com route1.mx.cloudflare.net` is the shape a DNS
 * provider's "add record" dialogue asks for, so the copy is that and not the
 * two columns the screen uses to lay it out.
 */
export function recordAsLine(record: DnsRecord): string {
  return `${record.type} ${record.name} ${record.value}`;
}
