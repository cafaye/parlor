import { describe, expect, it } from "vitest";

import {
  cloudflareSendingRecords,
  recordAsLine,
  type DnsRecord,
  type DnsRecordSet,
} from "./dns-records";

/**
 * The record set, rendered for a connection that names a sending domain.
 *
 * The values asserted here are Cloudflare Email Service's documented sending
 * records; the red proof for each of them is in the comment above it, because
 * a check that has only ever been green has verified nothing.
 */
function recordsFor(
  connection: { account: string; config: Record<string, string> },
): DnsRecordSet {
  return cloudflareSendingRecords(connection);
}

function named(recordSet: DnsRecordSet, type: DnsRecord["type"], name: string): DnsRecord {
  // The name is not unique across types — `cf-bounce.<domain>` carries three
  // MX rows and the SPF TXT — so every lookup names both. Asserting the type
  // as well is what keeps a "the SPF record is there" check from passing on
  // the MX row that happens to sit in front of it.
  const found = recordSet.records.find((record) => record.name === name && record.type === type);
  if (found === undefined) throw new Error(`no ${type} record named ${name} in ${JSON.stringify(recordSet.records)}`);
  return found;
}

describe("cloudflareSendingRecords", () => {
  const connected = {
    account: "no-reply@example.com",
    config: {
      zone_id: "abc123",
      from_address: "no-reply@example.com",
      dkim_public_key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx",
    },
  };

  it("renders the bounce MX hosts Cloudflare documents, one row per host", () => {
    const recordSet = recordsFor(connected);
    const mx = recordSet.records.filter((record) => record.type === "MX");
    expect(mx.map((record) => record.value)).toEqual([
      "route1.mx.cloudflare.net",
      "route2.mx.cloudflare.net",
      "route3.mx.cloudflare.net",
    ]);
    // Red proof: collapsing the three hosts into one record ("plus route2 and
    // route3") still rendered two rows and failed this assertion the first time
    // it was written against a single-value shape.
    expect(mx).toHaveLength(3);
  });

  it("renders the SPF value verbatim, on the cf-bounce subdomain", () => {
    const spf = named(recordsFor(connected), "TXT", "cf-bounce.example.com");
    expect(spf.type).toBe("TXT");
    expect(spf.value).toBe("v=spf1 include:_spf.mx.cloudflare.net ~all");
    // Red proof: `include:relay.mailchannels.net` is the MailChannels-era value
    // and is NOT this provider's. Writing it here kept every other assertion
    // passing, which is the point of asserting the whole string.
  });

  it("puts the Cloudflare-issued DKIM key in the documented tag order", () => {
    const dkim = named(recordsFor(connected), "TXT", "cf-bounce._domainkey.example.com");
    expect(dkim.value).toBe(
      "v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx",
    );
    // The one record whose value is Cloudflare's to issue, marked as such so a
    // screen can say why an empty one is not a blank to publish.
    expect(dkim.providerIssued).toBe(true);
  });

  it("renders the DMARC record on _dmarc, at the policy Cloudflare recommends for new setups", () => {
    const dmarc = named(recordsFor(connected), "TXT", "_dmarc.example.com");
    expect(dmarc.value).toBe("v=DMARC1; p=none;");
  });

  it("renders no MX priority, because Cloudflare assigns those", () => {
    // A screen that rendered 10/20/30 would be rendering this app's invention
    // in a column the customer copies from. Red proof: adding a `priority`
    // member and rendering it makes the screen's copy button emit a number the
    // provider never stated.
    const mx = recordsFor(connected).records.filter((record) => record.type === "MX");
    expect(mx.every((record) => !("priority" in record))).toBe(true);
  });

  it("answers a set that is publishable once every value is known", () => {
    expect(recordsFor(connected).publishable).toBe(true);
  });

  it("refuses to invent a DKIM value Cloudflare has not issued", () => {
    const withoutKey = recordsFor({
      account: "no-reply@example.com",
      config: { zone_id: "abc123", from_address: "no-reply@example.com" },
    });
    const dkim = named(withoutKey, "TXT", "cf-bounce._domainkey.example.com");
    expect(dkim.value).toBe("");
    expect(withoutKey.publishable).toBe(false);
    // Red proof: substituting a placeholder (`p=…`, `p=REPLACE_ME`) passed an
    // "is non-empty" assertion and failed this one, which is the assertion that
    // matters — a placeholder in a copyable box is a value somebody publishes.
  });

  it("takes the sending domain from account when no from_address is configured", () => {
    const recordSet = recordsFor({
      account: "billing@cafaye.com",
      config: { zone_id: "abc123" },
    });
    expect(named(recordSet, "TXT", "cf-bounce.cafaye.com").type).toBe("TXT");
  });

  it("answers an empty set rather than invented names when no domain is named", () => {
    const recordSet = recordsFor({ account: "not-an-address", config: {} });
    expect(recordSet.records).toEqual([]);
    expect(recordSet.facts.domain).toBe(null);
    expect(recordSet.publishable).toBe(false);
  });

  it("refuses a local part as a domain", () => {
    // `cf-bounce.example` from an account reading `example` would be a record
    // nobody can publish, rendered with the confidence of one that works.
    const recordSet = recordsFor({ account: "example", config: {} });
    expect(recordSet.records).toEqual([]);
  });

  it("lower-cases the domain it derives", () => {
    const recordSet = recordsFor({ account: "no-reply@Example.COM", config: {} });
    expect(recordSet.facts.domain).toBe("example.com");
  });

  it("ignores a blank DKIM key as no key", () => {
    const recordSet = recordsFor({
      account: "no-reply@example.com",
      config: { dkim_public_key: "   " },
    });
    expect(recordSet.facts.dkimPublicKey).toBe(null);
    expect(recordSet.publishable).toBe(false);
  });
});

describe("recordAsLine", () => {
  it("writes the line a DNS provider's add-record dialogue asks for", () => {
    expect(recordAsLine({
      type: "MX",
      name: "cf-bounce.example.com",
      value: "route1.mx.cloudflare.net",
      purpose: "…",
      providerIssued: false,
    })).toBe("MX cf-bounce.example.com route1.mx.cloudflare.net");
  });

  it("writes a TXT value without quoting it, so a paste into a quoted field is not double-quoted", () => {
    const line = recordAsLine({
      type: "TXT",
      name: "cf-bounce.example.com",
      value: "v=spf1 include:_spf.mx.cloudflare.net ~all",
      purpose: "…",
      providerIssued: false,
    });
    expect(line).toBe("TXT cf-bounce.example.com v=spf1 include:_spf.mx.cloudflare.net ~all");
    expect(line.includes('"')).toBe(false);
  });
});
