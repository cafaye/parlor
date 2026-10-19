"use client";

/**
 * The mint behind the `/box` page's "Your box" path.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * The page above names three commands — `cafe box init`, the install front
 * door, and the enroll — and the enroll is the one that needs something no
 * static page can carry: a single-use, minutes-lived capability Box mints
 * for a NEW box id (`POST /v1/accounts/{account_id}/capabilities`, body
 * `{box_id, purpose: "box.enroll"}`). This island is that missing step: a
 * signed-in visitor presses a button, the mint runs, and the token is shown
 * once with its expiry and the two commands ready to paste.
 *
 * The box id is generated HERE, in the browser, with `crypto.randomUUID()` —
 * Box never invents it, it only binds the capability to the id it is given,
 * which is the same rule the boxes list's own header states. Regenerating is
 * a second mint for a second id; the old token is not revoked, it expires on
 * its own, and the screen says so rather than implying otherwise.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN IS FED OVER STDIN, NEVER IN ARGV
 * ---------------------------------------------------------------------------
 * The enroll command below carries `--token -`, the stdin form: the person
 * pipes the token in rather than typing it after a flag, so it never lands in
 * a shell history, a process list, or a pasted log line. A screen that showed
 * `--token <capability>` would be teaching the argv form, which is the one
 * thing this page must never do.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SIGNED-OUT VISITOR GETS
 * ---------------------------------------------------------------------------
 * One sentence and a sign-in link. The mint is member-scoped — Box resolves
 * the caller through identity — so there is nothing to show until there is a
 * session to mint with, and a mock of the minted state would be a promise
 * this screen cannot keep.
 */

import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { Button, Callout, ErrorState, LoadingState } from "@/components/ui";
import { useAccounts } from "@/lib/accounts";
import { useAuth } from "@/lib/auth";
import { BOX_NOT_CONFIGURED_CODE, BoxError, type BoxCapability } from "@/lib/box";
import { useBox } from "@/lib/box-context";

import { CommandLine } from "./command-line";

/**
 * The enroll command in its stdin form. The install is NOT repeated here:
 * the complete parameterized block sits in the path directly above this
 * island (`InstallBlock`, from the one list in `install-inputs.ts`), so a
 * second copy would be a second list to drift — the minted view points at it.
 *
 * `--token -` reads the token from stdin: the person pastes the minted token
 * into the pipe rather than into the command line. The address is the box
 * service's front door, the same fixed destination every enroll uses.
 */
export const ENROLL_COMMAND = "cafe box enroll --token - --box https://box.svc.cafaye.com";

/** Which answer the mint gave, as far as this island needs to know. */
type Outcome =
  | { kind: "idle" }
  | { kind: "minted"; capability: BoxCapability }
  | { kind: "expired" }
  | { kind: "refused"; message: string }
  | { kind: "not-configured" }
  | { kind: "failed" };

export function EnrollCapability() {
  const { session, token } = useAuth();

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous" || token === null) return <SignInFirst />;

  return <Minter token={token} />;
}

/**
 * What a signed-out visitor is shown instead of the mint.
 *
 * One sentence and the sign-in link. No preview of the minted state, no
 * disabled button standing in for it: a control that cannot work is worse
 * than no control.
 */
function SignInFirst() {
  return (
    <p className="text-sm text-muted">
      <Link
        className="font-medium underline underline-offset-2 hover:no-underline"
        to="/login"
      >
        Sign in
      </Link>{" "}
      to mint the enrollment token your box needs.
    </p>
  );
}

