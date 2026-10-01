"use client";

/**
 * The register form.
 *
 * Two kinds of failure arrive here and they are deliberately not shown the
 * same way.
 *
 * Local validation (this file) puts the message on the field it belongs to,
 * because the person is looking at the field. A 422 from the service is
 * treated the same way — the problem body lists `{field, code}` pairs, and
 * `fieldErrorMessage` turns each into a sentence next to its input.
 *
 * A 401 is treated the opposite way, on the login screen: one generic
 * sentence, in the summary, not on a field, because a field-level "email is
 * wrong" is an account-existence oracle. Registration is the one surface where
 * "that address is taken" may be said out loud, and only because a 409 here is
 * an answer the person needs to progress.
 *
 * ---------------------------------------------------------------------------
 * THE ACCOUNT EXISTS BEFORE THE MAIL IS ASKED FOR, AND THAT IS THE WHOLE FILE
 * ---------------------------------------------------------------------------
 *
 * `POST /v1/users` sends nothing: identity's contract says so in as many words,
 * and a client that wants an address proved "calls this route afterwards" —
 * `POST /v1/email-verifications`. So this screen makes two calls, and the one
 * thing that must never happen is treating the second one's failure as the first
 * one's.
 *
 * The account is real from the moment `register` resolves. A verification request
 * that then fails — a 503 because the deployment cannot send, a network error, a
 * proxy's 502 — has not un-made it. Reporting "something went wrong" at that
 * point would be read as "no account", and the obvious next move for somebody who
 * believes that is to register again, into a 409 for an address they have just
 * proved they own. So every one of those states says **the account was created**
 * first, and says what is missing about the mail second.
 *
 * This is also the one screen that may name the address. `/verify-email` must not,
 * because a stranger can type any address into it; here the person typed this one
 * moments ago and the service has just created a row for it, so echoing it back
 * confirms nothing they do not already know — and "we sent a link to
 * kaka@example.com" is the sentence that makes the mail findable when two
 * accounts exist on one device.
 */

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Button, Callout, Field, FieldSummary, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { validateRegistration } from "@/lib/credentials";
import {
  IdentityError,
  MIN_PASSWORD_LENGTH,
  fieldErrorMessage,
  type Credentials,
  type FieldError,
} from "@/lib/identity";

/**
 * What the account was created and the link was asked for.
 *
 * **The address is in all three sentences, not just the happy one.** That is
 * deliberate and it is worth the repetition: "Account created for
 * kaka@example.com" is how a reader knows `POST /v1/users` reached a real service
 * and a real database, and the end-to-end tier asserts on it — so dropping the
 * address from the failure branches would have silently deleted that proof from
 * the one place a failure is actually exercised (a stack with no courier).
 *
 * It is also consistent with the rule at the top of this file: this screen may
 * name an address it just created, and it is the only screen that may.
 */
const CREATED_AND_SENT = (email: string) =>
  `Account created for ${email}. A verification link is on its way.`;

/** The account is real; the deployment cannot send. Both facts, in that order. */
const CREATED_NO_MAIL = (email: string) =>
  `Account created for ${email}. This deployment cannot send email right now, so no verification link was sent.`;

/** The account is real and something else went wrong asking for the link. */
const CREATED_NO_REQUEST = (email: string) =>
  `Account created for ${email}. We could not start sending a verification link, so none was sent.`;

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] }
  | { kind: "created"; email: string; mail: "sent" | "unavailable" | "failed" };

