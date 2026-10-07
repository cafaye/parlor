"use client";

/**
 * `/settings` — the profile screen, version 2: the controls identity grew.
 *
 * ---------------------------------------------------------------------------
 * EVERY CONTROL HERE CALLS A ROUTE THE FORWARDER CARRIES
 * ---------------------------------------------------------------------------
 * Everything on this screen calls a route `src/lib/upstream.ts` already carries,
 * and nothing on it calls one it does not. That is the whole design rule, and
 * `page.tsx` says why at length; this file's job is to keep it true as the screen
 * grows. The sections with no route — API tokens — are absent rather than
 * disabled, so "every control here works" stays a statement a person can check.
 * The second-factor section is the one that joined: it lives in
 * `mfa-section.tsx` because it is a state machine with one-time secrets, not a
 * panel with a button.
 *
 * ---------------------------------------------------------------------------
 * THE DISPLAY NAME'S SET-OR-CLEAR, AND WHAT THE UI DOES ABOUT IT
 * ---------------------------------------------------------------------------
 * `PATCH /v1/me` has exactly one field and no "leave unchanged" to express: an
 * omitted `display_name` and an empty string are the same request upstream, so
 * every commit is either "this is my name now" or "nothing". The UI makes that
 * visible rather than hiding it in a no-op:
 *
 *   * The input always holds the CURRENT name, so an empty input means "no
 *     name" and never "I have not decided yet".
 *   * "Save name" is disabled while the input equals the stored name, so it
 *     can never be a no-op commit — and, while a name is set, an empty input
 *     is not a saveable state at all.
 *   * "Clear name" is the explicit affordance for the one change Save cannot
 *     express, rendered only while a name is set.
 *
 * The surprise this prevents: select-all, delete, save — expecting nothing to
 * happen, and the name is gone instead.
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

/** The name was written. The input already shows it; this confirms the write. */
const NAME_SAVED = "Your name was saved.";

/** The name was cleared. Same sentence shape, because it is the same act. */
const NAME_CLEARED = "Your name was cleared.";

const SESSIONS_FAILED = "We could not load your sessions.";

const SESSION_REVOKE_FAILED = "We could not end that session. Try again.";

const DELETE_FAILED = "We could not delete your account. Try again.";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SignedOut } from "./page";
import { MfaSection } from "./mfa-section";
import {
  Button,
  Callout,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  FormStack,
  Input,
  LoadingState,
  Panel,
} from "@/components/ui";
import { useAccounts } from "@/lib/accounts";
import { sessionQueryKey, useAuth } from "@/lib/auth";
import {
  fieldErrorMessage,
  IdentityError,
  MAX_DISPLAY_NAME_LENGTH,
  type SessionSummary,
  type User,
} from "@/lib/identity";
import { useNavigation } from "@/lib/navigation";
import { useDeleteMyAccount, useDropSession, useSessionsList } from "@/lib/sessions";
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
  const { session, token } = useAuth();

  // The same two branches `accounts-screen.tsx` has, for the same reason: the
  // header renders NEITHER signed-in nor signed-out controls while a stored token
  // is being exchanged, and a screen that showed "Sign in" in that frame would be
  // showing a signed-out affordance to somebody who is signed in.
  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  // The second clause is what makes the first half of the page's contract
  // visible to TypeScript: a session that is not anonymous is a session whose
  // token resolved, because the query is enabled only when one is stored and a
  // 401 clears it. Every panel below passes this token to a client method, and
  // this is the one line that says it is there to pass.
  if (session.status === "anonymous" || token === null) return <SignedOut />;

  // The order is the reading order: who you are, your address, everywhere you
  // are signed in, this session, and then the one irreversible thing — last,
  // because a person who has not read the panels above is not ready to delete
  // anything.
  return (
    <div className="flex flex-col gap-8">
      <DisplayNamePanel token={token} user={session.user} />
      <EmailPanel email={session.user.email} />
      <MfaSection />
      <SessionsPanel token={token} />
      <SessionPanel email={session.user.email} />
      <DeleteAccountPanel token={token} />
    </div>
  );
}

/**
 * The display name: shown, edited, and cleared.
 *
 * The set-or-clear contract is in this file's header; what is here is the shape
 * of it. One input holding the current name, a Save that is disabled while
 * nothing would change, and a Clear that exists only while there is something
 * to clear.
 *
 * The commit writes the session query's data from the response rather than
 * invalidating it: the 200 carries the user with the name just written, so a
 * refetch would be a second answer to a question the first one already settled
 * — and a stale `me` stubbed without the field would un-write the name the
 * response had just confirmed.
 */