function Minter({ token }: { token: string }) {
  const box = useBox();
  const accounts = useAccounts();
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  // A ref, not `pending`: a second click can land in the frame before the
  // re-render that disables the button, and a stale closure read would mint
  // a second capability for a box that only needs one.
  const inFlight = useRef(false);

  if (accounts.isPending) return <LoadingState label="Loading your accounts…" />;

  if (accounts.isError) {
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => void accounts.refetch()}
        title="We could not load your accounts."
      />
    );
  }

  const list = accounts.data ?? [];
  if (list.length === 0) {
    return (
      <p className="text-sm text-muted">
        Enrollment tokens belong to an account, and you are in none yet.{" "}
        <Link
          className="font-medium underline underline-offset-2 hover:no-underline"
          to="/accounts"
        >
          Open your accounts
        </Link>{" "}
        to create one first.
      </p>
    );
  }
  // The mint is per account and this page names none, so the capability is
  // minted under the first account and the screen says which one — a second
  // account's token is a second mint the visitor asks for from that account.
  const account = list[0];

  async function onMint() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setOutcome({ kind: "idle" });
    try {
      const capability = await box.mintBoxCapability(token, account.id, crypto.randomUUID());
      setOutcome({ kind: "minted", capability });
    } catch (thrown) {
      setOutcome(outcomeFor(thrown));
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  if (outcome.kind === "minted") {
    return (
      <Minted
        accountName={account.name}
        capability={outcome.capability}
        onAgain={() => void onMint()}
        pending={pending}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {outcome.kind === "expired" ? (
        <Callout title="Your session expired" tone="caution">
          <p className="text-sm">
            Sign in again to mint a token — the one this page would have minted
            was never created.{" "}
            <Link
              className="font-medium underline underline-offset-2 hover:no-underline"
              to="/login"
            >
              Sign in
            </Link>
          </p>
        </Callout>
      ) : null}

      {outcome.kind === "refused" ? (
        <Callout title="The mint was refused" tone="critical">
          <p className="text-sm">{outcome.message}</p>
        </Callout>
      ) : null}

      {outcome.kind === "not-configured" ? (
        <p className="text-sm text-muted">Boxes are not configured on this deployment.</p>
      ) : null}

      {outcome.kind === "failed" ? (
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={() => void onMint()}
          title="We could not mint a token."
        />
      ) : null}

      {outcome.kind === "idle" || outcome.kind === "refused" ? (
        <div className="flex flex-col gap-2">
          <div>
            {/* `void` for the reason `releases/$releaseId` spells out: the
                button's `onClick` is typed `() => void`, and `onMint`
                catches every failure itself and renders it into `outcome`. */}
            <Button
              aria-busy={pending}
              busy={pending}
              disabled={pending}
              onClick={() => void onMint()}
            >
              {outcome.kind === "idle" ? "Mint an enrollment token" : "Mint again"}
            </Button>
          </div>
          <p className="text-sm text-muted">
            The token will be minted under {account.name} — single-use, expiring within
            minutes.
          </p>
          <p className="text-sm text-muted">
            Minting from an agent instead of this browser? Run{" "}
            <code className="font-mono text-xs">cafe box mint</code> — it mints the same
            token, and the enroll below still reads it over stdin.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The minted capability, shown once, with the enroll ready to paste.
 *
 * In the order the person uses them: the box id first (what the token is
 * bound to), then the token itself with its expiry and the single-use
 * sentence, then the enroll. The install is not repeated — the complete
 * block sits directly above this island — so the enroll is introduced by
 * the sentence that says so. Regenerating mints again —
 * a new capability for a new box id — and the old token is left to expire on
 * its own rather than revoked, which is what the sentence under the button
 * says.
 */
function Minted({
  accountName,
  capability,
  onAgain,
  pending,
}: {
  accountName: string;
  capability: BoxCapability;
  onAgain: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium" id="enroll-box-id">
          Box id
        </p>
        <code
          aria-labelledby="enroll-box-id"
          className="block break-all rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs"
        >
          {capability.box_id}
        </code>
      </div>
      <TokenOnce token={capability.token} expiresAt={capability.expires_at} />
      <p className="text-sm text-muted">
        The install block above already carries every value — fill it in and run it, then
        enroll:
      </p>
      <CommandLine command={ENROLL_COMMAND} copyLabel="the enroll command" />
      <div className="flex flex-col gap-2">
        <div>
          <Button
            aria-busy={pending}
            busy={pending}
            disabled={pending}
            onClick={onAgain}
            variant="secondary"
          >
            Mint a new token
          </Button>
        </div>
        <p className="text-sm text-muted">
          Minted under {accountName}. Minting again replaces the token above; the old one
          expires on its own.
        </p>
      </div>
    </div>
  );
}

/**
 * The minted token, shown once.
 *
 * The token is the credential. It is rendered in a mono block with a copy
 * button — the human's path from this browser to their box's stdin — and its
 * expiry, because a minutes-lived TTL is the bound on a leaked token's
 * usefulness and the person holding it should know the window is short.
 */
function TokenOnce({ token, expiresAt }: { token: string; expiresAt: string | null }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // A clipboard that refuses (a non-secure context, a denied
      // permission) is not a failure worth a second UI: the token is still
      // on the screen and selectable.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium" id="enroll-token">
        Enrollment token — shown once
      </p>
      <p className="text-sm text-muted">
        This token can be used once and
        {expiresAt ? ` expires at ${new Date(expiresAt).toLocaleString()}` : " expires within minutes"}.
        Feed it to the enroll command over stdin; it never goes in the command line.
      </p>
      <code
        aria-labelledby="enroll-token"
        className="block break-all rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs"
      >
        {token}
      </code>
      <div>
        <Button size="sm" variant="secondary" onClick={() => void onCopy()}>
          {copied ? "Copied" : "Copy token"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Maps a mint failure to one of the states above.
 *
 * The mapping is on the status and the code, never on the message. A 401 is
 * the session being dead, which is a different fact from the service being
 * down; a 422 is the service refusing this mint, and its message is the
 * service's own sentence about why. `detail` is never rendered: it is
 * occurrence-specific, and a screen writes its own sentence.
 */
function outcomeFor(thrown: unknown): Outcome {
  if (thrown instanceof BoxError) {
    if (thrown.status === 401) return { kind: "expired" };
    if (thrown.status === 422 || thrown.code === "unprocessable") {
      return { kind: "refused", message: thrown.message };
    }
    if (thrown.code === BOX_NOT_CONFIGURED_CODE) return { kind: "not-configured" };
  }
  return { kind: "failed" };
}
