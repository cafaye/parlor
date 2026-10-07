"use client";

/**
 * The second-factor section of `/settings`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SECTION IS, AND THE ONE RULE EVERY STATE IN IT OBEYS
 * ---------------------------------------------------------------------------
 * identity's MFA surface hands out three one-time values: the enrollment
 * secret, the provisioning URI (which contains the secret) and the recovery
 * codes. Each is returned in exactly one response and NEVER AGAIN — no
 * endpoint re-reads them and no column stores them, only a SHA-256 digest per
 * code. So each is rendered in exactly one state, held in component state for
 * that state's lifetime, and gone from the document the moment the state
 * changes. A secret that survives its step is a secret this app is storing,
 * which is the defect the service's "returned here and never again" language
 * exists to prevent — and `page.test.tsx` proves it by asserting the secret
 * is absent from the document after the confirm.
 *
 * ---------------------------------------------------------------------------
 * ENABLING MFA SIGNS THE SESSION OUT, AND THE COPY SAYS SO
 * ---------------------------------------------------------------------------
 * `POST /v1/mfa/enrollments/{id}/confirm` revokes EVERY session the account
 * holds, including the caller's own: a session minted under a one-factor
 * policy was minted on a password alone, and leaving it alive means whoever
 * holds it does not have to solve the new problem. The response carries no
 * token and mints none, so the person is signed out the moment their factor
 * goes live. The confirmed state says this out loud and offers the way
 * forward rather than leaving them to discover a dead session on the next
 * request. "Sign in again" calls `logout()`, whose server half is a
 * best-effort DELETE that will 401 against the already-revoked session — the
 * local half in its `finally` is the half that matters here.
 *
 * ---------------------------------------------------------------------------
 * ONE SENTENCE FOR EVERY WAY A CODE CAN BE REFUSED
 * ---------------------------------------------------------------------------
 * The document is explicit: on the confirm route, wrong, already spent,
 * malformed, and produced by a replaced secret are all the same 401, and the
 * recovery-codes route's 401 covers "refused" and "no second factor" alike.
 * So there is one sentence for every one of them, and it names no cause — a
 * client that could tell them apart would only learn which to keep trying.
 */

import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  Callout,
  DescriptionList,
  ErrorState,
  Field,
  FieldSummary,
  Input,
  LoadingState,
  Panel,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  IdentityError,
  type ConfirmedEnrollment,
  type MFAStatus,
  type RecoveryCodes,
  type StartedEnrollment,
} from "@/lib/identity";
import { mfaKey, useMfaStatus } from "@/lib/mfa";
import { useNavigation } from "@/lib/navigation";

const STATUS_FAILED = "We could not load your second-factor status.";

/** One sentence for every way a code can be refused. See the header. */
const CODE_REFUSED = "That code was not accepted. Check the app and try again.";

const UNEXPECTED = "Something went wrong. Try again.";

/**
 * A reader's wall-clock time, formatted.
 *
 * `undefined` for anything that is not an instant, because `toLocaleString` on
 * an invalid date returns the string "Invalid Date" — which would put the word
 * "Invalid" in front of somebody as though it were their factor's fault. The
 * same helper `settings-screen.tsx` carries for the verification badge; it is
 * duplicated rather than exported because the two panels never render at the
 * same time and a shared module for five lines is a worse trade than a second
 * copy.
 */
const INSTANT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatInstant(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : INSTANT.format(at);
}

/**
 * The section's local state, as the step the person is on.
 *
 * A discriminated union rather than a bag of flags, because the states are
 * mutually exclusive in a way that is load-bearing: the enroll state holds the
 * one-time secret, and the moment it becomes the confirmed state the secret is
 * gone from the document. A flag that could keep both true at once is a flag
 * under which the secret survives its step.
 */
type MfaState =
  | { kind: "view" }
  /** The pending enrollment and its one-time secret. */
  | { kind: "enroll"; enrollment: StartedEnrollment }
  /** MFA is live, the recovery codes are here once, and the session is dead. */
  | { kind: "confirmed"; confirmed: ConfirmedEnrollment }
  /** Asking for the current code before a rotation or a regeneration. */
  | { kind: "code-first"; next: "replace" | "regenerate" }
  /** A fresh set of recovery codes, shown once. */
  | { kind: "regenerated"; codes: RecoveryCodes };