function DisplayNamePanel({ user, token }: { user: User; token: string }) {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.display_name ?? "");
  const [state, setState] = useState<NameState>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  // `pending` is what the buttons render from; this is what actually blocks the
  // second submit — the same split `ResendVerification` makes, and for the same
  // reason: a closure read of `pending` is stale in exactly the frame the
  // second click lands in.
  const inFlight = useRef(false);

  const current = user.display_name ?? "";

  async function commit(next: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setState({ kind: "idle" });
    try {
      const updated = await client.updateMyDisplayName(token, { display_name: next });
      setName(updated.display_name ?? "");
      setState({ kind: next === "" ? "cleared" : "saved" });
      queryClient.setQueryData(sessionQueryKey(token), updated);
    } catch (thrown) {
      // A 422 naming the field is rendered inline, where the person can see why;
      // anything else is the one plain sentence, never the service's detail.
      const fieldError = nameFieldError(thrown);
      setState(fieldError ? { kind: "field", message: fieldError } : { kind: "failed" });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Panel headingId="display-name" title="Display name">
      <div className="flex flex-col gap-4">
        <FormStack>
          <Field
            error={state.kind === "field" ? state.message : undefined}
            hint="How you appear to other people. Clear name removes it."
            id="display-name-input"
            label="Name"
          >
            <Input
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-busy={pending}
              busy={pending}
              // Disabled while nothing would change, so a commit is never a
              // no-op — the route has no "leave unchanged" to express, and a
              // Save that could be pressed without effect would be offering
              // one.
              disabled={pending || name === "" || name === current}
              onClick={() => void commit(name)}
              variant="primary"
            >
              Save name
            </Button>
            {/*
              The explicit clear affordance, rendered only while there is
              something to clear. With a name set, an empty input is NOT a
              saveable state — Save is disabled above — so clearing has exactly
              one way in, and it is named.
            */}
            {current ? (
              <Button
                aria-busy={pending}
                busy={pending}
                disabled={pending}
                onClick={() => void commit("")}
                variant="secondary"
              >
                Clear name
              </Button>
            ) : null}
          </div>
        </FormStack>

        {state.kind === "saved" ? <Callout tone="positive">{NAME_SAVED}</Callout> : null}
        {state.kind === "cleared" ? <Callout tone="positive">{NAME_CLEARED}</Callout> : null}
        {state.kind === "failed" ? <Callout tone="critical">{UNEXPECTED}</Callout> : null}
      </div>
    </Panel>
  );
}

type NameState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "cleared" }
  /** A 422 naming the field. Rendered inline, where the person can see why. */
  | { kind: "field"; message: string }
  | { kind: "failed" };

/**
 * The 422's own sentence for the one field this form has.
 *
 * `fieldErrorMessage` is the one place a field code becomes a sentence, so the
 * contract vocabulary stays in `identity.ts` and never appears inline here.
 */
function nameFieldError(thrown: unknown): string | null {
  if (!(thrown instanceof IdentityError)) return null;
  const failure = thrown.fieldErrors.find((entry) => entry.field === "display_name");
  return failure ? fieldErrorMessage(failure.field, failure.code) : null;
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
 * Everywhere the caller is signed in, with a per-row revoke.
 *
 * The list is the service's answer rendered raw: the user agent unparsed (a
 * device label this app invents is a label that can be wrong), the address as
 * recorded at sign-in, and the two instants formatted for a reader. `current`
 * is the one field a client cannot compute for itself, and it is what makes
 * "This device" a statement rather than a guess.
 *
 * Nothing here is a credential: the service sends no token and no digest of one,
 * so a row is a thing a person recognises and nothing a person could sign in
 * with.
 */
