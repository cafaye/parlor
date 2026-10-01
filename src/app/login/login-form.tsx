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
 */

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Button, Field, FieldSummary, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { validateSignIn } from "@/lib/credentials";
import { IdentityError, fieldErrorMessage, type FieldError } from "@/lib/identity";

/** One sentence, every time, for every refused sign in. */
const INVALID_CREDENTIALS = "Invalid email or password.";

const UNEXPECTED = "Something went wrong. Try again.";

type FormState =
  | { kind: "idle" }
  | { kind: "local"; fields: FieldError[] }
  | { kind: "failed"; summary: string; fields: FieldError[] };

export function LoginForm() {
  const router = useRouter();
  const { login, pending } = useAuth();
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
      // The token is now in the store, which is what re-renders the header.
      await login({ email: email.trim(), password });
      // No `refresh()`: nothing this process renders depends on the token yet.
      // It earns its place when the BFF packet puts the session in a cookie
      // and server components have to see it.
      router.push("/");
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
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
