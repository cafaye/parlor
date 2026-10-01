"use client";

/**
 * `/invitations/[token]` — redeeming an invitation.
 *
 * Three things this page is careful about, and all three come from the
 * service rather than from taste.
 *
 * **It does not accept on load.** `POST /v1/invitations/accept` adds the caller
 * to an account. Rendering a link in an email client, a chat preview, or a
 * link scanner would join somebody to a workspace they never chose to open. So
 * the mutation waits for a click.
 *
 * **It has three failure states, not two and not four.** identity's
 * `writeTenancyError` answers 404 for an unrecognised token, 410 for one that
 * is gone, and 409 for "you are already a member of this account". The 410
 * covers *both* expired and already-accepted under the same `gone` code, so
 * there is no honest way to tell them apart without parsing an English sentence
 * out of `detail` — and `detail` is never rendered here. So: two token states
 * and one membership state, each grounded in a status code.
 *
 * **A 404 never says "expired".** An unrecognised token and one that was never
 * issued get the same answer on purpose; saying "expired" would confirm the
 * token was once real and turn a guess into a probe.
 */

import Link from "next/link";
import { useRef, useState } from "react";

import { Button, ErrorState, FieldSummary, LoadingState } from "@/components/ui";
import { useAcceptInvitation } from "@/lib/accounts";
import { useAuth } from "@/lib/auth";
import { IdentityError, fieldErrorMessage, type Membership } from "@/lib/identity";
import { roleLabel } from "@/lib/roles";

/** Which answer the service gave, as far as this screen needs to know. */
type Outcome =
  | { kind: "idle" }
  | { kind: "accepted"; membership: Membership }
  | { kind: "unrecognised" }
  | { kind: "gone" }
  | { kind: "already-member" }
  | { kind: "retry" }
  | { kind: "invalid"; message: string };

export function InvitationScreen({ token }: { token: string }) {
  const { session } = useAuth();
  const accept = useAcceptInvitation();
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  // A ref, not `pending`: a second click can land in the frame before the
  // re-render that disables the button, and a stale closure read would let a
  // spent token be submitted twice.
  const inFlight = useRef(false);

  if (session.status === "loading") return <LoadingState label="Checking your session" />;

  if (session.status === "anonymous") {
    // The membership created by accepting belongs to the caller, so the service
    // requires a session. The page says so rather than offering a button that
    // can only 401.
    return (
      <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
        <h1 className="text-base font-medium">Sign in to accept this invitation</h1>
        <p className="mt-1 text-sm text-muted">
          Accepting makes you a member of the account, so it has to be the account you
          sign in to.
        </p>
        <p className="mt-4 text-sm">
          <Link
            className="font-medium underline underline-offset-2 hover:no-underline"
            href="/login"
          >
            Sign in
          </Link>
          <span className="text-muted"> · </span>
          <Link
            className="font-medium underline underline-offset-2 hover:no-underline"
            href="/accounts"
          >
            Your accounts
          </Link>
        </p>
      </section>
    );
  }

  if (token === "") {
    return (
      <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
        <h1 className="text-base font-medium">This link is incomplete</h1>
        <p className="mt-1 text-sm text-muted">
          The invitation link is missing its token. Ask for a new one.
        </p>
      </section>
    );
  }

  async function onAccept() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setOutcome({ kind: "idle" });
    try {
      const membership = await accept.mutateAsync({ token });
      setOutcome({ kind: "accepted", membership });
    } catch (thrown) {
      setOutcome(outcomeFor(thrown));
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  if (outcome.kind === "accepted") {
    return <Accepted membership={outcome.membership} />;
  }

  if (outcome.kind === "unrecognised") return <Unrecognised />;
  if (outcome.kind === "gone") return <Gone />;
  if (outcome.kind === "already-member") return <AlreadyMember />;

  if (outcome.kind === "invalid") {
    return (
      <section className="flex flex-col gap-4">
        <FieldSummary>{outcome.message}</FieldSummary>
        <Retry onRetry={onAccept} pending={pending} />
      </section>
    );
  }

  if (outcome.kind === "retry") {
    // A 5xx is the one failure here worth retrying, because it is the one that
    // says nothing about the invitation.
    return (
      <section className="flex flex-col gap-4">
        <ErrorState
          detail="We could not find out whether this invitation is still good."
          onRetry={onAccept}
          title="The service did not answer."
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">You have been invited</h1>
        <p className="mt-1 text-sm text-muted">
          Accepting makes you a member of the account that sent this link. Nothing
          happens until you choose to.
        </p>
        {/* There is no `GET /v1/invitations/{token}` on the service, so this
            page cannot show which account the invitation is for, who sent it, or
            what role it grants — the role only arrives in the accept *response*.
            Saying so is better than a bare "Accept": somebody should not join a
            workspace on the strength of a link with no indication of what it is. */}
        <p className="mt-2 text-sm text-muted">
          We cannot show you which account this is until you accept it.
        </p>
      </div>
      <div>
        <Button aria-busy={pending} busy={pending} disabled={pending} onClick={() => void onAccept()}>
          Accept invitation
        </Button>
      </div>
    </section>
  );
}

function Accepted({ membership }: { membership: Membership }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">You are in</h1>
        <p className="mt-1 text-sm text-muted">
          You joined as {roleLabel(membership.role).toLowerCase()}.
        </p>
      </div>
      <p className="text-sm">
        <Link
          className="font-medium underline underline-offset-2 hover:no-underline"
          href={`/accounts/${membership.account_id}`}
        >
          Go to the account
        </Link>
      </p>
    </section>
  );
}

function Unrecognised() {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h1 className="text-base font-medium">Invitation not recognised</h1>
      {/* No "expired" here, deliberately. The service answers 404 the same way
          for a token that was never issued, and saying the invitation once
          existed would turn a guessed link into a working probe. */}
      <p className="mt-1 text-sm text-muted">
        This link does not match any invitation. It may have been copied incompletely, or
        the person who sent it may have made it up.
      </p>
      <p className="mt-4 text-sm">
        <Link
          className="font-medium underline underline-offset-2 hover:no-underline"
          href="/accounts"
        >
          Your accounts
        </Link>
      </p>
    </section>
  );
}

