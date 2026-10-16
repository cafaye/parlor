"use client";

/**
 * The billing client, in a context of its own.
 *
 * A separate provider from the session, unlike the identity client which rides
 * along on `AuthProvider`. The reason is the error type as much as the
 * credential: `BillingError` and `IdentityError` are independent, so a change
 * to one service's envelope should not be a change to the other's client.
 *
 * **The session token crosses to the BFF and stops there.** billing
 * authenticates a signed token with a singular `account_id`, which the browser
 * does not hold; the browser's credential is identity's opaque session token,
 * and `src/lib/billing-token.server.ts` is the only thing that can turn one
 * into the other. So this client attaches the session token to every call and
 * the forwarder swaps it for a billing-scoped token before anything reaches
 * billing — billing itself never sees the session token.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createBillingClient, type BillingClient } from "@/lib/billing";
import { useAuth } from "@/lib/auth";

const BillingContext = createContext<BillingClient | null>(null);

/**
 * Whether a billing call can mean anything yet.
 *
 * Every billing call carries the session token — the BFF has nothing to
 * exchange otherwise — and on a fresh page load (the redirect back from the
 * payment processor is one) the token is read a commit after the first render.
 * A screen that fires its load effect during that window asks billing a
 * question with no credential, and billing answers the only thing it can: 401,
 * which the screen then renders as "billing could not be reached" on the page
 * a buyer lands on after paying. Measured on the launch stack, 2026-10-16.
 * So the screens wait for the session to be KNOWN — authed or anonymous;
 * anonymous still asks and still gets its 401, which is that person's answer
 * rather than a race.
 */
export function useBillingReady(): boolean {
  return useAuth().session.status !== "loading";
}

/**
 * The billing client, wired to the signed-in caller.
 *
 * The token is passed in from `useAuth`, and the exchange is why: the browser's
 * own credential is identity's session token, which billing does not read, so
 * the BFF exchanges it for a token billing does read. A client that sent
 * nothing left the exchange with nothing to work from, and every screen
 * answered "billing could not be reached" while the API answered 200 to an
 * exchange it was never asked to perform (measured on the launch stack,
 * 2026-10-16). The token in `localStorage` is the browser's only credential,
 * so it is the one that crosses — and the BFF never forwards it to billing.
 */
export function BillingProvider({
  billing,
  children,
}: {
  /** Overrides the real client. Tests only. */
  billing?: BillingClient;
  children: ReactNode;
}) {
  const { token } = useAuth();

  // One client per TOKEN, not per render. The client is what the screens'
  // load effects depend on, and a fresh object on every provider render made
  // every screen re-fetch for reasons the screen could not see — the third
  // request of the measured landing above was this. The token is the client's
  // only per-session state; the account is read from the URL at call time,
  // so it deliberately does not appear here.
  const client = useMemo(() => billing ?? createBillingClient({ token }), [billing, token]);

  return <BillingContext.Provider value={client}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingClient {
  const client = useContext(BillingContext);
  if (!client) {
    throw new Error("useBilling must be used inside <Providers> (src/app/providers.tsx)");
  }
  return client;
}
