"use client";

/**
 * `/email-providers` — the caller's email-provider connections.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY 6, ON THE SCREEN
 * ---------------------------------------------------------------------------
 * A connection is a record of WHICH provider an account uses, the
 * provider-side account identifier, and the non-secret config fields. The
 * credential itself is an envelope sealed to the box's public key —
 * ciphertext Box cannot open, and ciphertext this app has nothing to
 * do with either. So:
 *
 *   * NOTHING ON THIS SCREEN READS A STORED CREDENTIAL. The client's reader
 *     builds every row from named non-secret fields, so a response carrying
 *     `sealed_credential` or `credential` still produces a row with neither
 *     key (`box.ts`'s `readEmailProviderConnection`, proved in
 *     `box.test.ts` and asserted from the DOM in `page.test.tsx`).
 *   * THE ONLY WAY A CREDENTIAL TRAVELS IS IN: `/email-providers/cloudflare`
 *     submits a new one, Box seals it to the box's public key on
 *     arrival, and the answer is the row's non-secret fields. This screen
 *     renders that answer, so even a success carries nothing to echo.
 *
 * Replacing a credential is the same form submitted again — not an "edit"
 * that reads the old value back into a field. There is nothing to read back
 * INTO: this app has never held it.
 *
 * ---------------------------------------------------------------------------
 * WHAT "STATUS" MEANS ON A ROW
 * ---------------------------------------------------------------------------
 * The connection row has no status of its own; it has a box. So the status
 * this screen shows is the state of the box the credential is sealed to,
 * read from the boxes collection on the same page: a credential sealed to a
 * box that has not finished enrolling cannot be opened by anybody yet, and
 * saying "Connected" there would be the screen asserting a fact only the
 * box knows. A row whose box is not in the account's box list says so
 * rather than guessing.
 */

import {
  DescriptionList,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  TextLink,
} from "@/components/ui";
import { useAccountScopedList } from "@/lib/account-scope";
import {
  type Box,
  type EmailProviderConnection,
  type EmailProviderName,
} from "@/lib/box";
import { useBox } from "@/lib/box-context";
import { useAuth } from "@/lib/auth";
import { SignedOut } from "./page";

const LOAD_FAILED = "We could not load your email providers.";

const PROVIDER_LABEL: Record<EmailProviderName, string> = {
  smtp: "SMTP",
  cloudflare: "Cloudflare Email",
};

/**
 * The row's status, from the state of the box the credential is sealed to.
 *
 * `undefined` means the connection's box did not come back in this
 * account's box list — a row that names a box the caller can no longer see,
 * which is said plainly rather than resolved to "active".
 */
function connectionStatus(box: Box | undefined): string {
  if (box === undefined) return "Sealed to a box this account no longer lists";
  if (box.status === "disabled") return "The box this is sealed to is disabled";
  if (box.current_phase === "failed") return "The install failed on the box this is sealed to";
  if (box.status === "enrolling" || box.current_phase !== "complete") {
    return "Waiting for the box to finish enrolling";
  }
  return "Sealed to an active box";
}

export function EmailProvidersScreen() {
  const { session, token } = useAuth();
  const box = useBox();
  const connections = useAccountScopedList<EmailProviderConnection>(
    "email-providers",
    (t, accountId) => box.listEmailProviderConnections(t, accountId),
  );
  // The second read exists for one reason: the status of a connection is the
  // state of the box its credential is sealed to, and that is a fact about
  // the box, not about the connection.
  const boxes = useAccountScopedList<Box>("boxes", (t, accountId) =>
    box.listBoxes(t, accountId),
  );

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous" || token === null) return <SignedOut />;

  if (connections.notConfigured || boxes.notConfigured) {
    return (
      <Panel headingId="email-providers" title="Email providers">
        <p className="text-sm text-muted">
          Email providers are not configured on this deployment.
        </p>
      </Panel>
    );
  }

  if (connections.accountsFailed || boxes.accountsFailed) {
    return (
      <Panel headingId="email-providers" title="Email providers">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={() => {
            connections.retry();
            boxes.retry();
          }}
          title="We could not load your accounts."
        />
      </Panel>
    );
  }

  if (connections.loading || boxes.loading) {
    return (
      <Panel headingId="email-providers" title="Email providers">
        <LoadingState label="Loading your email providers…" />
      </Panel>
    );
  }

  if (connections.readFailed || boxes.readFailed) {
    return (
      <Panel headingId="email-providers" title="Email providers">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={() => {
            connections.retry();
            boxes.retry();
          }}
          title={LOAD_FAILED}
        />
      </Panel>
    );
  }

  if (connections.rows.length === 0) {
    return (
      <EmptyState title="No email providers connected">
        No provider is connected yet. Connect Cloudflare Email and the credential is
        sealed to your box's public key on the way in — we store the envelope and
        cannot open it.{" "}
        <TextLink href="/email-providers/cloudflare">Connect a provider</TextLink>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul aria-label="Your email providers" className="flex flex-col divide-y divide-border">
        {connections.rows.map(({ accountId, accountName, row }) => {
          // The box this connection is sealed to, found in this account's box
          // list. None found is a state the row renders honestly.
          const box = boxes.rows.find(
            (entry) => entry.accountId === accountId && entry.row.box_id === row.box_id,
          )?.row;
          return (
            <li key={`${accountId}-${row.id}`} className="flex flex-col gap-2 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{PROVIDER_LABEL[row.provider]}</span>
                <span className="font-mono text-xs text-muted">{row.account}</span>
              </div>
              <p className="text-sm text-muted">{connectionStatus(box)}</p>
              {row.provider === "cloudflare" ? (
                <p className="text-sm">
                  <TextLink href="/email-providers/cloudflare/dns">DNS records</TextLink>
                </p>
              ) : null}
              <DescriptionList
                items={[
                  { term: "Account", value: accountName },
                  {
                    term: "Box",
                    value: box ? `${box.box_id.slice(0, 8)}…` : `${row.box_id.slice(0, 8)}…`,
                  },
                  // Non-secret settings only, and only the ones this app can
                  // read as strings. A config key carrying anything else was
                  // dropped by the client's reader rather than rendered here.
                  ...Object.entries(row.config).map(([key, value]) => ({
                    term: key,
                    value,
                  })),
                ]}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-muted">
        To replace a credential, submit the connection form again with the new one.{" "}
        <TextLink href="/email-providers/cloudflare">Connect a provider</TextLink>
      </p>
    </div>
  );
}
