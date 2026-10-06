"use client";

/**
 * `/settings` — the profile screen, version 1: only the controls that work.
 *
 * ---------------------------------------------------------------------------
 * FOUR CONTROLS, AND THE FIFTH SECTION THAT IS NOT HERE
 * ---------------------------------------------------------------------------
 * Everything on this screen calls a route `src/lib/upstream.ts` already carries,
 * and nothing on it calls one it does not. That is the whole design rule, and
 * `page.tsx` says why at length; this file's job is to keep it true as the screen
 * grows. The sections with no route — display name, other sessions, second
 * factor, API tokens, delete account — are absent rather than disabled, so
 * "every control here works" stays a statement a person can check.
 *
 * ---------------------------------------------------------------------------
 * THE RESEND, AND WHY IT MAY NAME THE ADDRESS WHERE `/verify-email` MAY NOT
 * ---------------------------------------------------------------------------
 * `POST /v1/email-verifications` answers the same 202 for a registered address,
 * an unregistered one and one inside the cooldown, which is the whole of its
 * anti-enumeration defence. `verify-email-form.tsx` is reachable by a signed-out
 * visitor who typed somebody else's address, so that screen says nothing at all
 * about which addresses have accounts, and a test there compares two renderings
 * byte for byte.
 *
 * THIS control cannot be reached that way: the address is `session.user.email`,
 * which `GET /v1/me` returned for the token this screen already holds, and the
 * shell header is printing it on the same page. So there is nothing to protect
 * here by hiding it, and the resend is about a known person rather than a
 * stranger's guess.
 *
 * What carries over unchanged is the failure copy. A 503 is the service's own
 * declared fact — `Service.RequestVerification` calls `deliverable` BEFORE the
 * lookup, so 503-against-202 cannot be an existence oracle either — and it must
 * NOT borrow the acceptance sentence, because "check your inbox" when no mail
 * will ever arrive is the sentence that strands somebody. The 409 is still the
 * service's: an address proved in another tab between this page loading and this
 * click, which is why the badge is re-read rather than left contradicting the
 * note printed under it.
 *
 * ---------------------------------------------------------------------------
 * SENDING A LINK PROVES NOTHING, SO THE BADGE DOES NOT MOVE
 * ---------------------------------------------------------------------------
 * The only thing that flips `email_verified` is the link being followed. A badge
 * that turned green the moment a mail left would be this app asserting a fact
 * only the service knows, on the one screen whose job is to report the service's
 * answer faithfully.
 */

/** The acceptance sentence. Names the inbox, never a state this app guessed. */
const SENT = "Check your inbox for the verification link.";

/**
 * The 409, in this app's words.
 *
 * The same sentence `verify-email-form.tsx` uses, and for the same reason: the
 * state is the service's to declare, and the sentence names nothing but the
 * state. The address is already on this page and there is nothing to withhold.
 */
const ALREADY_VERIFIED =
  "That address is already verified, so there is nothing left to send.";

/** The deployment cannot send. Says so, and does not borrow SENT. */
const NO_MAIL =
  "This deployment cannot send email right now, so no verification link was sent. Try again later.";

const UNEXPECTED = "Something went wrong. Try again.";

const STATUS_FAILED = "We could not load the verification status for this address.";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SignedOut } from "./page";
import {
  Button,
  Callout,
  DescriptionList,
  ErrorState,
  LoadingState,
  Panel,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { IdentityError } from "@/lib/identity";
import { useNavigation } from "@/lib/navigation";
import { useVerificationStatus, verificationKey } from "@/lib/verification";

/**
 * A reader's wall-clock time, formatted.
 *
 * `undefined` for anything that is not an instant, because `toLocaleString` on
 * an invalid date returns the string "Invalid Date" — which would put the word
 * "Invalid" in front of somebody as though it were their session's fault. A
 * caller that cannot parse it renders "Not recorded" instead, which is the truth.
 */
const INSTANT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatInstant(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : INSTANT.format(at);
}

export function SettingsScreen() {
  const { session } = useAuth();

  // The same two branches `accounts-screen.tsx` has, for the same reason: the
  // header renders NEITHER signed-in nor signed-out controls while a stored token
  // is being exchanged, and a screen that showed "Sign in" in that frame would be
  // showing a signed-out affordance to somebody who is signed in.
  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous") return <SignedOut />;

  return (
    <div className="flex flex-col gap-8">
      <EmailPanel email={session.user.email} />
      <SessionPanel email={session.user.email} />
    </div>
  );
}

function EmailPanel({ email }: { email: string }) {
  const status = useVerificationStatus();

  if (status.isPending) return <LoadingState label="Loading your address…" />;

  if (status.isError) {
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => {
          void status.refetch();
        }}
        title={STATUS_FAILED}
      />
    );
  }

  const { email_verified: verified, email_verified_at: verifiedAt } = status.data;

  return (
    <Panel headingId="email" title="Email">
      <div className="flex flex-col gap-4">
        <DescriptionList
          items={[
            { term: "Address", value: status.data.email },
            // The service's own word for the fact, on both branches. A screen that
            // renamed "verified" to "confirmed" would ask a reader to translate.
            { term: "Verification", value: verified ? "Verified" : "Not verified" },
            ...(verified && verifiedAt
              ? [{ term: "Verified on", value: formatInstant(verifiedAt) ?? "Not recorded" }]
              : []),
          ]}
        />
        {/* Absent rather than disabled when the address is proved: the service
            refuses a resend for a proved address with a 409, so a control shown
            to somebody who does not need one is a control guaranteed to fail. */}
        {verified ? null : <ResendVerification email={email} />}
      </div>
    </Panel>
  );
}

