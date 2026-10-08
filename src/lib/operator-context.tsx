"use client";

/**
 * The operator client, in a context of its own.
 *
 * A separate provider from the session, like the billing client and for the
 * same reason: the identity client rides along on `AuthProvider` because it is
 * the session's own machinery, and this one is a capability — the four
 * human-session system-admin routes — that only a staff session may use. The
 * credential is still the caller's own session token: no machine key exists
 * in this file, and none crosses to the browser.
 */

import { createContext, useContext, type ReactNode } from "react";

import { createOperatorClient, type OperatorClient } from "@/lib/operator";

const OperatorContext = createContext<OperatorClient | null>(null);

export function OperatorProvider({
  operator,
  children,
}: {
  /** Overrides the real client. Tests only. */
  operator?: OperatorClient;
  children: ReactNode;
}) {
  return (
    <OperatorContext.Provider value={operator ?? createOperatorClient()}>
      {children}
    </OperatorContext.Provider>
  );
}

export function useOperator(): OperatorClient {
  const client = useContext(OperatorContext);
  if (!client) {
    throw new Error("useOperator must be used inside <Providers> (src/app/providers.tsx)");
  }
  return client;
}