export function MfaSection() {
  const status = useMfaStatus();

  if (status.isPending) return <LoadingState label="Loading your second factor…" />;

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

  return (
    <Panel headingId="mfa" title="Second factor">
      <MfaBody status={status.data} />
    </Panel>
  );
}

function MfaBody({ status }: { status: MFAStatus }) {
  const { token } = useAuth();
  const [state, setState] = useState<MfaState>({ kind: "view" });

  // The section renders only when somebody is signed in — SettingsScreen
  // returns <SignedOut /> before this panel otherwise — but `token` is
  // `string | null` and every client method here takes a non-null string. The
  // guard is here, once, so no state has to repeat it.
  if (token === null) return null;

  if (state.kind === "enroll") {
    return <EnrollFlow enrollment={state.enrollment} token={token} onDone={setState} />;
  }
  if (state.kind === "confirmed") {
    return <ConfirmedView confirmed={state.confirmed} />;
  }
  if (state.kind === "code-first") {
    return <CodeFirstFlow next={state.next} token={token} onDone={setState} />;
  }
  if (state.kind === "regenerated") {
    return <RegeneratedView codes={state.codes} token={token} onDone={setState} />;
  }
  return status.enabled ? (
    <EnabledView status={status} onDone={setState} />
  ) : (
    <DisabledView token={token} onDone={setState} />
  );
}

/**
 * The disabled state: what a second factor is, and the one control that adds it.
 *
 * No replace and no recovery codes here, because there is nothing to replace
 * and no codes to show — the service answers `{"enabled": false}` and the
 * honest screen is the short one.
 */
function DisabledView({
  token,
  onDone,
}: {
  token: string;
  onDone: (state: MfaState) => void;
}) {
  const { client } = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(null);
    try {
      onDone({ kind: "enroll", enrollment: await client.startMfaEnrollment(token) });
    } catch (thrown) {
      // A failure here leaves the person where they were, with the button
      // usable again — the enrollment was not created, so there is nothing to
      // clean up and nothing to show. The sentence is the service's failure
      // sentence, and it does not borrow the code-refused one: nothing was
      // refused, the request never got that far.
      setFailed(failureSentence(thrown));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DescriptionList
        items={[
          {
            term: "Second factor",
            // The service's own word for the fact, the same way the email panel
            // renders "Verified"/"Not verified" rather than renaming the state.
            value: "Not enabled",
          },
        ]}
      />
      <p className="text-sm text-muted">
        A second factor adds a code from your phone when you sign in, so a
        password alone is not enough.
      </p>
      {failed ? <Callout tone="critical">{failed}</Callout> : null}
      <div>
        <Button
          aria-busy={pending}
          busy={pending}
          disabled={pending}
          onClick={() => void start()}
          variant="secondary"
        >
          Set up a second factor
        </Button>
      </div>
    </div>
  );
}

/**
 * The enabled state: the facts, and the two controls that change them.
 *
 * "Replace" is a rotation — it asks for the current code first, because the
 * service requires one to authorise replacing a live factor, and the old
 * secret stays live until the new one is confirmed. "New recovery codes"
 * requires a code for the same reason the service requires one: handing out
 * ten fresh codes is handing out ten fresh ways into the account.
 */