type ResendState =
  | { kind: "idle" }
  /** The service's constant 202, which this screen does not read. */
  | { kind: "sent" }
  /** `ErrAlreadyVerified`, which is a 409. A race with another tab. */
  | { kind: "already-verified" }
  | { kind: "no-mail" }
  | { kind: "failed" };

function ResendVerification({ email }: { email: string }) {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ResendState>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  // `pending` is what the button renders from; this is what actually blocks the
  // second submit. The disabled button arrives a frame late, and a closure read
  // of `pending` would be stale in exactly that frame — the same split
  // `login-form.tsx` and `verify-email-form.tsx` make.
  const inFlight = useRef(false);

  async function resend() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setState({ kind: "idle" });
    try {
      // The body is a constant and is deliberately not read: there is nothing in
      // it about this address, and a screen that could branch on it is a screen
      // that could be made to.
      await client.requestEmailVerification(email);
      setState({ kind: "sent" });
    } catch (thrown) {
      if (thrown instanceof IdentityError && thrown.status === 409) {
        // The service says the address is proved and this screen's badge says it
        // is not, because the link was followed in another tab since this page
        // loaded. The service is the authority, so the badge is re-read rather
        // than the note being left to contradict it.
        setState({ kind: "already-verified" });
        await queryClient.invalidateQueries({ queryKey: verificationKey(token) });
      } else {
        setState(failureState(thrown));
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        `tone="positive"` and `tone="note"` both render `role="status"`, because
        nothing here is urgent: the same split `verify-email-form.tsx` makes. A
        503 gets `tone="critical"` and therefore `role="alert"`, which is right —
        that one is the only failure a person can act on immediately.
      */}
      {state.kind === "sent" ? <Callout tone="positive">{SENT}</Callout> : null}
      {state.kind === "already-verified" ? <Callout tone="note">{ALREADY_VERIFIED}</Callout> : null}
      {state.kind === "no-mail" ? <Callout tone="critical">{NO_MAIL}</Callout> : null}
      {state.kind === "failed" ? <Callout tone="critical">{UNEXPECTED}</Callout> : null}

      <div>
        {/* The same three the whole app uses: `busy` draws the spinner, and
            `disabled` + `aria-busy` announce it. A busy control keeps its name,
            so "Resend verification email" stays findable by voice mid-flight. */}
        <Button
          aria-busy={pending}
          busy={pending}
          disabled={pending}
          onClick={() => void resend()}
          variant="secondary"
        >
          Resend verification email
        </Button>
      </div>
    </div>
  );
}

function SessionPanel({ email }: { email: string }) {
  const { expiresAt, logout, pending } = useAuth();
  const router = useNavigation();

  async function onSignOut() {
    // Swallowed, and the reason is the header's: the local half happens inside
    // `logout`'s own `finally`, so a service that is already down must not be able
    // to keep somebody inside a session they asked to leave. This screen and the
    // header are the same store and the same promise.
    await logout().catch(() => undefined);
    void router.push("/login");
  }

  return (
    <Panel headingId="session" title="Session">
      <div className="flex flex-col gap-4">
        <DescriptionList
          items={[
            { term: "Signed in as", value: email },
            {
              term: "Session expires",
              // The one place the expiry is rendered, and it is formatted for a
              // reader. A session stored before this app kept the field has no
              // expiry to report, and "Not recorded" is the truth — a
              // reconstructed instant would be a claim nothing here can support.
              value: formatInstant(expiresAt) ?? "Not recorded",
            },
          ]}
        />

        {/* No confirmation dialog, deliberately. Sign-out is offered in the header
            with none, and it is the one control on this screen a person uses
            every time they leave; a dialog on this instance and not on that one
            would make the same action mean two different things. It is also the
            only control here whose effect the person can undo in one click. */}
        <div>
          <Button
            aria-busy={pending}
            busy={pending}
            disabled={pending}
            onClick={() => void onSignOut()}
            variant="secondary"
          >
            Sign out
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Picks the sentence out of a failure.
 *
 * Never `thrown.message`: a proxy's 502 carries a host and a port, and this is
 * the last hop before a person reads it.
 */
function failureState(thrown: unknown): ResendState {
  if (thrown instanceof IdentityError && thrown.status === 503) return { kind: "no-mail" };
  return { kind: "failed" };
}