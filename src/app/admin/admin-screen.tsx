"use client";

/**
 * The system-admin console: staff gate, user search, and disable/enable.
 *
 * Four states, all asserted in `page.test.tsx`: signed out, checking access,
 * denied, and the console. Plus the failures each state lives with — the gate
 * could not be read, the search was refused, the action was refused.
 *
 * Three rules shape this screen, and all three are the packet's own:
 *
 *   - HIDING IS NOT AUTHORIZATION. The gate is a fresh `operator/me` read, and
 *     every disable/enable re-reads it before acting: a session that lost
 *     staff between loading the console and pressing the button is refused
 *     here, before the mutation. Identity enforces all of it again (401 for
 *     anonymous, 403 for non-staff); this screen is the honest rendering of
 *     those answers, not the enforcement.
 *   - The service's `detail` is never rendered. Every sentence here is written
 *     in this file instead.
 *   - No staff grants, no impersonation, no delete, no billing: the API
 *     supports none of them, so the screen offers none of them.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { AdminSignedOut } from "./page";
import {
  Button,
  Callout,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { IdentityError } from "@/lib/identity";
import { useOperator } from "@/lib/operator-context";
import type { OperatorUser } from "@/lib/operator";

const GATE_FAILED = "We could not check your operator access.";
const SEARCH_FAILED = "We could not search users.";
const DISABLE_FAILED = "We could not disable that user. Try again.";
const ENABLE_FAILED = "We could not re-enable that user. Try again.";
const ACCESS_CHANGED =
  "Your operator access changed while you were working. Sign in again and try once more.";

export function AdminScreen() {
  const { session, token } = useAuth();

  if (session.status === "loading") return <LoadingState label="Checking your session…" />;
  if (session.status === "anonymous" || token === null) return <AdminSignedOut />;

  return <OperatorGate token={token} />;
}

/**
 * The staff gate: one fresh `operator/me` read, and the whole console behind it.
 *
 * A 401 here means the token died (another tab, a revoked session) and reads
 * as signed out. A 403 means signed in but not staff and reads as denied —
 * the two are different answers and the screen keeps them apart.
 */
function OperatorGate({ token }: { token: string }) {
  const operator = useOperator();
  const gate = useQuery({
    queryKey: ["operator", "me", token],
    queryFn: () => operator.me(token),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  if (gate.isPending) return <LoadingState label="Checking operator access…" />;

  if (gate.isError) {
    const status = gate.error instanceof IdentityError ? gate.error.status : null;
    if (status === 401) return <AdminSignedOut />;
    if (status === 403) return <Denied />;
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => {
          void gate.refetch();
        }}
        title={GATE_FAILED}
      />
    );
  }

  if (!gate.data.user.staff) return <Denied />;

  return <OperatorConsole token={token} />;
}

/**
 * The refusal. Deliberately flat: it names the state ("not available to you")
 * and never the reason, the role, or who is staff — a 403 that enumerated
 * staff would be an oracle about the team.
 */
export function Denied() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h2 className="text-base font-medium">Not available</h2>
      <p className="mt-1 text-sm text-muted">
        This area is for system administrators. If you need access, ask someone
        on the platform team.
      </p>
    </div>
  );
}