function EnabledView({
  status,
  onDone,
}: {
  status: MFAStatus;
  onDone: (state: MfaState) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <DescriptionList
        items={[
          { term: "Second factor", value: "Enabled" },
          {
            term: "Enrolled on",
            value: formatInstant(status.enrolled_at) ?? "Not recorded",
          },
          // The count is absent when disabled and present when enabled, so this
          // row is only reachable with a number — but the type cannot know
          // that, and "Unknown" is the truth if the service ever omits it.
          {
            term: "Recovery codes left",
            value:
              typeof status.recovery_codes_remaining === "number"
                ? String(status.recovery_codes_remaining)
                : "Unknown",
          },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onDone({ kind: "code-first", next: "replace" })} variant="secondary">
          Replace
        </Button>
        <Button
          onClick={() => onDone({ kind: "code-first", next: "regenerate" })}
          variant="secondary"
        >
          New recovery codes
        </Button>
      </div>
    </div>
  );
}

/**
 * The enroll step: the secret and the provisioning URI, rendered once, and the
 * code that makes the factor live.
 *
 * The secret is rendered HERE AND NOWHERE ELSE. It is held in this state for
 * exactly as long as the step is on screen; the confirm replaces the state
 * rather than annotating it, so the secret leaves the document at the same
 * moment the recovery codes arrive. There is no path back to this step that
 * re-renders it — "Replace" starts a NEW enrollment, which mints a NEW
 * secret, which is the service's own rule.
 *
 * A pending enrollment is not MFA: it expires in ten minutes and the login
 * path reads only confirmed rows. The copy says so, because a person who
 * closes the tab here should know their factor is not on.
 */
function EnrollFlow({
  enrollment,
  token,
  onDone,
}: {
  enrollment: StartedEnrollment;
  token: string;
  onDone: (state: MfaState) => void;
}) {
  const { client } = useAuth();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(null);
    try {
      onDone({
        kind: "confirmed",
        confirmed: await client.confirmMfaEnrollment(token, enrollment.enrollment_id, { code }),
      });
    } catch (thrown) {
      // A refused code does NOT take the person back to the status view: the
      // enrollment is still pending and the secret on screen is still the one
      // the code was computed from, so the honest answer is to let them try
      // again. Only a 404 — an enrollment that expired or was already confirmed
      // underneath them — sends them back to start over.
      setFailed(failureSentence(thrown));
      setCode("");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        The once-only warning is attached to the secret rather than printed as
        a panel-level note, because the secret is the thing that cannot be
        recovered and the person is looking at it, not at the panel.
      */}
      <Callout tone="note">
        This secret is shown once. Copy it now — it cannot be viewed again. Until
        you confirm a code, your second factor is not on.
      </Callout>

      <SecretValue label="Secret" value={enrollment.secret} />
      <SecretValue label="Provisioning URI" value={enrollment.provisioning_uri} />

      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void onConfirm(event)}>
        {failed ? <FieldSummary>{failed}</FieldSummary> : null}
        <Field
          hint="The six-digit code from your authenticator app."
          id="mfa-code"
          label="Code"
        >
          <Input
            autoFocus
            name="mfa-code"
            onChange={(event) => setCode(event.target.value)}
            type="text"
            value={code}
          />
        </Field>
        <div>
          <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
            Confirm
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * A one-time value with its copy button.
 *
 * The value is rendered as text — selectable, copyable, and readable by a
 * screen reader — rather than only as a QR code, which is a follow-up. The
 * provisioning URI is long and contains the secret, so it breaks anywhere.
 */
function SecretValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all font-mono text-sm text-foreground">{value}</code>
        <CopyButton label={`Copy ${label}`} value={value} />
      </div>
    </div>
  );
}

/**
 * The confirmed state: MFA is live, the codes are here once, and the session
 * the person is sitting in is dead.
 *
 * The order is the content. The codes come first because they are the one
 * thing on this screen that cannot be recovered; the sign-out notice comes
 * with them because it is true at the same moment and the person is reading
 * both. "Sign in again" is the way forward, and it is a real control rather
 * than a sentence because the local half of the dead session has to be
 * cleared here — see the header.
 */
function ConfirmedView({ confirmed }: { confirmed: ConfirmedEnrollment }) {
  const { logout } = useAuth();
  const router = useNavigation();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function onSignInAgain() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      // Swallowed, and the reason is the header's: the session was revoked by
      // the confirm, so this DELETE is a best effort that will 401. The local
      // half in `logout`'s `finally` is the half that matters — a person whose
      // factor just went live is not held hostage to a session that is already
      // dead.
      await logout().catch(() => undefined);
      void router.push("/login");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DescriptionList
        items={[
          { term: "Second factor", value: "Enabled" },
          { term: "Enrolled on", value: formatInstant(confirmed.enrolled_at) ?? "Not recorded" },
        ]}
      />

      <RecoveryCodes codes={confirmed.recovery_codes} />

      <Callout tone="caution">
        Every session was signed out, including this one. Sign in again, and
        you&rsquo;ll be asked for a code.
      </Callout>

      <div>
        <Button
          aria-busy={pending}
          busy={pending}
          disabled={pending}
          onClick={() => void onSignInAgain()}
          variant="secondary"
        >
          Sign in again
        </Button>
      </div>
    </div>
  );
}

