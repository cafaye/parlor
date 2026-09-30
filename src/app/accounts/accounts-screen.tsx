"use client";

/**
 * The account list and the create form.
 *
 * Four states, all designed and all asserted in `page.test.tsx`: signed out,
 * loading, loaded-and-empty, loaded. Plus the two failures a screen like this
 * lives with — the list could not be loaded, and the create was refused.
 *
 * Two rules shape the failure copy:
 *
 *   - The service's `detail` is never rendered. It is where a host, a port or
 *     an internal class name lives, and this is the last hop before a person
 *     reads it. Every sentence here is written in this file instead.
 *   - A per-field failure goes on the field and a per-request failure goes in
 *     the banner. Putting a 500 on the name field would tell somebody their
 *     account name is wrong when the service is what is wrong.
 */

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { SignedOut } from "./page";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FieldSummary,
  Input,
  LoadingState,
  Panel,
  RoleBadge,
} from "@/components/ui";
import { useAccounts, useCreateAccount } from "@/lib/accounts";
import { useAuth } from "@/lib/auth";
import { IdentityError, fieldErrorMessage, type AccountListItem, type FieldError } from "@/lib/identity";
import { MAX_NAME_LENGTH, validateAccountName } from "@/lib/roles";

/** The one conflict `POST /v1/accounts` declares, in this app's own words. */
const NAME_TAKEN = "An account with that name already exists.";

const TRY_AGAIN = "We could not create the account. Try again.";

const LIST_FAILED = "We could not load your accounts.";

export function AccountsScreen() {
  const { session } = useAuth();
  const accounts = useAccounts();

  // The session is still being exchanged, so there is no token to ask with.
  // Saying "Sign in" here is the same mistake the header avoids: showing a
  // signed-out affordance to somebody who is signed in.
  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous") return <SignedOut />;

  return (
    <div className="flex flex-col gap-8">
      <AccountList accounts={accounts} />
      <CreateAccountForm />
    </div>
  );
}

function AccountList({ accounts }: { accounts: UseQueryResult<AccountListItem[]> }) {
  if (accounts.isPending) return <LoadingState label="Loading accounts…" />;

  if (accounts.isError) {
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => {
          void accounts.refetch();
        }}
        title={LIST_FAILED}
      />
    );
  }

  const rows = accounts.data;

  if (rows.length === 0) {
    return (
      <EmptyState title="No accounts yet">
        You are not a member of any account. Create one below, or ask somebody who
        already has access to invite you.
      </EmptyState>
    );
  }

  return (
    <ul aria-label="Your accounts" className="flex flex-col gap-2">
      {rows.map((account) => (
        <li key={account.id}>
          <Link
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 hover:border-cafaye-300"
            href={`/accounts/${account.id}`}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{account.name}</span>
              <span className="truncate font-mono text-xs text-muted">{account.slug}</span>
            </span>
            <span className="flex items-center gap-2">
              {account.personal ? (
                <span className="text-xs text-muted">Personal account</span>
              ) : null}
              <RoleBadge role={account.role} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

type FormState =
  /** Nothing to say. */
  | { kind: "idle" }
  /** The service, or the local mirror, named a field. */
  | { kind: "invalid"; fields: FieldError[] }
  /** The one conflict this endpoint declares: the derived handle is taken. */
  | { kind: "name-taken" }
  /** Anything else. About the request, not about the name. */
  | { kind: "failed" };

function CreateAccountForm() {
  const create = useCreateAccount();
  const [name, setName] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // `pending` disables the button, but a second click can land in the frame
  // before the re-render that disables it, and a closure read of `isPending` is
  // stale in exactly that window. A ref is set synchronously, so it is the only
  // guard that closes it. Two accounts from one click is a support ticket.
  const inFlight = useRef(false);

  const nameError =
    state.kind === "invalid"
      ? messageFor(state.fields, "name")
      : state.kind === "name-taken"
        ? NAME_TAKEN
        : undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // The same rules as the service, so a person is told before a round trip.
    // The service is the authority; this is a mirror of it, in `roles.ts`.
    const local = validateAccountName(name);
    if (local.length > 0) {
      setState({ kind: "invalid", fields: local });
      return;
    }

    inFlight.current = true;
    setState({ kind: "idle" });
    const trimmed = name.trim();
    try {
      await create.mutateAsync({ name: trimmed });
      // Cleared only on success. A failure that emptied the field would make
      // somebody retype a name the service has already accepted as well-formed.
      setName("");
      setState({ kind: "idle" });
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Panel headingId="new-account" title="New account">
      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        {state.kind === "failed" ? <FieldSummary>{TRY_AGAIN}</FieldSummary> : null}

        <Field
          error={nameError}
          hint={`Up to ${MAX_NAME_LENGTH} characters. The handle is derived from it and never changes.`}
          id="new-account-name"
          label="Account name"
        >
          <Input name="name" onChange={(event) => setName(event.target.value)} value={name} />
        </Field>

        <div>
          <Button aria-busy={create.isPending} disabled={create.isPending} type="submit">
            Create account
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** The first failure the service reported for one field, as a sentence. */
function messageFor(fields: FieldError[], field: string): string | undefined {
  const failure = fields.find((entry) => entry.field === field);
  return failure ? fieldErrorMessage(failure.field, failure.code) : undefined;
}

/**
 * Places a failure: on the field when the service named one, in the banner when
 * it did not.
 */
function failureState(thrown: unknown): FormState {
  if (thrown instanceof IdentityError) {
    // ErrSlugTaken is the only conflict this endpoint declares, and the handle
    // it collides on is derived from the name — so a 409 here is always about
    // the name, even though the service sends no `errors[]` to say so.
    if (thrown.status === 409) return { kind: "name-taken" };
    if (thrown.fieldErrors.length > 0) return { kind: "invalid", fields: thrown.fieldErrors };
  }
  return { kind: "failed" };
}
