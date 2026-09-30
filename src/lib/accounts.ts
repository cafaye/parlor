"use client";

/**
 * React Query bindings for the tenancy surface.
 *
 * The query keys and the invalidation rules live here rather than in the
 * components, for two reasons that are both about not getting it subtly wrong:
 *
 *   - The token is part of every key, for the same reason it is the key of the
 *     session query. An account list cached under a constant key would be
 *     served to whoever signed in next.
 *   - Creating an account, renaming one, inviting somebody and removing a
 *     member all invalidate overlapping sets. Spelling that out in each of the
 *     three screens is how a rename leaves a stale header behind, because
 *     somebody invalidated the detail query and forgot the list.
 *
 * No screen calls `identity` directly. They call these hooks, so there is one
 * place where a tenancy fetch happens and one place where it is cached.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import type {
  Account,
  AccountDetail,
  AccountListItem,
  Invitation,
  MemberList,
  Membership,
} from "@/lib/identity";
import type { Role } from "@/lib/roles";

/** Every account belongs to the token that can see it. */
export function accountsKey(token: string | null) {
  return ["accounts", token] as const;
}

export function accountKey(token: string | null, accountId: string) {
  return ["account", token, accountId] as const;
}

export function membersKey(token: string | null, accountId: string) {
  return ["account-members", token, accountId] as const;
}

/**
 * The accounts the signed-in person belongs to.
 *
 * Disabled without a token rather than fired at one: the service would answer
 * 401, and a signed-out visitor should not be shown an error for asking a
 * question they were never signed in to ask.
 *
 * `retry: false`, on every query in this file. The screens each render an
 * explicit `ErrorState` with a "Try again" button, and that button is a better
 * retry than an automatic one: a person staring at a spinner who is told
 * "we could not load this" can do something about it, and one who is left
 * watching for three seconds of exponential backoff cannot. It also means a
 * refusal — 401, 403, 404, 409, 410, 422 — is never re-asked, since every one
 * of those is the service's answer rather than a hiccup.
 */
export function useAccounts(): UseQueryResult<AccountListItem[]> {
  const { client, token } = useAuth();

  return useQuery({
    queryKey: accountsKey(token),
    queryFn: () => client.listAccounts(token as string),
    enabled: token !== null,
    retry: false,
  });
}

/** One account and its members. */
export function useAccount(accountId: string): UseQueryResult<AccountDetail> {
  const { client, token } = useAuth();

  return useQuery({
    queryKey: accountKey(token, accountId),
    queryFn: () => client.getAccount(token as string, accountId),
    enabled: token !== null && accountId !== "",
    retry: false,
  });
}

/**
 * The member panel.
 *
 * A separate query from the account detail because the service has a separate
 * route for it, and because a member list changes on a different schedule from
 * an account's name: invalidating the header every time somebody accepts an
 * invitation is a waste, and invalidating the panel on a rename is a lie about
 * what changed.
 */
export function useMembers(accountId: string): UseQueryResult<MemberList> {
  const { client, token } = useAuth();

  return useQuery({
    queryKey: membersKey(token, accountId),
    queryFn: () => client.listMembers(token as string, accountId),
    enabled: token !== null && accountId !== "",
    retry: false,
  });
}

/**
 * Creates an account and makes the caller its owner.
 *
 * The owner's role and the slug are the service's to derive; the request body
 * carries a name and nothing else. On success the list is refetched, because
 * the new account belongs in it and the only way to know its id is the
 * response.
 */
export function useCreateAccount() {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string }) => client.createAccount(token as string, input),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: accountsKey(token) });
      // Seed the detail cache so opening the new account does not re-fetch what
      // was just created. `role` is the caller's, which is exactly what the
      // create response said it was.
      queryClient.setQueryData(
        accountKey(token, created.id),
        created as AccountDetail,
      );
    },
  });
}

/**
 * Renames an account.
 *
 * A rename does not move the handle: the slug is derived once at creation and
 * never again, so the response's `slug` is the old one and the UI has to keep
 * showing it. Both queries are invalidated because the name appears in the list
 * row and in the detail header.
 */
export function useRenameAccount(accountId: string) {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string }) => client.renameAccount(token as string, accountId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKey(token, accountId) });
      void queryClient.invalidateQueries({ queryKey: accountsKey(token) });
    },
  });
}

/** Deletes an account and everything scoped by it. */
export function useDeleteAccount() {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => client.deleteAccount(token as string, accountId),
    onSuccess: (_result, accountId) => {
      // Drop the deleted account's own entries before invalidating the list, so
      // a back-button to it lands on a refetch that 404s rather than on a
      // cached page describing something that no longer exists.
      queryClient.removeQueries({ queryKey: accountKey(token, accountId) });
      queryClient.removeQueries({ queryKey: membersKey(token, accountId) });
      void queryClient.invalidateQueries({ queryKey: accountsKey(token) });
    },
  });
}

/**
 * Invites somebody.
 *
 * The returned invitation carries the token, and the token is the only copy that
 * will ever exist. Nothing invalidates a member list on success, because an
 * invitation is not a membership — the person has to accept first, and the
 * panel should not grow a row for somebody who has not said yes.
 */
export function useInviteMember(accountId: string) {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; role: Role }) =>
      client.inviteMember(token as string, accountId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKey(token, accountId) });
    },
  });
}

/** Redeems an invitation, and moves the caller into the account it names. */
export function useAcceptInvitation() {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { token: string }) => client.acceptInvitation(token as string, input),
    onSuccess: () => {
      // The caller's own account list is now wrong: they are in one more
      // account. The account they just joined has no cached detail, so the
      // list is the only thing that can be stale.
      void queryClient.invalidateQueries({ queryKey: accountsKey(token) });
    },
  });
}

/**
 * Changes a member's role.
 *
 * Both the detail and the panel are invalidated: the member count and the
 * caller's own role can both move, and `role` on the account response is the
 * caller's role, so a self-demotion changes what the whole page is allowed to
 * render.
 */
export function useChangeMemberRole(accountId: string) {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { userId: string; role: Role }) =>
      client.changeMemberRole(token as string, accountId, input.userId, { role: input.role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKey(token, accountId) });
      void queryClient.invalidateQueries({ queryKey: membersKey(token, accountId) });
    },
  });
}

/** Removes a membership. */
export function useRemoveMember(accountId: string) {
  const { client, token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => client.removeMember(token as string, accountId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKey(token, accountId) });
      void queryClient.invalidateQueries({ queryKey: membersKey(token, accountId) });
    },
  });
}

export type { Account, AccountDetail, AccountListItem, Invitation, MemberList, Membership };
