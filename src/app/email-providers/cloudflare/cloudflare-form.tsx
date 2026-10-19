"use client";

/**
 * `/email-providers/cloudflare` — the connection form.
 *
 * ---------------------------------------------------------------------------
 * THE PROPERTY THIS SCREEN EXISTS FOR
 * ---------------------------------------------------------------------------
 * The credential a person types here crosses exactly once and in one
 * direction: browser → this app's BFF → Box, where it is sealed to
 * the box's public key (`create_sealed!`, boundary 6) and the plaintext is
 * gone. Box stores ciphertext it cannot open; this app receives the
 * stored row, which has no credential field at all.
 *
 * So this form NEVER reads a stored credential back, because there is
 * nothing on this side of the wire that could hold one:
 *
 *   * It takes no connection as a prop. Nothing prefills it — not the
 *     account, not the zone, not the credential. A replace is this same
 *     form submitted again with the new secret, which is honest: the row
 *     Box keeps is keyed box + provider + account, and a second POST
 *     for the same triple is a 409 this screen names, not a silent
 *     overwrite of a value nobody can compare.
 *   * The credential input is cleared the moment the submit succeeds,
 *     synchronously, before the success sentence is rendered. Nothing
 *     keeps it in a cache, a query key, or a piece of state with a longer
 *     life than the keystroke.
 *   * The only thing rendered on success is this file's own sentence. The
 *     typed value is not echoed into the confirmation, the page title, or
 *     the query cache the list screen reads — the list reads rows, and rows
 *     have no credential field to read.
 *
 * `page.test.tsx` asserts each of those against the DOM.
 *
 * ---------------------------------------------------------------------------
 * WHY A BOX IS REQUIRED BEFORE ANYTHING ELSE
 * ---------------------------------------------------------------------------
 * The credential is sealed to a box's public key, and a box that has not
 * reported a key cannot hold a connection — Box refuses it rather
 * than storing anything it could open. So the form does not offer to
 * proceed without one: no boxes means an explanation, not a disabled
 * submit. That is the same rule the settings screen keeps (an absent
 * surface is absent, not greyed), applied to the one field the whole form
 * is for.
 */

import { useRef, useState, type FormEvent } from "react";

import {
  Button,
  Callout,
  EmptyState,
  ErrorState,
  Field,
  FieldSummary,
  FormStack,
  Input,
  LoadingState,
  Panel,
  Select,
  TextLink,
} from "@/components/ui";
import { useAccountScopedList } from "@/lib/account-scope";
import { BOX_NOT_CONFIGURED_CODE, BoxError, type Box } from "@/lib/box";
import { useBox } from "@/lib/box-context";
import { useAuth } from "@/lib/auth";
import { SignedOut } from "./page";

/** The one conflict the unique index upstream declares, in this app's words. */
const DUPLICATE =
  "That box already has a Cloudflare connection for this account. Submit the form again to replace the stored credential.";

/**
 * The refusal for a box with no key to seal to.
 *
 * Box refuses a connection for a box that has not reported a public
 * key — deliberately, with no plaintext fallback — and the honest sentence
 * for it is about the box's enrollment, not about the credential.
 */
const NO_BOX_KEY =
  "That box has not reported a public key yet, so there is no key to seal this credential to. Finish enrolling the box first.";

const REFUSED = "We could not store that connection. Try again.";

const ACCOUNT_REQUIRED = "Enter the provider-side account identifier.";
const CREDENTIAL_REQUIRED = "Enter the credential to seal.";
const BOX_REQUIRED = "Choose the box this credential is sealed to.";

/** The stored row's fact, on success. Never the credential. */
const SAVED =
  "Connected. The credential is sealed to your box's public key — we store the envelope and cannot read it.";

const LOAD_FAILED = "We could not load your boxes.";

