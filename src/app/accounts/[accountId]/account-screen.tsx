"use client";

/**
 * One account: its facts, its members, and the things a person may do to it.
 *
 * What is on this screen is decided by `can(role, capability)` from
 * `src/lib/roles.ts`, which is a transcription of the service's own route
 * table. That is a reason not to *offer* a button, never a reason to believe
 * one would have worked: the service answers 403 to anything the transcription
 * gets wrong, and this screen defers to that.
 *
 * The two service behaviours that shape the design:
 *
 *   - **404, not 403, for "not a member".** The service deliberately answers
 *     the same status and the same sentence for "no such account" and "an
 *     account you are not a member of", so a guessed id cannot be used to find
 *     out which accounts exist. This screen therefore has one "cannot see it"
 *     state that says neither, and never says "you are not a member".
 *   - **A member list with no `user_id` on any row.** `membershipResponses` in
 *     identity's handler builds each row as `{Role: m.Role}` and nothing else,
 *     and `MemberSummary` in its store does not carry a user id to copy, so the
 *     per-member routes cannot be addressed. The panel says so and shows the
 *     role distribution, which is the information that does arrive. The
 *     per-member controls render the moment an id is present, so the UI that
 *     should appear when identity is fixed is already specified.
 *
 * The service's `detail` is never rendered. Every sentence here is written in
 * this file, because that string is where a host, a port or an internal class
 * name would come from.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import {
  Button,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  FieldSummary,
  Input,
  LoadingState,
  Panel,
  RoleBadge,
  Select,
} from "@/components/ui";
import {
  useAccount,
  useChangeMemberRole,
  useDeleteAccount,
  useInviteMember,
  useMembers,
  useRemoveMember,
  useRenameAccount,
} from "@/lib/accounts";
import { useAuth } from "@/lib/auth";
import {
  IdentityError,
  fieldErrorMessage,
  type AccountDetail,
  type MemberList,
  type Membership,
} from "@/lib/identity";
import { can, invitableRoles, roleLabel, validateAccountName, type Role } from "@/lib/roles";

const NOT_VISIBLE = "We could not find that account.";

const LOAD_FAILED = "We could not load this account.";

export function AccountScreen({ accountId }: { accountId: string }) {
  const { session } = useAuth();
  const account = useAccount(accountId);

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous") return <SignInFirst />;

  if (account.isPending) return <LoadingState label="Loading account…" />;

  if (account.isError) {
    // The service answers 404 for both "no such account" and "not one of yours",
    // with the same sentence, on purpose. So there is one message here and it
    // does not distinguish them: saying "you are not a member" would confirm
    // the id is real, which is the whole thing the service is preventing.
    if (account.error instanceof IdentityError && account.error.status === 404) {
      return <NotVisible />;
    }
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => {
          void account.refetch();
        }}
        title={LOAD_FAILED}
      />
    );
  }

  return <Loaded account={account.data} accountId={accountId} />;
}

function Loaded({ account, accountId }: { account: AccountDetail; accountId: string }) {
  const role = account.role;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
          <RoleBadge role={role} />
          {account.personal ? <span className="text-sm text-muted">Personal account</span> : null}
        </div>
      </header>

      <AccountFacts account={account} />

      {can(role, "renameAccount") ? <RenameForm account={account} /> : null}

      {can(role, "inviteMember") ? <InviteForm role={role} accountId={accountId} /> : null}

      <MembersPanel role={role} accountId={accountId} />

      <DangerZone role={role} accountId={accountId} />
    </div>
  );
}

/**
 * What the account is, apart from its name and the caller's role.
 *
 * The name and the role live in the header and are not repeated here. Printing
 * the same string twice on one page is not "belt and braces", it is two places
 * to update and two places for a person to look — and it makes
 * `getByText("Acme Corp")` ambiguous in a test, which is the same problem in a
 * smaller costume.
 */
