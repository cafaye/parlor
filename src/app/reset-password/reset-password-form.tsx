"use client";

/**
 * `/reset-password` — spending the emailed link.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE TOKEN COMES FROM, AND WHY IT IS A QUERY PARAMETER
 * ---------------------------------------------------------------------------
 *
 * The link is not built by the service. identity's `RecoveryMailer` renders a
 * `LinkTemplate` that a DEPLOYMENT configures through `RECOVERY_LINK_TEMPLATE`,
 * substituting the `{token}` placeholder; the resulting URL is what courier's
 * `password_reset` template puts behind "Choose a new password". Every example in
 * identity's own tests and wiring is `https://…/reset?token={token}`, so the
 * parameter name this screen reads is **`token`**, in a query string.
 *
 * That is a deployment setting, not a guarantee, which is why the missing-token
 * case below is a rendered state with a way forward rather than an exception:
 * somebody can configure the template to put the credential in a path segment,
 * and this screen's job then is to say so rather than throw.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR FAILURES, AND WHY EACH IS ITS OWN SENTENCE
 * ---------------------------------------------------------------------------
 *
 * `POST /v1/password-resets/confirm` answers 404 for everything that is not a
 * live token — one that never existed, one that expired, one already spent, one
 * minted for another flow — behind the single sentinel `ErrTokenNotFound`. There
 * is no honest way to tell those four apart, so this screen does not try: it says
 * the link cannot be used and offers the way to get a new one. It specifically
 * does NOT say "expired", because that would confirm the token was once real and
 * turn a guess into a probe.
 *
 * A 422 is the weak-password case and it speaks per field, exactly as on the
 * register form, because it is about the shape of a value rather than about what
 * exists.
 *
 * A 503 is this deployment not being able to send. It means NO reset link was
 * ever sent, so the sentence must not send anybody to their inbox.
 *
 * The fourth is everything else — a network failure, a proxy's 502 — and it gets
 * one generic sentence. `thrown.message` is never rendered; that is where a host
 * and a port live.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT SUBMIT ON LOAD
 * ---------------------------------------------------------------------------
 *
 * Same reason as the invitation screen: mail clients, chat apps and link scanners
 * fetch a URL to preview it. Spending the token on render would set somebody's
 * password before they chose one, and the link would be dead for the human who
 * then clicked it.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Button, Field, FieldSummary, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { validateNewPassword } from "@/lib/credentials";
import {
  IdentityError,
  MIN_PASSWORD_LENGTH,
  fieldErrorMessage,
  type FieldError,
} from "@/lib/identity";

/**
 * Where a successful reset goes, and what it tells the sign-in screen.
 *
 * The state is a QUERY PARAMETER rather than anything in session storage or a
 * context, for two reasons: it survives the navigation without a provider, and it
 * is a fact about a page load rather than about a person. `password-changed` is
 * the whole vocabulary; anything else renders nothing.
 */
export const RESET_DONE_PARAM = "password-changed";

/**
 * 404 from `ErrTokenNotFound`, and the wording is doing real work.
 *
 * The service answers one 404 for a token that never existed, one that expired,
 * one already spent, and one minted for another flow. So this sentence says only
 * that the link cannot be used — and deliberately does NOT speculate about which
 * of the four it was.
 *
 * The first draft said "it may have expired, or it may already have been used".
 * That reads as more careful and is strictly worse: it names two of the four as
 * the plausible ones, which tells anybody probing tokens that the one they held
 * had once been a good one. The same rule the invitation screen follows, and for
 * the same reason — `detail` is never rendered and a 404 never claims to know.
 */
const LINK_UNUSABLE =
  "That reset link cannot be used. Ask for a new one and use the link that arrives.";

const UNEXPECTED = "Something went wrong. Try again.";

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] }
  | { kind: "unusable-link" };

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const { client } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  // A ref, not `pending`: the disabled button lands a frame late, and a stale
  // closure read would let a second submit spend an already-spent token.
  const inFlight = useRef(false);

  const fields = state.kind === "local" || state.kind === "failed" ? state.fields : [];
  const errorFor = (field: string) => {
    const failure = fields.find((entry) => entry.field === field);
    return failure ? fieldErrorMessage(failure.field, failure.code) : undefined;
  };

  // No token is a real state, not an error: a deployment can point
  // `RECOVERY_LINK_TEMPLATE` at a path segment instead of `?token=`, and this
  // screen cannot read what it was not given. Saying so — with the way forward —
  // beats rendering a form that could only ever fail.
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <FieldSummary>That link is missing its reset code.</FieldSummary>
        <p className="text-sm text-muted">
          Ask for a new link and use the one that arrives.
        </p>
        <Button onClick={() => router.push("/forgot-password")} type="button" variant="secondary">
          Request a new link
        </Button>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const local = validateNewPassword({ password, confirmation });
    if (local.length > 0) {
      setState({ kind: "local", fields: local });
      return;
    }

    inFlight.current = true;
    setPending(true);
    setState({ kind: "idle" });
    try {
      await client.redeemPasswordReset({ token: token as string, password });
      // Nothing to clear locally. Redeeming revokes every session the account
      // holds — including one this browser is holding — so the stored token is
      // already dead and the sign-in screen will 401 it away on the next read.
      // Signing in again is the only route forward, which is what the 204 means.
      router.push(`/login?${RESET_DONE_PARAM}=1`);
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (state.kind === "unusable-link") {
    return (
      <div className="flex flex-col gap-4">
        <FieldSummary>{LINK_UNUSABLE}</FieldSummary>
        <Button onClick={() => router.push("/forgot-password")} type="button" variant="secondary">
          Request a new link
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

      <Field
        error={errorFor("password")}
        hint={`${MIN_PASSWORD_LENGTH} characters minimum.`}
        id="password"
        label="New password"
      >
        <Input
          // `new-password` rather than `current-password`: a password manager must
          // offer to generate one here, and offering to fill in the old one would
          // be the wrong suggestion on a screen whose whole job is replacing it.
          autoComplete="new-password"
          autoFocus
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </Field>

      <Field
        error={errorFor("password_confirmation")}
        id="password_confirmation"
        label="Confirm new password"
      >
        <Input
          autoComplete="new-password"
          name="password_confirmation"
          onChange={(event) => setConfirmation(event.target.value)}
          type="password"
          value={confirmation}
        />
      </Field>

      <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
        Change password
      </Button>
    </form>
  );
}

/**
 * Picks the sentence and the field list out of a failure.
 *
 * The same shape as `login-form.tsx`'s and `forgot-password-form.tsx`'s, for the
 * same reason: one failure style across the auth screens, so a person who has met
 * one has met all of them.
 */
function failureState(thrown: unknown): FormState {
  if (thrown instanceof IdentityError) {
    // 404 covers a token that never existed, one that expired, one already
    // spent, and one belonging to another flow. One sentence for all four.
    if (thrown.status === 404) {
      return { kind: "unusable-link" };
    }
    if (thrown.status === 503) {
      // This deployment cannot send mail, so the link in this browser was never
      // sent to begin with. Not "check your inbox".
      return {
        kind: "failed",
        summary: "This deployment cannot send email right now. Try again later.",
        fields: [],
      };
    }
    if (thrown.fieldErrors.length > 0) {
      // The weak-password case. `password` is the only field the service can name
      // here, and it is about the value's shape rather than about any account.
      return {
        kind: "failed",
        summary: "Check the highlighted fields and try again.",
        fields: thrown.fieldErrors,
      };
    }
  }

  return { kind: "failed", summary: UNEXPECTED, fields: [] };
}