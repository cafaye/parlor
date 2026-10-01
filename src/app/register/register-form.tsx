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
 */

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Button, Field, FieldSummary, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { validateRegistration } from "@/lib/credentials";
import {
  IdentityError,
  MIN_PASSWORD_LENGTH,
  fieldErrorMessage,
  type Credentials,
  type FieldError,
} from "@/lib/identity";

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] }
  | { kind: "created"; email: string };

export function RegisterForm() {
  const { register, pending } = useAuth();
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
      setState({ kind: "created", email: created.email });
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  if (state.kind === "created") {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-positive/40 bg-positive/5 px-3 py-2 text-sm" role="status">
          Account created for {state.email}. Sign in to continue.
        </p>
        <Link className="text-sm underline hover:no-underline" href="/login">
          Sign in
        </Link>
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