function AccountFacts({ account }: { account: AccountDetail }) {
  return (
    <Panel headingId="account-facts" title="Account">
      <DescriptionList
        items={[
          {
            term: "Handle",
            value: (
              <>
                <span className="font-mono">{account.slug}</span>{" "}
                <span className="text-muted">
                  — derived from the original name, and it never changes on a rename.
                </span>
              </>
            ),
          },
          { term: "Created", value: <time dateTime={account.created_at}>{account.created_at}</time> },
          { term: "Updated", value: <time dateTime={account.updated_at}>{account.updated_at}</time> },
        ]}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/**
 * Whether a member row carries an id the per-member routes can be addressed
 * with.
 *
 * Checked per row rather than assumed, because the service sends neither field
 * today and the schema declares both — so a partial rollout would produce a
 * list where some rows are manageable and some are not, and a screen that
 * assumed either way would be wrong in one of them.
 */
function isAddressable(member: Membership): boolean {
  return member.user_id !== "";
}

function MembersPanel({ role, accountId }: { role: Role; accountId: string }) {
  const members = useMembers(accountId);

  return (
    <Panel headingId="members" title="Members">
      {members.isPending ? <LoadingState label="Loading members…" /> : null}
      {members.isError ? (
        // Scoped to the panel on purpose: the account's own facts are still
        // true and still useful, and a member list that will not load should
        // cost the member list and nothing else.
        <ErrorState
          detail="The account details above are still correct."
          onRetry={() => {
            void members.refetch();
          }}
          title="We could not load the member list."
        />
      ) : null}
      {members.isSuccess ? (
        <MemberListBody accountId={accountId} members={members.data} role={role} />
      ) : null}
    </Panel>
  );
}

function MemberListBody({
  members,
  role,
  accountId,
}: {
  members: MemberList;
  role: Role;
  accountId: string;
}) {
  const rows = members.memberships;

  if (rows.length === 0) {
    return (
      <EmptyState title="No members">
        An account always has at least its owner, so this should not happen. It is what
        the service reported, and it is worth reporting rather than papering over.
      </EmptyState>
    );
  }

  // The role distribution, which is the information the service does send and
  // the only thing a member list is useful for while the rows carry no identity.
  const counts = rows.reduce<Record<Role, number>>(
    (total, member) => ({ ...total, [member.role]: total[member.role] + 1 }),
    { member: 0, admin: 0, owner: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Total</dt>
        <dd>{rows.length}</dd>
        {(["owner", "admin", "member"] as const)
          .filter((key) => counts[key] > 0)
          .map((key) => (
            <div className="col-span-2 grid grid-cols-subgrid" key={key}>
              <dt className="text-muted">{roleLabel(key)}s</dt>
              <dd>{counts[key]}</dd>
            </div>
          ))}
      </dl>

      {rows.some((member) => isAddressable(member)) ? (
        <ul aria-label="Members" className="flex flex-col gap-2">
          {rows.map((member, index) => (
            <MemberRow
              accountId={accountId}
              key={member.user_id || `unaddressable-${index}`}
              member={member}
              role={role}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
          The service is not returning member names or ids, so individual members
          cannot be shown or managed here. Roles and the member count are accurate.
        </p>
      )}
    </div>
  );
}

function MemberRow({
  member,
  role,
  accountId,
}: {
  member: Membership;
  role: Role;
  accountId: string;
}) {
  const changeRole = useChangeMemberRole(accountId);
  const remove = useRemoveMember(accountId);
  const [error, setError] = useState<string | null>(null);

  // An account must keep at least one owner, so the last one cannot be demoted
  // or removed. Offering the control would be offering a guaranteed 422, and the
  // count of owners is not on this row — the caller's own role is the only
  // owner fact available here, so the check is against that.
  const isSoleOwner = member.role === "owner" && role === "owner";

  async function onRoleChange(next: Role) {
    setError(null);
    try {
      await changeRole.mutateAsync({ userId: member.user_id, role: next });
    } catch (thrown) {
      setError(roleChangeFailure(thrown));
    }
  }

  async function onRemove() {
    setError(null);
    try {
      await remove.mutateAsync(member.user_id);
    } catch (thrown) {
      setError(removeFailure(thrown));
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-xs text-muted">{member.user_id}</span>
        <span className="flex items-center gap-2">
          <RoleChangeControl
            disabled={!can(role, "changeMemberRole") || isSoleOwner || changeRole.isPending}
            onChange={(next) => void onRoleChange(next)}
            pending={changeRole.isPending}
            value={member.role}
          />
          <Button
            disabled={!can(role, "removeMember") || isSoleOwner || remove.isPending}
            onClick={() => void onRemove()}
            variant="secondary"
          >
            Remove
          </Button>
        </span>
      </div>
      {error ? <FieldSummary>{error}</FieldSummary> : null}
    </li>
  );
}

function roleChangeFailure(thrown: unknown): string {
  if (thrown instanceof IdentityError) {
    if (thrown.fieldErrors.length > 0) {
      return fieldErrorMessage(thrown.fieldErrors[0].field, thrown.fieldErrors[0].code);
    }
    if (thrown.status === 403) return "Only an owner can change a member's role.";
  }
  return "We could not change that role. Try again.";
}

function removeFailure(thrown: unknown): string {
  if (thrown instanceof IdentityError) {
    if (thrown.fieldErrors.length > 0) {
      return fieldErrorMessage(thrown.fieldErrors[0].field, thrown.fieldErrors[0].code);
    }
    if (thrown.status === 403) return "Only an owner may act on an owner's membership.";
  }
  return "We could not remove that member. Try again.";
}

function RoleChangeControl({
  value,
  disabled,
  pending,
  onChange,
}: {
  value: Role;
  disabled: boolean;
  pending: boolean;
  onChange(role: Role): void;
}) {
  return (
    <Select
      aria-label="Role for this member"
      disabled={disabled || pending}
      onChange={(event) => onChange(event.target.value as Role)}
      value={value}
    >
      {(["member", "admin", "owner"] as const).map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

/**
 * Which sentence a rename failure gets, and where it goes.
 *
 * A per-field refusal goes on the field, because it is about the value that was
 * typed. Everything else goes in the banner, because it is about the request:
 * a 403 here means the caller's role, and saying so on the name field would
 * send somebody off to invent a new name for an account they simply may not
 * rename.
 */
type RenameState =
  | { kind: "idle" }
  | { kind: "invalid"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "failed" };

function RenameForm({ account }: { account: AccountDetail }) {
  const rename = useRenameAccount(account.id);
  const [name, setName] = useState(account.name);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<RenameState>({ kind: "idle" });
  const inFlight = useRef(false);

  if (!editing) {
    return (
      <div>
        <Button onClick={() => setEditing(true)} variant="secondary">
          Rename
        </Button>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const local = validateAccountName(name);
    if (local.length > 0) {
      setState({ kind: "invalid", message: fieldErrorMessage(local[0].field, local[0].code) });
      return;
    }

    inFlight.current = true;
    setState({ kind: "idle" });
    try {
      await rename.mutateAsync({ name: name.trim() });
      setEditing(false);
    } catch (thrown) {
      setState(renameState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Panel headingId="rename" title="Rename account">
      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        {state.kind === "refused" || state.kind === "failed" ? (
          <FieldSummary>
            {state.kind === "refused"
              ? state.message
              : "We could not rename this account. Try again."}
          </FieldSummary>
        ) : null}
        <Field
          error={state.kind === "invalid" ? state.message : undefined}
          id="rename-name"
          label="Account name"
        >
          <Input name="name" onChange={(event) => setName(event.target.value)} value={name} />
        </Field>
        <div className="flex gap-2">
          <Button aria-busy={rename.isPending} busy={rename.isPending} disabled={rename.isPending} type="submit">
            Save name
          </Button>
          <Button disabled={rename.isPending} onClick={() => setEditing(false)} variant="ghost">
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function renameState(thrown: unknown): RenameState {
  if (thrown instanceof IdentityError) {
    if (thrown.fieldErrors.length > 0) {
      const first = thrown.fieldErrors[0];
      return { kind: "invalid", message: fieldErrorMessage(first.field, first.code) };
    }
    if (thrown.status === 403) {
      return { kind: "refused", message: "Your role in this account does not allow renaming it." };
    }
  }
  return { kind: "failed" };
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

function InviteForm({ role, accountId }: { role: Role; accountId: string }) {
  const invite = useInviteMember(accountId);
  const roles = invitableRoles(role);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>(roles[0] ?? "member");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ token: string; email: string } | null>(null);
  const inFlight = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const trimmed = email.trim();
    if (trimmed === "") {
      setError("Enter an email address to invite.");
      return;
    }

    inFlight.current = true;
    setError(null);
    setSent(null);
    try {
      const created = await invite.mutateAsync({ email: trimmed, role: inviteRole });
      // The token is in this response and nowhere else, ever. Holding it in
      // state is the whole delivery mechanism until courier exists.
      setSent({ token: created.token, email: created.email });
      setEmail("");
    } catch (thrown) {
      setError(inviteFailure(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Panel headingId="invite" title="Invite somebody">
      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        {error ? <FieldSummary>{error}</FieldSummary> : null}

        {sent ? (
          <div className="rounded-md border border-caution/40 bg-caution/5 px-3 py-3 text-sm">
            <p className="font-medium">
              Invited {sent.email}. This link is shown once — there is no other copy.
            </p>
            <p className="mt-2">
              <Link
                className="font-mono break-all underline underline-offset-2 hover:no-underline"
                href={`/invitations/${sent.token}`}
              >
                {sent.token}
              </Link>
            </p>
          </div>
        ) : null}

        <Field id="invite-email" label="Email">
          <Input
            autoComplete="off"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </Field>

        <Field
          hint={
            role === "admin"
              ? "Only an owner can invite another admin."
              : undefined
          }
          id="invite-role"
          label="Role"
        >
          <Select
            name="role"
            onChange={(event) => setInviteRole(event.target.value as Role)}
            value={inviteRole}
          >
            {roles.map((option) => (
              <option key={option} value={option}>
                {roleLabel(option)}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <Button aria-busy={invite.isPending} busy={invite.isPending} disabled={invite.isPending} type="submit">
            Send invitation
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function inviteFailure(thrown: unknown): string {
  if (thrown instanceof IdentityError) {
    if (thrown.fieldErrors.length > 0) {
      return fieldErrorMessage(thrown.fieldErrors[0].field, thrown.fieldErrors[0].code);
    }
    // ErrInvitationEmailTaken: the one conflict this endpoint declares.
    if (thrown.status === 409) return "That address already has a pending invitation here.";
    if (thrown.status === 403) return "Your role in this account does not allow inviting.";
  }
  return "We could not send that invitation. Try again.";
}

// ---------------------------------------------------------------------------
// Leaving and deleting
// ---------------------------------------------------------------------------

function DangerZone({ role, accountId }: { role: Role; accountId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const remove = useRemoveMember(accountId);
  const removeAccount = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);
  // Two separate flags rather than one `confirming: "leave" | "delete" | null`.
  // A string would read tidier and would make it possible to open the wrong
  // dialog on a fast double-click, and the cost of being wrong here is somebody
  // deleting a workspace.
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // The service will not remove the last owner, so offering "leave" to an owner
  // is offering a guaranteed refusal. An owner who wants out deletes the
  // account, which is the other button here.
  const canLeave = role !== "owner" && session.status === "authed";
  const canDelete = can(role, "deleteAccount");

  if (!canLeave && !canDelete) return null;

  async function leave() {
    if (inFlight.current || session.status !== "authed") return;
    inFlight.current = true;
    setError(null);
    try {
      // The caller is the one member whose id this client already holds, from
      // `GET /v1/me`. It is the only per-member action that works while the
      // service sends no user ids in the list.
      await remove.mutateAsync(session.user.id);
      router.push("/accounts");
    } catch (thrown) {
      setError(leaveFailure(thrown));
      inFlight.current = false;
    }
  }

  async function destroy() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await removeAccount.mutateAsync(accountId);
      router.push("/accounts");
    } catch (thrown) {
      setError(deleteFailure(thrown));
      inFlight.current = false;
    }
  }

  return (
    <Panel headingId="danger" title="Leaving and deleting">
      <div className="flex flex-col gap-4">
        {error ? <FieldSummary>{error}</FieldSummary> : null}

        {canLeave ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Leaving removes your membership. You will need a new invitation to come back.
            </p>
            {/* "Leave" opens the dialog and "Leave this account" commits it, so
                the two are different names on purpose. Naming both "Leave this
                account" is what a person navigating by name hits when a dialog
                asks them to confirm — two controls, one name, no way to say
                which is which. */}
            <Button
              onClick={() => {
                setConfirmingLeave(true);
              }}
              variant="secondary"
            >
              Leave
            </Button>
          </div>
        ) : null}

        {canDelete ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted">
              Deleting removes the account and everything scoped by it. There is no undo.
            </p>
            <Button
              onClick={() => {
                setConfirming(true);
              }}
              variant="destructive"
            >
              Delete account
            </Button>
          </div>
        ) : null}
      </div>

      {/*
        A modal confirmation rather than a second pair of buttons inline. Two
        things forced the change. The inline version rendered the confirming
        button as `variant="primary"` — the same weight as "Save name" three
        panels up, so the most destructive control on the page was the least
        distinguishable one. And an inline confirm has nowhere to say what is
        about to happen, so "Delete this account" and "Cancel" sat next to each
        other with the consequence only in the paragraph above them.
      */}
      {/*
        Leaving is confirmed too, and it was the bigger omission. Deleting an
        account is dramatic; leaving one is quiet, and quiet irreversible things
        are the ones that get clicked by accident. The copy directly above the
        button already said "You will need a new invitation to come back" — so
        the screen was telling somebody the action was irreversible while
        offering it in one click.
      */}
      <ConfirmDialog
        busy={remove.isPending}
        confirmLabel="Leave this account"
        description="Your membership is removed. You will need a new invitation to come back."
        onCancel={() => {
          setConfirmingLeave(false);
        }}
        onConfirm={() => {
          void leave();
        }}
        open={confirmingLeave}
        title="Leave this account?"
      />

      <ConfirmDialog
        busy={removeAccount.isPending}
        confirmLabel="Delete this account"
        description="The account and everything scoped by it are removed. There is no undo."
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void destroy();
        }}
        open={confirming}
        title="Delete this account?"
      />
    </Panel>
  );
}

function leaveFailure(thrown: unknown): string {
  if (thrown instanceof IdentityError && thrown.status === 403) {
    return "You cannot leave this account.";
  }
  return "We could not leave this account. Try again.";
}

function deleteFailure(thrown: unknown): string {
  if (thrown instanceof IdentityError && thrown.status === 403) {
    return "Only an owner can delete this account.";
  }
  if (thrown instanceof IdentityError && thrown.status === 404) {
    return NOT_VISIBLE;
  }
  return "We could not delete this account. Try again.";
}

// ---------------------------------------------------------------------------

function SignInFirst() {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h1 className="text-base font-medium">Sign in to see this account</h1>
      <p className="mt-1 text-sm text-muted">
        Accounts are per person, so there is nothing to show until we know who you are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" href="/login">
          Sign in
        </Link>
      </p>
    </section>
  );
}

function NotVisible() {
  return (
    <section className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h1 className="text-base font-medium">Account not found</h1>
      {/* Deliberately does not say whether the account exists. The service
          answers this the same way for "no such account" and "not one of yours",
          and a message that distinguished them would undo that. */}
      <p className="mt-1 text-sm text-muted">{NOT_VISIBLE}</p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" href="/accounts">
          Back to your accounts
        </Link>
      </p>
    </section>
  );
}
