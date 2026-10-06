"use client";

/**
 * React Query bindings for the one verification capability the forwarder allows.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE EXISTS FOR, AND WHY IT IS ONE FILE AND NOT A SCREEN
 * ---------------------------------------------------------------------------
 * `GET /v1/email-verification` is read by a badge and written by a resend that
 * can invalidate it, and that pairing is the whole reason this is a hook rather
 * than a `useQuery` inside `settings-screen.tsx`. The rule the tenancy surface
 * set — one place where a fetch happens, one place where it is cached, and the
 * invalidation spelled out where it cannot be forgotten — is the same rule, and
 * the badge contradicting a note printed under it is the same bug as a renamed
 * account leaving a stale header behind.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN IS PART OF THE KEY, FOR THE SAME REASON IT IS ON `me`
 * ---------------------------------------------------------------------------
 * This route resolves the CALLER's own address from the token, so two different
 * tokens are two different answers to the same question. A constant key would
 * serve the previous person's verification state to whoever signed in next —
 * and on this route the state is about an address, so that is somebody's
 * account status, not a cosmetic detail.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";

/** Verification state belongs to the token that can read it. */
export function verificationKey(token: string | null) {
  return ["email-verification", token] as const;
}

/**
 * Whether the caller's own address is proved.
 *
 * Disabled without a token rather than fired at one: the service would answer
 * 401, and a signed-out visitor should never see an error for a question they
 * were not signed in to ask. `retry: false`, because the screen renders an
 * explicit `ErrorState` with a "Try again" button and that button is a better
 * answer than three identical silent attempts.
 */
export function useVerificationStatus() {
  const { client, token } = useAuth();

  return useQuery({
    queryKey: verificationKey(token),
    queryFn: async ({ queryKey }) => {
      const current = queryKey[1] as string;
      return client.verificationStatus(current);
    },
    enabled: token !== null,
    staleTime: Infinity,
    retry: false,
    // Nothing outlives its token: the entry for a signed-out session goes with
    // the key, the same as the session query's.
    gcTime: 0,
  });
}