"use client";

/**
 * React Query bindings for the one second-factor capability the forwarder allows.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE EXISTS FOR, AND WHY IT IS ONE FILE AND NOT A SCREEN
 * ---------------------------------------------------------------------------
 * `GET /v1/mfa` is read by the settings section and written by an enrollment
 * that confirms, and that pairing is the whole reason this is a hook rather
 * than a `useQuery` inside `mfa-section.tsx`. The rule the verification surface
 * set — one place where a fetch happens, one place where it is cached, and the
 * invalidation spelled out where it cannot be forgotten — is the same rule,
 * and a status badge contradicting a factor the person just enabled is the
 * same bug as a renamed account leaving a stale header behind.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN IS PART OF THE KEY, FOR THE SAME REASON IT IS ON `me`
 * ---------------------------------------------------------------------------
 * This route resolves the CALLER's own factor from the token, so two different
 * tokens are two different answers to the same question. A constant key would
 * serve the previous person's second-factor state to whoever signed in next —
 * and on this route the state is about an account's security, so that is
 * somebody's lock, not a cosmetic detail.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT CACHE
 * ---------------------------------------------------------------------------
 * The enrollment secret and the recovery codes are one-time values the service
 * never returns again. They live in the section's component state for exactly
 * one render of one step and are never written to this cache — a secret in a
 * query cache is a secret that outlives the screen that showed it, which is
 * the defect the service's "returned here and never again" language exists to
 * prevent. See `mfa-section.tsx` and its tests.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";

/** MFA status belongs to the token that can read it. */
export function mfaKey(token: string | null) {
  return ["mfa", token] as const;
}

/**
 * Whether the caller has a confirmed second factor.
 *
 * Disabled without a token rather than fired at one: the service would answer
 * 401, and a signed-out visitor should never see an error for a question they
 * were not signed in to ask. `retry: false`, because the section renders an
 * explicit `ErrorState` with a "Try again" button and that button is a better
 * answer than three identical silent attempts.
 */
export function useMfaStatus() {
  const { client, token } = useAuth();

  return useQuery({
    queryKey: mfaKey(token),
    queryFn: async ({ queryKey }) => {
      const current = queryKey[1] as string;
      return client.mfaStatus(current);
    },
    enabled: token !== null,
    staleTime: Infinity,
    retry: false,
    // Nothing outlives its token: the entry for a signed-out session goes with
    // the key, the same as the session query's.
    gcTime: 0,
  });
}
