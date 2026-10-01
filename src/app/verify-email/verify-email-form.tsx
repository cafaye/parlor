"use client";

/**
 * `/verify-email` — asking for a verification link, and asking again.
 *
 * This is the resend surface, and it is reachable by anybody: a signed-out person
 * who typed somebody else's address is exactly the shape of the attack that the
 * service's constant 202 exists to refuse. So everything about the argument for
 * this screen is the argument in `forgot-password-form.tsx`, and it is restated
 * here because the two screens must not drift apart.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE, AND THE ONE PLACE IT IS NOT ONE
 * ---------------------------------------------------------------------------
 *
 * `POST /v1/email-verifications` answers `202 {"status":"accepted"}` for an
 * address with an account, one without, and one inside the one-minute cooldown.
 * `acceptedResponse` in the service is a CONSTANT, and that is the whole of the
 * enumeration defence on the route — so this screen's job is not to undo it in
 * the last hop, where anyone can read it:
 *
 *   - **The acceptance sentence names no address.** Anything interpolated into it
 *     is a chance to say something true of one address and not another.
 *   - **A 422 is the only failure that names a field**, and it names `email` for
 *     a malformed address — the caller's own input, checked before the service
 *     looks anything up. Same exception `login-form.tsx` takes, same reason.
 *   - **A 503 gets its own sentence and is NOT the acceptance sentence.**
 *     `Service.RequestVerification` calls `deliverable` BEFORE the lookup, so
 *     503-against-202 cannot distinguish a registered address from an
 *     unregistered one. It is also the one failure a person can act on: "check
 *     your inbox" when no mail will ever arrive is the sentence that strands
 *     somebody.
 *   - **Everything else is one generic sentence.** Never `thrown.message`: a
 *     proxy's 502 carries a host and a port.
 *
 * **THE 409 IS THE EXCEPTION, AND IT IS THE SERVICE'S.** `RequestVerification`
 * checks `user.IsVerified()` after the lookup, so an address whose verification
 * is already done answers 409 where every other address answers 202. That does
 * tell a prober that an address has an account, and the alternative here was to
 * flatten it into the acceptance sentence — which was rejected, because identity
 * declares the 409 in order to stop a client telling somebody to watch an inbox
 * nothing is going to arrive in. "Check your inbox" on a proved address is a lie
 * that costs a person the answer; the disclosure is narrower, and it is the
 * service's to make. What this screen guarantees is that it never *widens* it:
 * the 409 sentence names the state and not the address, and never the service's
 * own words.
 *
 * On success the form is REPLACED, for the same reason and with the same cooldown
 * reasoning as the reset screen: a field left beside "sent!" invites a second
 * submission, and the service answers a second one inside the window by sending
 * nothing.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Button, Callout, Field, FieldSummary, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { validateRecoveryEmailRequest } from "@/lib/credentials";
import { IdentityError, fieldErrorMessage, type FieldError } from "@/lib/identity";

/**
 * What a person is told after any accepted request.
 *
 * ONE string, and a constant rather than a template for the reason the whole
 * file opens with. It also does not promise a delivery time: the service bounds
 * mail at one message per address per minute and does not queue behind anything,
 * so a sentence with a number in it would be a number this app cannot keep.
 *
 * The one fact it does carry is "has not been verified yet", which is the whole
 * reason a person is on this screen at all and is true of everybody it is shown
 * to — the address is not named, and nothing about whether it exists is claimed.
 */
const CHECK_YOUR_INBOX =
  "If that address has an account here and has not been verified yet, a verification link is on its way.";

/**
 * The 409, in this app's words.
 *
 * Names the state and nothing else — no address, no suggestion of an account
 * beyond the fact it is already verified, and nothing from the service's `detail`.
 * "Verified" rather than "confirmed" because that is the service's own word for
 * the fact (`email_verified`, `ErrAlreadyVerified`), and a screen that renamed it
 * would be asking a reader to translate.
 */
const ALREADY_VERIFIED =
  "That address is already verified, so there is nothing to send. You can sign in and use the account as it is.";

/** The deployment cannot send. Says so, and does not borrow the sentence above. */
const NO_MAIL =
  "This deployment cannot send email right now, so no verification link was sent. Try again later.";

const UNEXPECTED = "Something went wrong. Try again.";

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] }
  | { kind: "sent" }
  | { kind: "already-verified" };