/**
 * A set of recovery codes, shown once, with the copy that says so.
 *
 * The codes are the one thing on this screen the service will never show
 * again, so the copy says so out loud and the copy button takes all ten at
 * once — a person who has got this far is past reading them one by one.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        Each code works once. These are shown once — copy them now.
      </p>
      <ul className="flex flex-col gap-1">
        {codes.map((code) => (
          <li key={code}>
            <code className="font-mono text-sm text-foreground">{code}</code>
          </li>
        ))}
      </ul>
      <div>
        <CopyButton label="Copy all" value={codes.join("\n")} />
      </div>
    </div>
  );
}

/**
 * The code that authorises a rotation or a regeneration.
 *
 * One field, and the service decides whether it is reading a six-digit TOTP
 * code or a recovery code — the same one-field rule `FactorRequest` follows,
 * so a caller cannot put the wrong shape in the wrong place and be told it
 * was malformed rather than not accepted.
 */
function CodeFirstFlow({
  next,
  token,
  onDone,
}: {
  next: "replace" | "regenerate";
  token: string;
  onDone: (state: MfaState) => void;
}) {
  const { client } = useAuth();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(null);
    try {
      if (next === "replace") {
        onDone({
          kind: "enroll",
          enrollment: await client.startMfaEnrollment(token, { code }),
        });
      } else {
        onDone({
          kind: "regenerated",
          codes: await client.regenerateMfaRecoveryCodes(token, { code }),
        });
      }
    } catch (thrown) {
      // A refused code leaves the form up: the person can check the app and
      // try again, and nothing was changed by the refusal.
      setFailed(failureSentence(thrown));
      setCode("");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {next === "replace"
          ? "Enter a current code to prove it's you before replacing the second factor. The old one keeps working until the new one is confirmed."
          : "Enter a current code to get a new set of recovery codes. The old set is destroyed the moment the new one is issued."}
      </p>
      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void onContinue(event)}>
        {failed ? <FieldSummary>{failed}</FieldSummary> : null}
        <Field
          hint="A six-digit code from your app, or a recovery code."
          id="mfa-code"
          label="Code"
        >
          <Input
            autoFocus
            name="mfa-code"
            onChange={(event) => setCode(event.target.value)}
            type="text"
            value={code}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button aria-busy={pending} busy={pending} disabled={pending} type="submit">
            Continue
          </Button>
          <Button
            disabled={pending}
            onClick={() => onDone({ kind: "view" })}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * A fresh set of recovery codes, shown once.
 *
 * The old set is gone — the service destroyed it in the same transaction that
 * wrote this one — and the status badge's count is stale until the cache is
 * re-read, which "Done" does.
 */
function RegeneratedView({
  codes,
  token,
  onDone,
}: {
  codes: RecoveryCodes;
  token: string;
  onDone: (state: MfaState) => void;
}) {
  const queryClient = useQueryClient();

  return (
    <div className="flex flex-col gap-4">
      <RecoveryCodes codes={codes.recovery_codes} />
      <div>
        <Button
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: mfaKey(token) });
            onDone({ kind: "view" });
          }}
          variant="secondary"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * A copy button.
 *
 * The async clipboard API behind an optional chain, because a non-secure
 * context has no `navigator.clipboard` and a copy button that throws on click
 * is worse than one that does nothing — the text is still there to select.
 * The label changes to "Copied" on success, which is a confirmation rather
 * than a busy rename: the control is not working, it is reporting that it
 * worked.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
  }

  return (
    <Button onClick={() => void copy()} size="sm" type="button" variant="secondary">
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * Picks the sentence out of a failure.
 *
 * Never `thrown.message`: a proxy's 502 carries a host and a port, and this is
 * the last hop before a person reads it. The one status with its own sentence
 * is the 401, which is the code-refused case the document collapses into a
 * single answer.
 */
function failureSentence(thrown: unknown): string {
  if (thrown instanceof IdentityError && thrown.status === 401) return CODE_REFUSED;
  return UNEXPECTED;
}
