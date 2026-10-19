"use client";

/**
 * The pantry catalog client, in a context of its own.
 *
 * A separate provider from the session, like the billing and Box
 * clients and for the opposite reason: those are capabilities only an
 * authenticated session may use, and this one is a PUBLIC read. The catalog
 * and the project screens fetch with the caller's token when there is one and
 * with no credential at all when there is not, so the client is the only thing
 * they need and the session is not on their path.
 *
 * That is also why the injection prop matters more here than anywhere else in
 * the stack: the two screens this provider exists for are reachable by a
 * stranger, so a render test of either one must never reach a socket — not on
 * the anonymous path, and not by accident on the signed-in one.
 */

import { createContext, useContext, type ReactNode } from "react";

import { createPantryClient, type PantryClient } from "@/lib/pantry";

const PantryContext = createContext<PantryClient | null>(null);

export function PantryProvider({
  pantry,
  children,
}: {
  /** Overrides the real client. Tests only. */
  pantry?: PantryClient;
  children: ReactNode;
}) {
  return (
    <PantryContext.Provider value={pantry ?? createPantryClient()}>{children}</PantryContext.Provider>
  );
}

export function usePantry(): PantryClient {
  const client = useContext(PantryContext);
  if (!client) {
    throw new Error("usePantry must be used inside <Providers> (src/app/providers.tsx)");
  }
  return client;
}
