"use client";

/**
 * `/email-providers/cloudflare/dns` — the records to publish, and one check.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN IS THE MOST LOAD-BEARING ONE IN THE SECTION
 * ---------------------------------------------------------------------------
 * A Cloudflare Email connection whose DNS records are not published sends mail
 * that lands in spam. There is no error, no bounce and nothing in this app
 * that notices: the connection is stored, the credential is sealed, the box is
 * enrolled, and mail silently goes nowhere. So the screen exists to answer the
 * only question that stands between a stored connection and working mail: what
 * exactly do I publish, and is it published yet?
 *
 * Two rules hold it together, and both are D10's:
 *
 *   1. THE RECORDS ARE RENDERED, NOT DESCRIBED. Every name and value is shown
 *      as text a customer can select and paste into their DNS provider. What is
 *      NOT known is named as unknown — see below.
 *   2. VERIFICATION IS EXPLICIT. One button per connection, pressed by a
 *      person. Nothing on this page asks a service to look at anybody's DNS
 *      until it is pressed, and nothing re-asks afterwards: continuous or
 *      automated verification is recorded as post-launch, so a screen that
 *      re-checked on load would be shipping the thing the decision postponed,
 *      hidden inside a `useEffect`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN DOES NOT KNOW, AND SAYS SO
 * ---------------------------------------------------------------------------
 * The DKIM public key is issued by Cloudflare per domain. The only party that
 * can ask Cloudflare for it is the box, because the credential authorising the
 * question is sealed to the box's public key — so when a connection's config
 * has not carried one back yet, the DKIM row is rendered with no value and
 * this screen says why. That is a temporarily incomplete record set, which is
 * an honest state; a placeholder `p=` would be a value somebody publishes.
 *
 * The check runs upstream, not here. This app renders the records Cloudflare
 * documents; it does not itself resolve DNS, and a "verified" on this screen is
 * the service's answer to a question this app asked on the person's behalf.
 */

import { useRef, useState } from "react";

import {
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  ErrorState,
  FieldSummary,
  LoadingState,
  Panel,
  TextLink,
  VisuallyHidden,
} from "@/components/ui";
import { useAccountScopedList } from "@/lib/account-scope";
import {
  type DnsVerification,
  type DnsVerificationReason,
  type DnsVerificationState,
  type EmailProviderConnection,
} from "@/lib/box";
import { useBox } from "@/lib/box-context";
import { useAuth } from "@/lib/auth";
import { cloudflareSendingRecords, recordAsLine, type DnsRecord } from "@/lib/dns-records";
import { SignedOut } from "../page";

const LOAD_FAILED = "We could not load your email providers.";

/** The verify button's accessible name. Never changes while it is busy. */
const VERIFY = "Check these records";

/**
 * What each of the three states means, in this app's words.
 *
 * `not_yet` is deliberately not a failure sentence. Cloudflare's own note on
 * domain onboarding is that DNS changes take up to 24 hours to propagate and
 * usually 5–15 minutes on Cloudflare DNS, so a correct setup answers
 * `not_yet` for its first quarter hour and the honest rendering is "we looked,
 * and not everything is published yet", with the propagation window named.
 */
const STATE_SENTENCE: Record<DnsVerificationState, string> = {
  verified: "Every record is published and matches. Mail from this domain is authenticated.",
  not_yet:
    "We looked, and not every record is published yet — or one does not match. DNS changes usually appear in 5 to 15 minutes on Cloudflare DNS, and can take up to 24 hours elsewhere.",
  unknown: "We could not complete the check. Nothing is wrong that we know of; nobody managed to look.",
};

/** The closed set of causes a `unknown` answer carries, each translated. */
const REASON_SENTENCE: Record<DnsVerificationReason, string> = {
  box_unreachable:
    "The check runs on your box, and we could not reach it. Make sure the box is powered on and enrolled, then check again.",
  zone_not_on_cloudflare_dns:
    "The zone this connection sends from is not using Cloudflare DNS, so these records cannot be published there. Cloudflare Email Service requires its domains to be on Cloudflare DNS.",
  lookup_failed:
    "The DNS lookup did not complete. This is usually temporary — check again in a few minutes.",
  check_pending: "The check has not finished. Check again in a moment.",
};

const REFUSED = "We could not check those records. Try again.";
const MISSING_KEY =
  "Cloudflare issues one DKIM key per domain. Your box reports it here once the domain is onboarded — until then this record has no value to publish, and that is the only piece missing.";

/**
 * One connection's verification, as this screen holds it.
 *
 * A discriminated union rather than a `state` field plus booleans, because the
 * pending case is not a fourth answer: it is the absence of one, and a screen
 * that conflated the two would render "checking…" where it meant "checked".
 */
type CheckResult =
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "answered"; verification: DnsVerification };