function Gone() {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h1 className="text-base font-medium">This invitation can no longer be used</h1>
      {/* One state for both expired and already-accepted, because the service
          gives both the same 410 and the same `gone` code, and the only thing
          that separates them is a sentence in `detail` — which this app does
          not render. The advice is the same either way. */}
      <p className="mt-1 text-sm text-muted">
        Ask somebody with access to the account to send you a new invitation.
      </p>
      <p className="mt-4 text-sm">
        <Link
          className="font-medium underline underline-offset-2 hover:no-underline"
          href="/accounts"
        >
          Your accounts
        </Link>
      </p>
    </section>
  );
}

function AlreadyMember() {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h1 className="text-base font-medium">You are already a member</h1>
      {/* The state the caller asked for already holds. The advice is to go and
          look, not to ask for a new invitation — and there is no retry button,
          because a retry is a guaranteed 409. */}
      <p className="mt-1 text-sm text-muted">
        This account is already one of yours, so there was nothing to accept.
      </p>
      <p className="mt-4 text-sm">
        <Link
          className="font-medium underline underline-offset-2 hover:no-underline"
          href="/accounts"
        >
          Your accounts
        </Link>
      </p>
    </section>
  );
}

function Retry({ onRetry, pending }: { onRetry(): void; pending: boolean }) {
  return (
    <div>
      <Button aria-busy={pending} busy={pending} disabled={pending} onClick={onRetry} variant="secondary">
        Try again
      </Button>
    </div>
  );
}

/**
 * Maps a failure to one of the states above.
 *
 * The mapping is on the status, never on the message. `detail` is not a stable
 * contract — the service documents it as "specific to this occurrence and not
 * parsed by clients" — and branching on it would make this screen break the day
 * somebody rewords a sentence.
 */
function outcomeFor(thrown: unknown): Outcome {
  if (thrown instanceof IdentityError) {
    switch (thrown.status) {
      case 404:
        return { kind: "unrecognised" };
      case 410:
        return { kind: "gone" };
      case 409:
        return { kind: "already-member" };
      case 422:
        return { kind: "invalid", message: fieldErrorMessage("token", thrown.fieldErrors[0]?.code ?? "required") };
      default:
        // 401 here means the session died between the render and the click;
        // the header has already reacted to it. Anything else is the service
        // being unable to answer, which is not evidence about the invitation.
        return { kind: "retry" };
    }
  }
  return { kind: "retry" };
}
