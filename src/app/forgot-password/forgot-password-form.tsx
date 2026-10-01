"use client";

/**
 * The "forgot password" form — half one, and the half that must say nothing.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS FILE EXISTS FOR
 * ---------------------------------------------------------------------------
 *
 * `POST /v1/password-resets` answers `202 {"status":"accepted"}` for a registered
 * address, an unregistered one, and an address inside the one-minute cooldown. The
 * body is a CONSTANT in the service (`acceptedResponse`), and that is the whole
 * account-enumeration defence on the route.
 *
 * This screen's job is to not undo it in the last hop, where anyone can read it.
 * Concretely, that means:
 *
 *   - **The success sentence names no address and claims nothing about it.** It
 *     says what happens next for everybody. A screen that said "we sent a link to
 *     kaka@example.com" would confirm the account exists, and the constant 202
 *     would have been for nothing.
 *   - **A 422 is the only failure that names a field**, and it names `email` for a
 *     malformed address — the caller's own input, before any lookup. That is the
 *     same exception `login-form.tsx` takes, and for the same reason: it is about
 *     the shape of what was typed, not about what exists.
 *   - **A 503 gets its own sentence, and it is NOT the success sentence.** The
 *     service checks the mailer BEFORE looking the address up, so a 503 cannot
 *     distinguish a registered address from an unregistered one — and it is the
 *     one failure a person can act on, because "check your inbox" when no mail
 *     will ever arrive is the sentence that sends them away from the answer.
 *   - **Everything else is one generic sentence.** Never `thrown.message`: a
 *     502 from a proxy carries a host and a port.
 *
 * On success the form is REPLACED rather than annotated. A field left on screen
 * with "sent!" beside it invites a second submission, and the service answers a
 * second one inside the cooldown by sending nothing — so the second message would
 * be a promise the service cannot keep.
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
 * ONE string, and it is a constant rather than a template for the reason the
 * whole file opens with: anything interpolated here is a chance to say something
 * true of one address and not another.
 */
const CHECK_YOUR_INBOX =
  "If that address has an account here, a reset link is on its way. It works once, and it expires in 30 minutes.";

/** The deployment cannot send. Says so, and does not borrow the sentence above. */
const NO_MAIL =
  "This deployment cannot send email right now, so no reset link was sent. Try again later.";

const UNEXPECTED = "Something went wrong. Try again.";

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] }
  | { kind: "sent" };

export function ForgotPasswordForm() {
  const router = useRouter();
  const { client } = useAuth();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // `pending` is what the button renders from, and `inFlight` is what actually
  // blocks the second submit. They are different jobs and the split is the same
  // one `login-form.tsx` makes: the disabled button arrives a frame late, and a
  // stale closure read of `pending` would let the second click through anyway.
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
      await client.requestPasswordReset(email.trim());
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
          is urgent. Good news that arrived without anybody breaking anything does
          not cut across whatever was being read.
        */}
        <Callout tone="positive">{CHECK_YOUR_INBOX}</Callout>
        {/*
          Back to sign in rather than a second attempt, and the reason is the
          cooldown: `RequestWindow` is one minute and a request inside it mints
          nothing and sends nothing. Offering "send another" here would offer a
          control that silently does less than the button says.
        */}
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
          name — "Send reset link" is findable by voice mid-interaction. */}
      <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
        Send reset link
      </Button>
    </form>
  );
}

/**
 * Picks the sentence and the field list out of a failure.
 *
 * Mirrors `login-form.tsx`'s `failureState` rather than inventing a second style:
 * a 422 speaks per field, everything else speaks once in the summary, and
 * `thrown.message` is never rendered.
 */
function failureState(thrown: unknown): FormState {
  if (thrown instanceof IdentityError) {
    if (thrown.status === 503) {
      // Deliberately BEFORE the fieldErrors branch. A 503 here means the mailer
      // is unavailable, which is a fact about the deployment; the person must not
      // be told to watch an inbox nothing is going to arrive in.
      return { kind: "failed", summary: NO_MAIL, fields: [] };
    }
    if (thrown.fieldErrors.length > 0) {
      // Only ever `email`, and only ever about the shape of what was typed. This
      // is not an enumeration signal: the service validated before it looked
      // anything up.
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