"use client";

/**
 * The login form.
 *
 * The one rule that shapes this file: a refused sign in says the same thing
 * every time.
 *
 * The service answers a wrong password and an unknown address with the same
 * 401, on purpose — the response must not be an account-existence oracle. If
 * this screen turned "401" into "we could not find that address" for the first
 * case, the service's careful answer would be undone in the last hop, where
 * anyone can read it. So: one sentence, in the summary region, naming no
 * field, and not repeated back as an address.
 *
 * Local validation is the exception, because it runs before the service is
 * asked anything and its message is about the shape of what was typed, not
 * about what exists.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND FACTOR, WHICH IS A FORM RATHER THAN A BRANCH
 * ---------------------------------------------------------------------------
 * `POST /v1/session` does not always mint a session. For an account with a
 * confirmed second factor it answers 202 with a challenge and sets the
 * `__Host-mfa-challenge` cookie — the credentials were accepted and the
 * authentication is not finished. This form therefore has two states: the
 * password form, and the code prompt that follows a 202.
 *
 * The prompt is a separate form rather than a field that appears inside the
 * password one, because the two have different submit buttons, different
 * failures and different things to protect. What it is NOT is a second
 * feature: the challenge is a one-time credential that lives in component
 * state for the span of the prompt and is never rendered, never stored and
 * never logged.
 */

import { Link } from "@tanstack/react-router";
import { useNavigation } from "@/lib/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Button, Callout, Field, FieldSummary, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { validateSignIn } from "@/lib/credentials";
import { IdentityError, fieldErrorMessage, type FieldError } from "@/lib/identity";

/**
 * The query parameter a completed reset sends you back with.
 *
 * It is a fact about a page load, not about a person, so it lives in the URL
 * rather than in session storage or a context: it survives the navigation with
 * nothing to carry it, and there is no state to clear afterwards. The value is
 * ignored entirely — only the parameter's PRESENCE is read, because "a password
 * was just changed somewhere else" is the whole message and there is nothing in
 * it worth varying.
 *
 * `reset-password/reset-password-form.tsx` is where the redirect is written, and
 * this is the other end of that pair.
 */
export const PASSWORD_CHANGED_PARAM = "password-changed";

const PASSWORD_CHANGED =
  "Your password has been changed. Sign in with the new one.";

/** One sentence, every time, for every refused sign in. */
const INVALID_CREDENTIALS = "Invalid email or password.";

const UNEXPECTED = "Something went wrong. Try again.";

/**
 * One sentence for every refused second factor, whatever the cause.
 *
 * The service answers a wrong TOTP code, a spent recovery code, a code whose
 * step was already used, a malformed value and a rotated-away secret with the
 * same 401 and the same body, on purpose: five different facts, and an
 * attacker who can tell them apart learns which to keep trying. This screen
 * keeps that collapse — it reads the status and nothing else, so the sentence
 * is the same for all five.
 */
const CODE_REFUSED = "That code was not accepted.";

/**
 * The deployment cannot verify a second factor.
 *
 * A 503 on the second leg is `MFA_ENCRYPTION_KEY` unset — a deployment problem,
 * not a wrong code. Presenting it as a refusal would send somebody to check an
 * app that is producing perfectly good codes, so the sentence says what is
 * actually wrong and does not ask them to try the same code again.
 */
const MFA_UNAVAILABLE =
  "This deployment cannot verify a second factor right now. Try again later.";

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] }
  | { kind: "second_factor"; challenge: string };

