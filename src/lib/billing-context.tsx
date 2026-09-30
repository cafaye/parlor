"use client";

/**
 * The billing client, in a context of its own.
 *
 * A separate provider from the session, unlike the identity client which rides
 * along on `AuthProvider`. The reason is the token.
 *
 * **No identity session token is sent to billing.** billing's contract declares
 * `security: []` with no `securitySchemes` at all, and documents it as a
 * recorded gap: the surface is open until an authorization packet lands. So
 * there is nothing to authenticate with, and this client takes no credential.
 *
 * That is a deliberate decision rather than an omission. Handing an identity
 * session token to a service that does not authenticate it would put a live
 * session credential into a third party's request logs for no benefit, and the
 * moment billing grows real auth it will want a credential scoped to billing
 * rather than one borrowed from another service's boundary. When that packet
 * lands, the parameter belongs here.
 *
 * The other reason for a separate context is symmetry with the error type:
 * `BillingError` and `IdentityError` are independent, so a change to one
 * service's envelope should not be a change to the other's client.
 */

import { createContext, useContext, type ReactNode } from "react";

import { createBillingClient, type BillingClient } from "@/lib/billing";

const BillingContext = createContext<BillingClient | null>(null);

export function BillingProvider({
  billing,
  children,
}: {
  /** Overrides the real client. Tests only. */
  billing?: BillingClient;
  children: ReactNode;
}) {
  return <BillingContext.Provider value={billing ?? createBillingClient()}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingClient {
  const client = useContext(BillingContext);
  if (!client) {
    throw new Error("useBilling must be used inside <Providers> (src/app/providers.tsx)");
  }
  return client;
}