export function CloudflareDnsRecordsScreen() {
  const { session, token } = useAuth();
  const box = useBox();
  const connections = useAccountScopedList<EmailProviderConnection>(
    "email-providers",
    (t, accountId) => box.listEmailProviderConnections(t, accountId),
  );

  const [results, setResults] = useState<Record<number, CheckResult>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // Same split every form in this app makes: `pending` is what renders, this
  // is what actually blocks the second click.
  const inFlight = useRef<number | null>(null);

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous" || token === null) return <SignedOut />;

  if (connections.notConfigured) {
    return (
      <Panel headingId="cloudflare-dns" title="Cloudflare Email DNS records">
        <p className="text-sm text-muted">
          Email providers are not configured on this deployment.
        </p>
      </Panel>
    );
  }

  if (connections.accountsFailed || connections.readFailed || connections.loading) {
    if (connections.loading) {
      return (
        <Panel headingId="cloudflare-dns" title="Cloudflare Email DNS records">
          <LoadingState label="Loading your connections…" />
        </Panel>
      );
    }
    return (
      <Panel headingId="cloudflare-dns" title="Cloudflare Email DNS records">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={connections.retry}
          title={LOAD_FAILED}
        />
      </Panel>
    );
  }

  const cloudflare = connections.rows.filter(({ row }) => row.provider === "cloudflare");

  if (cloudflare.length === 0) {
    return (
      <EmptyState title="No Cloudflare connection to publish records for">
        The records this screen renders belong to a Cloudflare Email connection, and
        there is not one yet.{" "}
        <TextLink href="/email-providers/cloudflare">Connect Cloudflare Email</TextLink>
      </EmptyState>
    );
  }

  async function onVerify(accountId: string, connectionId: number) {
    if (inFlight.current !== null) return;
    inFlight.current = connectionId;
    setResults((current) => ({ ...current, [connectionId]: { kind: "pending" } }));
    try {
      const verification = await box.verifyEmailProviderConnection(
        token as string,
        accountId,
        connectionId,
      );
      setResults((current) => ({ ...current, [connectionId]: { kind: "answered", verification } }));
    } catch {
      // A check that could not be completed is this screen's own sentence. It
      // does not keep the previous answer: a stale "verified" next to a
      // request that just failed is a fact nobody re-established.
      setResults((current) => ({ ...current, [connectionId]: { kind: "failed" } }));
    } finally {
      inFlight.current = null;
    }
  }

  async function onCopy(record: DnsRecord) {
    const line = recordAsLine(record);
    // A browser with no clipboard API, or one that refuses the write, still
    // has the text on screen and selectable — the button's job is to say what
    // the line is, and copying it is the bonus.
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== "function") {
      setCopied(null);
      return;
    }
    try {
      await clipboard.writeText(line);
      setCopied(line);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted">
        Publish every row below in the zone this connection sends from. Mail from a domain
        without them is not authenticated, and receiving servers file it as spam.
      </p>

      {cloudflare.map(({ accountId, accountName, row }) => {
        const recordSet = cloudflareSendingRecords(row);
        const result = results[row.id];
        const busy = result?.kind === "pending";
        return (
          <Panel
            headingId={`dns-records-${row.id}`}
            key={`${accountId}-${row.id}`}
            title={`Records for ${row.account}`}
          >
            <div className="flex flex-col gap-4">
              <DescriptionList
                items={[
                  { term: "Account", value: accountName },
                  { term: "Provider account", value: row.account },
                  { term: "Sending domain", value: recordSet.facts.domain ?? "Not named on this connection" },
                ]}
              />

              {recordSet.records.length === 0 ? (
                <Callout tone="caution">
                  This connection does not name a sending domain, so there is nothing to
                  publish yet. Add a from address or provider account identifier on the{" "}
                  <TextLink href="/email-providers/cloudflare">connection form</TextLink>.
                </Callout>
              ) : (
                <>
                  {recordSet.publishable ? null : <Callout tone="caution">{MISSING_KEY}</Callout>}

                  <ul aria-label={`DNS records for ${row.account}`} className="flex flex-col gap-3">
                    {recordSet.records.map((record) => (
                      <li
                        className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised px-3 py-2"
                        key={`${record.type}-${record.name}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted">
                            {record.type} · {record.name}
                          </span>
                          <Button
                            onClick={() => void onCopy(record)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Copy
                          </Button>
                        </div>
                        {record.value === "" ? (
                          <p className="font-mono text-sm text-muted">
                            No value reported yet — see the note above.
                          </p>
                        ) : (
                          <code className="break-all font-mono text-sm">{record.value}</code>
                        )}
                        <p className="text-xs text-muted">{record.purpose}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="flex flex-col gap-2">
                <div>
                  <Button
                    aria-busy={busy}
                    busy={busy}
                    disabled={busy}
                    onClick={() => void onVerify(accountId, row.id)}
                    type="button"
                  >
                    {VERIFY}
                  </Button>
                </div>

                {result?.kind === "answered" ? (
                  <CheckOutcome verification={result.verification} />
                ) : null}
                {result?.kind === "failed" ? <FieldSummary>{REFUSED}</FieldSummary> : null}
              </div>
            </div>
          </Panel>
        );
      })}

      {/* The copy confirmation is a live region: it is the only feedback a
          person gets that the text is on their clipboard, and a silent button
          is a button nobody presses twice. */}
      <VisuallyHidden aria-live="polite">
        {copied === null ? "" : `Copied ${copied}`}
      </VisuallyHidden>
    </div>
  );
}

/**
 * One check's answer, rendered.
 *
 * The three states each get their own tone and sentence, and the reason code —
 * which is one of a closed set `box.ts` keeps — is translated here and
 * never shown. A service's own words reaching the DOM is how a host, a port or
 * an internal identifier ends up in front of a customer.
 */
function CheckOutcome({ verification }: { verification: DnsVerification }) {
  const tone =
    verification.state === "verified"
      ? "positive"
      : verification.state === "not_yet"
        ? "caution"
        : "note";
  const reason =
    verification.state === "unknown" && verification.reason !== null
      ? REASON_SENTENCE[verification.reason]
      : null;
  return (
    <Callout tone={tone}>
      {STATE_SENTENCE[verification.state]}
      {reason === null ? null : ` ${reason}`}
      {verification.checked_at === null ? null : (
        <>
          {" "}
          <span className="text-muted">Checked {new Date(verification.checked_at).toUTCString()}.</span>
        </>
      )}
    </Callout>
  );
}
