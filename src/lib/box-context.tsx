"use client";

/**
 * The Box entitlements client, in a context of its own.
 *
 * A separate provider from the session, like the billing and operator clients
 * and for the same reason: the identity client rides along on `AuthProvider`
 * because it is the session's own machinery, and this one is a capability —
 * the four Box entitlement routes — that only an authenticated session
 * may use. The credential is still the caller's own session token, forwarded
 * to Box and verified by identity there: no service credential exists
 * in this file, and none crosses to the browser.
 */

import { createContext, useContext, type ReactNode } from "react";

import { createBoxClient, type BoxClient } from "@/lib/box";

const BoxContext = createContext<BoxClient | null>(null);

export function BoxProvider({
  box,
  children,
}: {
  /** Overrides the real client. Tests only. */
  box?: BoxClient;
  children: ReactNode;
}) {
  return (
    <BoxContext.Provider value={box ?? createBoxClient()}>
      {children}
    </BoxContext.Provider>
  );
}

export function useBox(): BoxClient {
  const client = useContext(BoxContext);
  if (!client) {
    throw new Error("useBox must be used inside <Providers> (src/app/providers.tsx)");
  }
  return client;
}