export function LoginForm({ passwordChanged = false }: { passwordChanged?: boolean } = {}) {
  const router = useNavigation();
  const { login, adoptSession, client, pending } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // The second leg's own state. `pending` above covers the login mutation; this
  // one covers the code submission, which is a direct client call rather than
  // a mutation, so the context's `pending` does not know about it.
  const [code, setCode] = useState("");
  const [secondFactorPending, setSecondFactorPending] = useState(false);
  const [secondFactorFailed, setSecondFactorFailed] = useState<string | null>(null);
  // `pending` disables the button, but a second click can land in the frame
  // between the click and the re-render that disables it — and a stale closure
  // would still say `false` there. A ref is set synchronously, so this is the
  // only guard that actually closes the window. One ref serves both forms
  // because only one of them is mounted at a time.
  const inFlight = useRef(false);

  const fields = state.kind === "local" || state.kind === "failed" ? state.fields : [];
  const errorFor = (field: string) => {
    const failure = fields.find((entry) => entry.field === field);
    return failure ? fieldErrorMessage(failure.field, failure.code) : undefined;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second attempt on one click is a second guess with the same answer.
    if (inFlight.current) return;

    const local = validateSignIn({ email, password });
    if (local.length > 0) {
      setState({ kind: "local", fields: local });
      return;
    }

    inFlight.current = true;
    setState({ kind: "idle" });
    try {
      const result = await login({ email: email.trim(), password });
      if (result.kind === "mfa_required") {
        // The credentials were accepted and a second factor is owed. The
        // challenge goes into state for the span of the prompt and nowhere
        // else — it is a one-time credential, not a value to render or store.
        // The code field starts empty and the prompt takes over the form.
        setCode("");
        setSecondFactorFailed(null);
        setState({ kind: "second_factor", challenge: result.challenge });
        return;
      }
      // The token is now in the store, which is what re-renders the header.
      // No `refresh()`: nothing this process renders depends on the token yet.
      // It earns its place when the BFF packet puts the session in a cookie
      // and server components have to see it.
      //
      // `void`, and NOT `await` — which is the fix that looks obvious and is
      // wrong here. Awaiting puts the navigation inside this `try`, so a
      // navigation that fails would be caught by the arm below and rendered as
      // `INVALID_CREDENTIALS`: "Invalid email or password" to somebody who has
      // just signed in correctly. A failed navigation is not a refused sign-in
      // and this screen must never say it is. `void` says what happens instead:
      // the navigation was requested, and if it does not complete the reader is
      // still on a page that is now signed in.
      void router.push("/");
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  /**
   * The second leg: spend the challenge on a code.
   *
   * On the 200 the sign-in is finished, and it is finished exactly the way the
   * password path finishes it — `adoptSession` writes the token to the same
   * store the login mutation writes, which changes the query key, starts the
   * `me` fetch and re-renders the header. The navigation is the same `void`
   * push for the same reason: a failed navigation is not a refused sign-in.
   */
  async function onSecondFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSecondFactorPending(true);
    setSecondFactorFailed(null);
    try {
      const session = await client.completeSecondFactor({
        challenge: state.kind === "second_factor" ? state.challenge : "",
        code,
      });
      adoptSession(session);
      void router.push("/");
    } catch (thrown) {
      // A refused code leaves the prompt up: the person can check the app and
      // try again, and nothing was changed by the refusal. The code is cleared
      // because it was refused — leaving it in the field invites a resubmit of
      // the same value.
      setSecondFactorFailed(secondFactorFailureSentence(thrown));
      setCode("");
    } finally {
      inFlight.current = false;
      setSecondFactorPending(false);
    }
  }

  /**
   * Abandon the second factor and go back to the password form.
   *
   * The challenge is one-time and is not spent by abandoning it — going back
   * discards it, which is the honest reading of a credential this app never
   * presented. The email and password survive the round trip because they are
   * state on this component, not on the form that was replaced: a person who
   * came to the prompt by mistake should not have to retype everything.
   */
  function abandonSecondFactor() {
    setState({ kind: "idle" });
    setSecondFactorFailed(null);
    setCode("");
  }

  if (state.kind === "second_factor") {
    return (
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => void onSecondFactorSubmit(event)}
      >
        {secondFactorFailed ? <FieldSummary>{secondFactorFailed}</FieldSummary> : null}

        <p className="text-sm text-muted">
          This account has a second factor. Enter the code from your authenticator
          app — a recovery code works here too.
        </p>

        <Field
          hint="Six digits from the app, or a recovery code in the XXXX-XXXX-XXXX-XXXX form."
          id="second-factor-code"
          label="Code"
        >
          <Input
            autoComplete="one-time-code"
            autoFocus
            name="code"
            onChange={(event) => setCode(event.target.value)}
            type="text"
            value={code}
          />
        </Field>

        <Button
          aria-busy={secondFactorPending}
          busy={secondFactorPending}
          disabled={secondFactorPending}
          type="submit"
        >
          Sign in
        </Button>

        {/*
          The way out. A person who cannot complete the second factor — no phone,
          no recovery codes, a factor they did not expect — is otherwise stuck on
          a page with no exit, because the password form is gone and the only
          forward path is one they cannot take. This is a button rather than a
          link because it changes state on this page rather than navigating: the
          challenge is abandoned, not followed.
        */}
        <div>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={abandonSecondFactor}
          >
            Back
          </Button>
        </div>
      </form>
    );
  }

  return (
    // `onSubmit` is called through `void` because React's prop is typed
    // `(event) => void` and React does not await what it is handed —
    // `@typescript-eslint/no-misused-promises` is right that a rejection would
    // arrive nowhere. It does not matter here: `onSubmit` catches every failure
    // itself and renders it into `state`, so nothing is left over. `void` and
    // not `.catch(() => {})`, because the second would swallow a failure
    // silently and there is no place on this screen to render a navigation error
    // into. Behaviour is unchanged — the handler is still CALLED synchronously
    // here, so `preventDefault()` runs before React's default.
    //
    // Every form in this app writes the same expression for the same reason;
    // this is the one place the reasoning is spelled out.
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
      {/* Polite and positive, not an alert. Nothing has failed here: a reset
          succeeded elsewhere and this page is reporting it on arrival. An
          assertive region would interrupt somebody who has just been redirected
          for no reason — and `tone="positive"` is already `role="status"`,
          because `Callout` reserves `alert` for a critical tone. */}
      {passwordChanged ? <Callout tone="positive">{PASSWORD_CHANGED}</Callout> : null}

      {state.kind === "local" || state.kind === "failed" ? (
        <FieldSummary>
          <ul className="list-inside list-disc">
            {state.kind === "failed" ? <li>{state.summary}</li> : null}
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

      <Field error={errorFor("password")} id="password" label="Password">
        <Input
          autoComplete="current-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </Field>

      <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
        Sign in
      </Button>

      {/*
        The affordance, placed under the button rather than beside the password
        field. It is what somebody reaches for when the sign-in above it has
        failed twice, and the bottom of a form is where a hand already is.

        It says "your password" rather than "your email" because that is the
        failure it addresses, and it never becomes enabled conditionally: a screen
        that only offered it after a 401 would be leaking whether an address is
        registered.
      */}
      <p className="text-sm">
        <Link className="underline hover:no-underline" to="/forgot-password">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

/** Picks the sentence and the field list out of a failure. */
function failureState(thrown: unknown): FormState {
  if (thrown instanceof IdentityError) {
    // Anything the service said about the credentials, said once, as one
    // sentence, with no field attached.
    if (thrown.status === 401 || thrown.status === 403) {
      return { kind: "failed", summary: INVALID_CREDENTIALS, fields: [] };
    }
    // A 422 from a sign-in would be a per-field failure, which we already
    // know how to place. The service should not send one, so if it does the
    // fields speak and the summary stays out of it.
    if (thrown.fieldErrors.length > 0) {
      return { kind: "failed", summary: "", fields: thrown.fieldErrors };
    }
  }

  // Deliberately not `thrown.message`: a 503 carries the service's internals,
  // and telling someone their password is wrong when the service is down sends
  // them off to reset one that was fine.
  return { kind: "failed", summary: UNEXPECTED, fields: [] };
}

/**
 * The sentence for a refused second factor.
 *
 * Three statuses get a sentence of their own, and each is the one thing a
 * person needs to know from it. Everything else — a 400, a 404, a 500 — falls
 * through to the generic sentence, which is the same rule the password path
 * follows: the status is read, the service's `detail` is never rendered.
 */
function secondFactorFailureSentence(thrown: unknown): string {
  if (thrown instanceof IdentityError) {
    // One sentence for every cause, because the service's 401 is one sentence
    // for every cause and this screen must not undo that by guessing.
    if (thrown.status === 401) return CODE_REFUSED;
    if (thrown.status === 423) {
      // The lockout window is the one fact worth having from a 423, and it
      // arrives as a header rather than in the body. Without it the sentence
      // would be a bare "try again", which sends a person to retry forever
      // against a lock that ignores them.
      return thrown.retryAfter === null
        ? "Too many attempts. Try again later."
        : retrySentence(thrown.retryAfter);
    }
    // A deployment problem, not a wrong code — see `MFA_UNAVAILABLE`.
    if (thrown.status === 503) return MFA_UNAVAILABLE;
  }
  return UNEXPECTED;
}

/**
 * The lockout wait, in the unit a person would say it in.
 *
 * Minutes when the wait is long enough to say so — "try again in 900 seconds"
 * is a sentence nobody reads as fifteen minutes — and seconds below that. The
 * service locks the factor for fifteen minutes after five failures, so the
 * common case is the minute one.
 */
function retrySentence(retryAfter: number): string {
  if (retryAfter >= 60) {
    const minutes = Math.round(retryAfter / 60);
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return `Too many attempts. Try again in ${retryAfter} seconds.`;
}