export function CloudflareConnectScreen() {
  const { session, token } = useAuth();
  const box = useBox();
  const boxes = useAccountScopedList<Box>("boxes", (t, accountId) =>
    box.listBoxes(t, accountId),
  );
  const [pending, setPending] = useState(false);
  // `pending` is what the button renders from; this is what actually blocks
  // the second submit. The disabled button arrives a frame late, and a
  // closure read of `pending` is stale in exactly that frame — the same
  // split every form in this app makes.
  const inFlight = useRef(false);

  // The four fields of the form. All of them start empty on every mount,
  // including after a success: there is no stored credential to read back
  // and no half-typed one to preserve across a page that is not submitting.
  const [boxId, setBoxId] = useState("");
  const [account, setAccount] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [credential, setCredential] = useState("");
  const [saved, setSaved] = useState(false);

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous" || token === null) return <SignedOut />;

  if (boxes.notConfigured) {
    return (
      <Panel headingId="connect-cloudflare" title="Connect Cloudflare Email">
        <p className="text-sm text-muted">Email providers are not configured on this deployment.</p>
      </Panel>
    );
  }

  if (boxes.accountsFailed || boxes.readFailed || boxes.loading) {
    if (boxes.loading) {
      return (
        <Panel headingId="connect-cloudflare" title="Connect Cloudflare Email">
          <LoadingState label="Loading your boxes…" />
        </Panel>
      );
    }
    return (
      <Panel headingId="connect-cloudflare" title="Connect Cloudflare Email">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={boxes.retry}
          title={LOAD_FAILED}
        />
      </Panel>
    );
  }

  if (boxes.rows.length === 0) {
    return (
      <EmptyState title="Enroll a box first">
        A credential is sealed to a box's public key, so a box has to exist before a
        provider can be connected. A box appears on the boxes screen once an enrollment
        capability is redeemed on the machine running the substrate.
      </EmptyState>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    if (boxId === "") {
      setFieldError(BOX_REQUIRED);
      return;
    }
    if (account.trim() === "") {
      setFieldError(ACCOUNT_REQUIRED);
      return;
    }
    if (credential.trim() === "") {
      setFieldError(CREDENTIAL_REQUIRED);
      return;
    }

    inFlight.current = true;
    setPending(true);
    setFieldError(null);
    setFailure(null);
    try {
      await box.createEmailProviderConnection(token as string, accountIdFor(boxId), {
        provider: "cloudflare",
        box_id: boxId,
        account: account.trim(),
        config: {
          ...(zoneId.trim() === "" ? {} : { zone_id: zoneId.trim() }),
          ...(fromAddress.trim() === "" ? {} : { from_address: fromAddress.trim() }),
        },
        credential,
      });
      // Cleared FIRST, synchronously, before anything renders a success. The
      // value's only copy is this component's state, and this is the line
      // that ends its life in the browser.
      setCredential("");
      setSaved(true);
    } catch (thrown) {
      setFailure(failureSentence(thrown));
      // The credential field keeps its value on a failure, because a person
      // who mistyped a 40-character token should not have to paste it again.
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  /**
   * The account the chosen box belongs to, from the box row itself.
   *
   * The form never asks the caller which account: the box knows, and a row
   * from another account can never be in this list.
   */
  function accountIdFor(chosen: string): string {
    const found = boxes.rows.find((entry) => entry.row.box_id === chosen);
    if (found === undefined) throw new Error("the chosen box is not in this account's box list");
    return found.accountId;
  }

  return (
    <Panel headingId="connect-cloudflare" title="Connect Cloudflare Email">
      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
        <p className="text-sm text-muted">
          The credential you enter is sealed to your box's public key before it is stored.
          It cannot be read back — not by this app, and not by us.
        </p>

        {failure ? <FieldSummary>{failure}</FieldSummary> : null}
        {saved ? (
          <Callout tone="positive">
            {SAVED}{" "}
            <TextLink href="/email-providers">Back to your email providers</TextLink>
          </Callout>
        ) : null}
        <p className="text-sm text-muted">
          Mail from a domain without its DNS records is not authenticated and lands in
          spam.{" "}
          <TextLink href="/email-providers/cloudflare/dns">
            See the records to publish
          </TextLink>
          , and check them once they are in place.
        </p>

        <FormStack>
          <Field
            hint="The box whose public key this credential is sealed to. Only your boxes are offered."
            id="cloudflare-box"
            label="Box"
          >
            <Select
              id="cloudflare-box"
              onChange={(event) => setBoxId(event.target.value)}
              value={boxId}
            >
              <option value="">Choose a box…</option>
              {boxes.rows.map(({ accountName, row }) => (
                <option key={`${row.account_id}-${row.box_id}`} value={row.box_id}>
                  {row.box_id.slice(0, 8)}… · {accountName} · {row.status} · {row.current_phase}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            error={fieldError === ACCOUNT_REQUIRED ? ACCOUNT_REQUIRED : undefined}
            hint="The provider-side account identifier — the address or zone name this connection sends from."
            id="cloudflare-account"
            label="Account"
          >
            <Input
              id="cloudflare-account"
              onChange={(event) => setAccount(event.target.value)}
              value={account}
            />
          </Field>

          <Field hint="Optional. The Cloudflare zone this connection sends from." id="cloudflare-zone" label="Zone id">
            <Input
              id="cloudflare-zone"
              onChange={(event) => setZoneId(event.target.value)}
              value={zoneId}
            />
          </Field>

          <Field
            hint="Optional. The address mail from this connection is sent from."
            id="cloudflare-from"
            label="From address"
          >
            <Input
              id="cloudflare-from"
              onChange={(event) => setFromAddress(event.target.value)}
              value={fromAddress}
            />
          </Field>

          <Field
            error={fieldError === CREDENTIAL_REQUIRED ? CREDENTIAL_REQUIRED : undefined}
            hint="The provider credential — the Cloudflare API token. It is sealed on the way in and never stored in a form anyone can read."
            id="cloudflare-credential"
            label="Credential"
          >
            {/* `autoComplete="off"` because a browser's password manager has
                nothing to offer here: this value is not an account password
                and a manager that filled it would be filling a box's secret
                into a field that outlives the page it was typed on. */}
            <Input
              autoComplete="off"
              id="cloudflare-credential"
              onChange={(event) => setCredential(event.target.value)}
              type="password"
              value={credential}
            />
          </Field>
        </FormStack>

        <div>
          <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
            Connect Cloudflare Email
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Places a failure: the sentence this app writes for the answer.
 *
 * Never `thrown.message`: a proxy's 502 carries a host and a port, and a
 * service's `message` is occurrence-specific. The 409 and the no-key 422 are
 * the two answers a person can act on, so they get their own sentence; the
 * 503 with `box_not_configured` is not a failure at all; everything
 * else is the one plain refusal.
 */
function failureSentence(thrown: unknown): string {
  if (thrown instanceof BoxError) {
    if (thrown.code === BOX_NOT_CONFIGURED_CODE) {
      return "Email providers are not configured on this deployment.";
    }
    if (thrown.status === 409) return DUPLICATE;
    if (thrown.status === 422) return NO_BOX_KEY;
  }
  return REFUSED;
}
