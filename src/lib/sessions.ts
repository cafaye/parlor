"use client";

/**
 * React Query bindings for the sessions surface the forwarder allows.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE EXISTS FOR, AND WHY IT IS ONE FILE AND NOT A SCREEN
 * ---------------------------------------------------------------------------
 * `GET /v1/sessions` is read by the settings screen's session list and
 * invalidated by a revoke, and that pairing is the whole reason this is a hook
 * rather than a `useQuery` inside `settings-screen.tsx`. The rule
 * `verification.ts` set — one place where a fetch happens, one place where it
 * is cached, and the invalidation spelled out where it cannot be forgotten —
 * is the same rule, and a revoked row left on screen after its button said it
 * was gone is the same bug as a renamed account leaving a stale header behind.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN IS PART OF THE KEY, FOR THE SAME REASON IT IS ON `me`
 * ---------------------------------------------------------------------------
 * The list is the CALLER's sessions, so two different tokens are two different
 * answers to the same question. A constant key would serve the previous
 * person's session list to whoever signed in next — and a session list is a
 * list of places a person is signed in, which is not a cosmetic detail.
 *
 * ---------------------------------------------------------------------------
 * WHAT A REVOKE DOES TO THE LIST, AND WHY THE SCREEN OWNS IT
 * ---------------------------------------------------------------------------
 * A revoke is NOT an invalidation here. The screen removes the row itself,
 * because the answer is already known — the 204 said the session is gone — and
 * a refetch would put a round trip between a finished action and its visible
 * result. The one case that refetches is a failure, where the row stays and
 * the list is exactly as it was.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import type { SessionList } from "@/lib/identity";

/** The caller's session list belongs to the token that can read it. */
export function sessionsKey(token: string | null) {
  return ["sessions", token] as const;
}

/**
 * The caller's live sessions, newest first.
 *
 * Disabled without a token rather than fired at one: the service would answer
 * 401, and a signed-out visitor should never see an error for a question they
 * were not signed in to ask. `retry: false`, because the screen renders an
 * explicit `ErrorState` with a "Try again" button and that button is a better
 * answer than three identical silent attempts.
 */
export function useSessionsList() {
  const { client, token } = useAuth();

  return useQuery({
    queryKey: sessionsKey(token),
    queryFn: async ({ queryKey }) => {
      const current = queryKey[1] as string;
      return client.listSessions(current);
    },
    enabled: token !== null,
    // A session list goes stale the moment anything anywhere revokes a
    // session — a password reset revokes them all — so it is re-read on every
    // visit rather than trusted from a cache. The screen is one fetch deep and
    // the answer is never a credential, only a list of places a person is
    // signed in.
    staleTime: 0,
    retry: false,
    // Nothing outlives its token: the entry for a signed-out session goes with
    // the key, the same as the session query's.
    gcTime: 0,
  });
}

/**
 * Drops one session from the cached list, the visible half of a 204.
 *
 * `setQueryData` rather than `invalidateQueries`, and the difference is the
 * whole point: the 204 already said the session is gone, so the row disappears
 * on the click that revoked it rather than after a refetch that would put the
 * old list back for a moment. A previous list that is not there yet — the
 * fetch has not resolved — is left alone rather than invented.
 */
export function useDropSession() {
  const queryClient = useQueryClient();
  const { token } = useAuth();

  return (sessionId: string) =>
    queryClient.setQueryData<SessionList>(sessionsKey(token), (previous) =>
      previous
        ? { sessions: previous.sessions.filter((session) => session.id !== sessionId) }
        : previous,
    );
}

/**
 * Ends the caller's own account — `DELETE /v1/me`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HERE AND NOT IN `accounts.ts`
 * ---------------------------------------------------------------------------
 * It is a `/v1/me` route, session-scoped, and it ends every session the caller
 * holds in the same transaction — so it belongs with the session surface this
 * file binds rather than the tenancy surface `accounts.ts` binds. The tenancy
 * `deleteAccount` removes an account the caller OWNS; this removes the caller,
 * and the difference is the whole of why the two are not one method.
 *
 * ---------------------------------------------------------------------------
 * WHAT SUCCESS MEANS, AND WHY THE SCREEN OWNS THE AFTERMATH
 * ---------------------------------------------------------------------------
 * The 204 has no body and no `Content-Type`. Every credential is dead the moment
 * it lands, so there is nothing to invalidate and nothing to refetch — the token
 * in `localStorage` is a credential that no longer resolves, and the next
 * request with it is a 401. The screen clears the local half itself through
 * `forgetSession` and routes to `/register`, because a deleted account has
 * nowhere else to go.
 *
 * The 409 is the one non-constant answer: a caller who is the SOLE owner of a
 * team account is refused, and the problem document's `detail` names each
 * account by name and slug. That detail is the service's own user-facing
 * sentence — not an internal code, host or port — so the screen renders it.
 * ---------------------------------------------------------------------------
 */
export function useDeleteMyAccount() {
  const { client, token } = useAuth();

  return useMutation({
    mutationFn: () => client.deleteMyAccount(token as string),
  });
}