export function VerifyEmailForm() {
  const router = useRouter();
  const { client } = useAuth();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // `pending` is what the button renders from, and `inFlight` is what actually
  // blocks the second submit — the same split `login-form.tsx` and
  // `forgot-password-form.tsx` make. The disabled button arrives a frame late,
  // and a stale closure read of `pending` would let the second click through in
  // exactly that frame.
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const fields = state.kind === "local" || state.kind === "failed" ? state.fields : [];
  const errorFor = (field: string) => {
    const failure = fields.find((entry) => entry.field === field);
    return failure ? fieldErrorMessage(failure.field, failure.code) : undefined;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const local = validateRecoveryEmailRequest({ email });
    if (local.length > 0) {
      setState({ kind: "local", fields: local });
      return;
    }

    inFlight.current = true;
    setPending(true);
    setState({ kind: "idle" });
    try {
      await client.requestEmailVerification(email.trim());
      // The body is a constant and is deliberately not read: there is nothing in
      // it about this address, and a screen that could branch on it is a screen
      // that could be made to.
      setState({ kind: "sent" });
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="flex flex-col gap-4">
        {/*
          `tone="positive"` already renders `role="status"`: `Callout` picks
          `alert` only for a critical tone, and nothing about this announcement
          is urgent. Good news that arrived without anybody breaking anything
          does not cut across whatever was being read.
        */}
        <Callout tone="positive">{CHECK_YOUR_INBOX}</Callout>
        {/*
          Back to sign in rather than a second attempt, for the same reason the
          reset screen offers no second send: the cooldown is a minute and a
          request inside it mints nothing and sends nothing, so "send another"
          here is a control that silently does less than the button says.
        */}
        <Button onClick={() => router.push("/login")} type="button" variant="secondary">
          Back to sign in
        </Button>
      </div>
    );
  }

  if (state.kind === "already-verified") {
    return (
      <div className="flex flex-col gap-4">
        {/*
          `tone="note"` and not `critical`: an address that is already confirmed
          is an answer, not something the person got wrong, and a critical tone
          would render `role="alert"` and interrupt whatever they were reading
          for news they did not need urgently.
        */}
        <Callout tone="note">{ALREADY_VERIFIED}</Callout>
        <Button onClick={() => router.push("/login")} type="button" variant="secondary">
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
      {state.kind === "local" || state.kind === "failed" ? (
        <FieldSummary>
          <ul className="list-inside list-disc">
            {state.kind === "failed" && state.summary ? <li>{state.summary}</li> : null}
            {state.fields.map((failure) => (
              <li key={`${failure.field}:${failure.code}`}>
                {fieldErrorMessage(failure.field, failure.code)}
              </li>
            ))}
          </ul>
        </FieldSummary>
      ) : null}

      <Field error={errorFor("email")} id="email" label="Email">
        <Input
          autoComplete="email"
          autoFocus
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
      </Field>

      {/* All three, per the design system: `busy` draws the spinner, and
          `disabled` + `aria-busy` are what announce it. A busy control keeps its
          name, so "Send verification link" stays findable by voice mid-flight. */}
      <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
        Send verification link
      </Button>
    </form>
  );
}

/**
 * Picks the sentence and the field list out of a failure.
 *
 * The same shape and the same order as `forgot-password-form.tsx`'s, and that is
 * deliberate: one failure style across the auth screens, so a person who has met
 * one has met all of them. A 422 speaks per field, a 503 and a 409 speak once in
 * the summary, and `thrown.message` is never rendered.
 */
function failureState(thrown: unknown): FormState {
  if (thrown instanceof IdentityError) {
    // Deliberately BEFORE the fieldErrors branch, and for the same reason as on
    // the reset screen: a 503 means the mailer is unavailable, which is a fact
    // about the deployment, and the person must not be sent to an inbox nothing
    // is going to arrive in.
    if (thrown.status === 503) {
      return { kind: "failed", summary: NO_MAIL, fields: [] };
    }
    // `ErrAlreadyVerified`, which the service writes as a 409 conflict. Checked
    // on the STATUS rather than on `code === "conflict"` because the register
    // screen's 409 is a different answer about a different thing, and borrowing
    // its wording here would say "that address is already registered" to someone
    // whose address is registered and confirmed.
    if (thrown.status === 409) {
      return { kind: "already-verified" };
    }
    if (thrown.fieldErrors.length > 0) {
      // Only ever `email`, and only ever about the shape of what was typed. Not
      // an enumeration signal: the service validates before it looks anything up.
      return {
        kind: "failed",
        summary: "Check the highlighted fields and try again.",
        fields: thrown.fieldErrors,
      };
    }
    // 400 and 413 land here too. A body this service did not accept is not
    // something to describe to a person in the service's words.
  }

  return { kind: "failed", summary: UNEXPECTED, fields: [] };
}