function SessionsPanel({ token }: { token: string }) {
  const sessions = useSessionsList();

  if (sessions.isPending) {
    return (
      <Panel headingId="sessions" title="Sessions">
        <LoadingState label="Loading your sessions…" rows={2} />
      </Panel>
    );
  }

  if (sessions.isError) {
    return (
      <Panel headingId="sessions" title="Sessions">
        <ErrorState
          detail="The service did not answer. This is usually temporary."
          onRetry={() => void sessions.refetch()}
          title={SESSIONS_FAILED}
        />
      </Panel>
    );
  }

  const { sessions: list } = sessions.data;

  return (
    <Panel headingId="sessions" title="Sessions">
      {/*
        The empty answer is `[]` and never `null`, and it is a fine answer
        rather than a failure — the current session is ordinarily in the list,
        but a session list with nothing in it is not a state this app has to
        invent a reason for.
      */}
      {list.length === 0 ? (
        <EmptyState title="No active sessions">
          You are not signed in anywhere right now.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((session) => (
            <SessionRow key={session.id} session={session} token={token} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SessionRow({ session, token }: { session: SessionSummary; token: string }) {
  const { client, forgetSession } = useAuth();
  const router = useNavigation();
  const dropSession = useDropSession();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The same ref-not-state split the rest of this file makes: the disabled
  // button is a frame too late, and a closure read of `pending` is stale in
  // exactly the frame the second click lands in.
  const inFlight = useRef(false);

  async function revoke() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      await client.revokeSession(token, session.id);
      if (session.current) {
        // The session this browser holds is dead. The 204 set no `Set-Cookie`
        // — the service cannot clear a cookie it was never told the session
        // of — so the browser keeps the credential and the next request with
        // it is a 401. The login flow's answer to a dead session is to forget
        // the token; this is the same case reached by a different route, and
        // the local half is the only half left to clear.
        forgetSession();
        void router.push("/login");
      } else {
        // The 204 already said the session is gone, so the row leaves with the
        // click that revoked it rather than after a refetch that would put the
        // old list back for a moment.
        dropSession(session.id);
      }
    } catch {
      // The row stays: a refusal means the session is still alive, and a
      // control that disappeared on a failure would be claiming an end it did
      // not achieve.
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Raw and unparsed, and escaped by React on the way out: the service
              records whatever the client sent, and showing it verbatim is the
              honest rendering of a fact this app did not curate. */}
          <span className="font-medium">{session.user_agent || "Unknown device"}</span>
          {session.current ? (
            <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs text-muted">
              This device
            </span>
          ) : null}
        </div>
        <p className="text-muted">
          {session.ip ? `From ${session.ip} · ` : ""}
          Started {formatInstant(session.created_at) ?? "Not recorded"} · Expires{" "}
          {formatInstant(session.expires_at) ?? "Not recorded"}
        </p>
        {failed ? (
          <p role="alert" className="text-sm text-critical">
            {SESSION_REVOKE_FAILED}
          </p>
        ) : null}
      </div>
      <div>
        <Button
          aria-busy={pending}
          busy={pending}
          disabled={pending}
          onClick={() => void revoke()}
          size="sm"
          variant="secondary"
        >
          Revoke
        </Button>
      </div>
    </li>
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

/**
 * The one irreversible thing on this screen, and it is last.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRM IS TYPE-TO-CONFIRM, AND THAT IS THE REFERENCE PRODUCT'S SHAPE
 * ---------------------------------------------------------------------------
 * `DELETE /v1/me` cannot be undone and cannot be reversed by any route this app
 * has. A two-step confirm is the floor; the reference product makes the person
 * type the account name, and this screen matches that. The expected value is the
 * PERSONAL account's name — the one `DELETE /v1/me` removes — read from the
 * accounts list, so a person who renamed it types what it is called now.
 *
 * ---------------------------------------------------------------------------
 * WHAT SUCCESS DOES, AND WHY IT IS THE SCREEN'S TO DO
 * ---------------------------------------------------------------------------
 * The 204 has no body and no `Content-Type`. Every credential is ended in the
 * same transaction, so the token in `localStorage` is dead the moment it lands
 * and the next request with it is a 401. The service cannot clear the cookie —
 * it was never told which session the request arrived on — so the local half is
 * the only half left to clear. `forgetSession` does that, and the person is
 * routed to `/register`: a deleted account has nowhere else to go.
 *
 * ---------------------------------------------------------------------------
 * THE 409 IS THE ONE ANSWER THAT IS NOT CONSTANT
 * ---------------------------------------------------------------------------
 * A caller who is the SOLE owner of a team account is refused, and the problem
 * document's `detail` names each account by name and slug precisely so the
 * caller can act. That detail is the service's own user-facing sentence — not
 * an internal code, host or port — so it is rendered verbatim. A team account
 * the caller merely belongs to never blocks them.
 * ---------------------------------------------------------------------------
 */
function DeleteAccountPanel({ token }: { token: string }) {
  const { forgetSession } = useAuth();
  const router = useNavigation();
  const accounts = useAccounts();
  const destroy = useDeleteMyAccount();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // The personal account is the one this route removes. Its name is what the
  // person types to confirm, read from the list so a rename is respected.
  const personalName = accounts.data?.find((account) => account.personal)?.name ?? "";

  async function destroyAccount() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await destroy.mutateAsync();
      // `void`, not `await`, for the reason `account-screen.tsx`'s `destroy`
      // gives: the account is already gone by this line, so a navigation that
      // failed must not be reported as a refusal to delete.
      forgetSession();
      void router.push("/register");
    } catch (thrown) {
      if (thrown instanceof IdentityError && thrown.status === 409) {
        // The service's own detail names the accounts to transfer or delete
        // first. It is a user-facing sentence, not an internal detail.
        setError(thrown.message);
      } else {
        setError(DELETE_FAILED);
      }
      inFlight.current = false;
    }
  }

  // The button is disabled while the accounts list is unresolved: the confirm
  // needs the personal account's name, and a name guessed is a name that could
  // be wrong on the one control where being wrong is irreversible.
  const ready = accounts.data !== undefined && personalName !== "";

  return (
    <Panel headingId="delete-account" title="Delete account">
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted">
            Deleting removes your account, your personal account, and your membership of every
            team account. Every session is ended. There is no undo.
          </p>
          <Button
            disabled={!ready || destroy.isPending}
            onClick={() => {
              setConfirming(true);
            }}
            variant="destructive"
          >
            Delete account
          </Button>
        </div>

        <ConfirmDialog
          busy={destroy.isPending}
          confirmLabel="Delete my account"
          description="This removes your account, your personal account, and your membership of every team account. Every session is ended. There is no undo."
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            void destroyAccount();
          }}
          open={confirming}
          requireTyping={ready ? personalName : undefined}
          title="Delete your account?"
        />
      </div>
    </Panel>
  );
}