export function RegisterForm() {
  const { client, register, pending } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // `pending` disables the button, but a second click can land in the frame
  // between the click and the re-render that disables it — and a stale closure
  // would still say `false` there. A ref is set synchronously, so this is the
  // only guard that actually closes the window.
  const inFlight = useRef(false);

  const fields = state.kind === "local" || state.kind === "failed" ? state.fields : [];
  const errorFor = (field: string) => {
    const failure = fields.find((entry) => entry.field === field);
    return failure ? fieldErrorMessage(failure.field, failure.code) : undefined;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second submit would be a second account, or a 409 explaining the first.
    if (inFlight.current) return;

    const local = validateRegistration({ email, password });
    if (local.length > 0) {
      setState({ kind: "local", fields: local });
      return;
    }

    inFlight.current = true;
    const credentials: Credentials = { email: email.trim(), password };
    setState({ kind: "idle" });
    try {
      const created = await register(credentials);
      setPassword("");
      // The account exists. Everything below is about a second, separable fact,
      // and none of its failures may un-say the first one.
      const mail = await askForVerification(created.email);
      setState({ kind: "created", email: created.email, mail });
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  /**
   * Asks for the link and reports what happened, without ever throwing.
   *
   * A separate function for a reason that matters: if this threw, the `catch` in
   * `onSubmit` would catch it too and report a failed *registration* for an
   * account that exists. The bug this shape prevents is a real one — it is what a
   * naive `await client.requestEmailVerification(...)` inside the same `try` does.
   *
   * The address used is the one the service returned from `POST /v1/users`, not
   * what was typed: identity normalizes to lower case and trims, and the lookup
   * should be keyed on the address the row actually holds.
   */
  async function askForVerification(createdEmail: string): Promise<"sent" | "unavailable" | "failed"> {
    try {
      await client.requestEmailVerification(createdEmail);
      // The 202 body is a constant and is deliberately not read: there is nothing
      // in it about this address, and a screen that could branch on it is a screen
      // that could be made to.
      return "sent";
    } catch (thrown) {
      // A 503 means the mailer is unavailable, which is a fact about the
      // deployment and the one failure worth naming — it is also the one a person
      // can act on, by asking again later. Everything else is a network or a
      // proxy, and both get the plain sentence.
      //
      // The 409 is deliberately NOT handled here. A brand-new account has just been
      // created and cannot be verified already, so a 409 on this call is a
      // contract change rather than a state; reporting it as "sent" would be a lie
      // and reporting it as "already verified" would be a stranger's answer.
      if (thrown instanceof IdentityError && thrown.status === 503) return "unavailable";
      return "failed";
    }
  }

  if (state.kind === "created") {
    const sentence =
      state.mail === "sent"
        ? CREATED_AND_SENT(state.email)
        : state.mail === "unavailable"
          ? CREATED_NO_MAIL(state.email)
          : CREATED_NO_REQUEST(state.email);

    return (
      <div className="flex flex-col gap-4">
        {/*
          `Callout` with `tone="positive"` renders `role="status"` — a polite live
          region, which is right for news that arrived without anybody breaking
          anything. It replaces the hand-rolled `<p role="status">` this screen
          used so the two success announcements in the app are the same component.
          The tone stays positive even when the mail could not be sent, because the
          thing being announced IS good: the account exists. The sentence carries
          the rest, and "Account created." leads it in every branch.
        */}
        <Callout tone="positive">{sentence}</Callout>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {/*
            "Sign in to your new account" and not a bare "Sign in": the page's own
            heading already carries an "Already have one? Sign in" link, and this
            state renders underneath it. Two links with the same name and the same
            destination on one screen is an ambiguous name for a screen reader and
            a coin flip for everybody else — and the longer name is the truer one
            here anyway, because this account was created thirty seconds ago.
          */}
          <Link className="underline hover:no-underline" href="/login">
            Sign in to your new account
          </Link>
          {/* The resend action. A link to the screen that asks rather than a
              second post from here, because the one-minute cooldown is the
              service's to answer — a second post inside that window sends nothing
              while promising something. */}
          <span className="text-muted">
            <span>Did not arrive?</span>{" "}
            <Link className="underline hover:no-underline" href="/verify-email">
              Send it again
            </Link>
          </span>
        </p>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
      {state.kind === "local" || state.kind === "failed" ? (
        <FieldSummary>
          {/* Every sentence that names a problem, in one region, so the
              announcement is complete without walking the form. The fields
              repeat their own line on purpose: this is read once, that is
              found by looking. */}
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

      <Field
        error={errorFor("password")}
        hint={`${MIN_PASSWORD_LENGTH} characters minimum.`}
        id="password"
        label="Password"
      >
        <Input
          autoComplete="new-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </Field>

      <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
        Create account
      </Button>
    </form>
  );
}

/** Picks the summary sentence and the field list out of a failure. */
function failureState(thrown: unknown): FormState {
  if (!(thrown instanceof IdentityError)) {
    return { kind: "failed", summary: "Something went wrong. Try again.", fields: [] };
  }

  const fields = thrown.fieldErrors;
  if (fields.length > 0) {
    return { kind: "failed", summary: "Check the highlighted fields and try again.", fields };
  }

  // 409 rather than 422: the service says the address is taken. Safe to repeat
  // here, and the only way someone finds out before they try to sign in. It
  // annotates no field — the address is well formed, it is just spoken for.
  if (thrown.code === "conflict") {
    return { kind: "failed", summary: "That email address is already registered.", fields: [] };
  }

  // Never `thrown.message` in this branch: a proxy's "dial tcp 10.0.0.4:5432"
  // is not something to put in front of a person.
  return { kind: "failed", summary: "Something went wrong. Try again.", fields: [] };
}