function OperatorConsole({ token }: { token: string }) {
  const operator = useOperator();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"disable" | "enable" | null>(null);
  const [notice, setNotice] = useState<{ tone: "positive" | "critical"; text: string } | null>(null);
  // A guard against a double submit, as a `useRef` rather than `pending`: the
  // disabled button is a frame too late, and a closure read of `pending` is
  // stale in exactly the window where the second click lands.
  const acting = useRef(false);
  // Which action failed, for the error sentence. Set beside `acting` at
  // confirm time: `onError` receives the error rather than the variables in a
  // shape this file wants to branch on, so the kind travels alongside.
  const attempted = useRef<"disable" | "enable">("disable");

  const search = useQuery({
    queryKey: ["operator", "users", token, submitted],
    queryFn: () => operator.searchUsers(token, submitted ?? ""),
    enabled: submitted !== null,
    retry: false,
  });

  const action = useMutation({
    mutationFn: async (kind: "disable" | "enable") => {
      // Every action independently re-verifies staff before acting: the gate
      // above was read when the console loaded, and this is the read that
      // covers everything since. A session that lost staff in between never
      // reaches the mutation.
      const fresh = await operator.me(token);
      if (!fresh.user.staff) {
        throw new IdentityError(ACCESS_CHANGED, { status: 403, code: "forbidden" });
      }
      const id = selectedId;
      if (id === null) throw new Error("no user is selected");
      if (kind === "disable") await operator.disableUser(token, id);
      else await operator.enableUser(token, id);
      return kind;
    },
    onSuccess: (kind, _variables, _context) => {
      acting.current = false;
      setConfirm(null);
      setNotice({
        tone: "positive",
        text: kind === "disable" ? "That user is now disabled." : "That user is now enabled.",
      });
      void queryClient.invalidateQueries({ queryKey: ["operator", "users", token] });
    },
    onError: (error) => {
      acting.current = false;
      setConfirm(null);
      if (error instanceof IdentityError && error.status === 403 && error.message === ACCESS_CHANGED) {
        setNotice({ tone: "critical", text: ACCESS_CHANGED });
      } else if (error instanceof IdentityError && error.status === 404) {
        setNotice({ tone: "critical", text: "That user no longer exists. Search again." });
      } else if (attempted.current === "disable") {
        setNotice({ tone: "critical", text: DISABLE_FAILED });
      } else {
        setNotice({ tone: "critical", text: ENABLE_FAILED });
      }
    },
  });

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() === "") {
      setDraftError("Enter an email address or name to search for.");
      return;
    }
    setDraftError(null);
    setNotice(null);
    setSelectedId(null);
    setSubmitted(draft.trim());
  };

  const selected = search.data?.find((user) => user.id === selectedId) ?? null;
  const searchFailed = search.isError;
  const searchStatus = search.error instanceof IdentityError ? search.error.status : null;
  // `fetchStatus`, not `isPending`: a query with `enabled: false` (no search
  // submitted yet) is still in the pending STATUS, so `isPending` would keep
  // the Search button disabled until the first search — the one action that
  // can enable it.
  const searching = search.fetchStatus === "fetching";

  return (
    <div className="flex flex-col gap-6">
      <Panel headingId="admin-search" title="Find a user">
        <form noValidate onSubmit={submitSearch}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Field
                error={draftError ?? undefined}
                hint="Search by email address or name."
                id="admin-search-query"
                label="Search users"
              >
                <Input
                  autoComplete="off"
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="kaka@example.com"
                  value={draft}
                />
              </Field>
            </div>
            <Button busy={searching} disabled={searching} type="submit">
              Search
            </Button>
          </div>
        </form>

        <div className="mt-4">
          {submitted === null ? (
            <EmptyState title="No search yet">
              Search results appear here. Nothing has been asked of the service.
            </EmptyState>
          ) : searching ? (
            <LoadingState label="Searching users…" rows={2} />
          ) : searchFailed ? (
            searchStatus === 403 ? (
              <Denied />
            ) : (
              <ErrorState
                detail="The service did not answer. This is usually temporary."
                onRetry={() => {
                  void search.refetch();
                }}
                title={SEARCH_FAILED}
              />
            )
          ) : search.data !== undefined && search.data.length === 0 ? (
            <EmptyState title="No users found">
              Nothing matches that search. Check the spelling and try again.
            </EmptyState>
          ) : search.data !== undefined ? (
            <ul aria-label="Matching users" className="flex flex-col gap-2">
              {search.data.map((user) => (
                <li key={user.id}>
                  <button
                    aria-pressed={user.id === selectedId}
                    className="focus-ring flex w-full flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 text-left hover:border-border-strong"
                    onClick={() => {
                      setSelectedId(user.id);
                      setNotice(null);
                    }}
                    type="button"
                  >
                    <span className="truncate text-sm font-medium">{user.email}</span>
                    <span className="text-xs text-muted">
                      {user.disabled_at ? "Disabled" : "Active"}
                      {" · "}
                      {user.email_verified_at ? "Verified" : "Unverified"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>

      {selected ? (
        <UserDetail
          busy={action.isPending}
          notice={notice}
          onDisable={() => {
            setNotice(null);
            setConfirm("disable");
          }}
          onEnable={() => {
            setNotice(null);
            setConfirm("enable");
          }}
          user={selected}
        />
      ) : null}

      <ConfirmDialog
        busy={action.isPending}
        cancelLabel="Cancel"
        confirmLabel={confirm === "disable" ? "Disable this user" : "Re-enable this user"}
        description={
          confirm === "disable"
            ? `${selected?.email ?? "This user"} will be signed out everywhere and unable to sign in. This can be undone.`
            : `${selected?.email ?? "This user"} will be able to sign in again.`
        }
        onCancel={() => {
          if (!action.isPending) setConfirm(null);
        }}
        onConfirm={() => {
          // The ref guard, not `action.isPending`: see `acting` above.
          if (acting.current || confirm === null) return;
          acting.current = true;
          attempted.current = confirm;
          action.mutate(confirm);
        }}
        open={confirm !== null}
        title={confirm === "disable" ? "Disable this user?" : "Re-enable this user?"}
      />
    </div>
  );
}

function UserDetail({
  user,
  notice,
  busy,
  onDisable,
  onEnable,
}: {
  user: OperatorUser;
  notice: { tone: "positive" | "critical"; text: string } | null;
  busy: boolean;
  onDisable: () => void;
  onEnable: () => void;
}) {
  const disabled = user.disabled_at !== null;

  return (
    <Panel
      action={
        disabled ? (
          <Button aria-busy={busy} busy={busy} disabled={busy} onClick={onEnable} variant="secondary">
            Re-enable
          </Button>
        ) : (
          <Button aria-busy={busy} busy={busy} disabled={busy} onClick={onDisable} variant="destructive">
            Disable
          </Button>
        )
      }
      headingId="admin-user-detail"
      title={user.email}
    >
      <div className="flex flex-col gap-4">
        {notice ? (
          <Callout title={notice.tone === "positive" ? "Done" : undefined} tone={notice.tone}>
            {notice.text}
          </Callout>
        ) : null}
        <DescriptionList
          items={[
            { term: "Status", value: disabled ? "Disabled" : "Active" },
            { term: "Email", value: user.email_verified_at ? "Verified" : "Unverified" },
            {
              term: "Name",
              value: user.display_name ?? "Not set",
            },
            { term: "Created", value: user.created_at },
          ]}
        />
        {disabled ? (
          <p className="text-sm text-muted">
            This user is currently disabled. Re-enabling lets them sign in again.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Disabling signs this user out everywhere. It can be undone.
          </p>
        )}
      </div>
    </Panel>
  );
}
