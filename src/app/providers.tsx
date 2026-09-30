"use client";

/**
 * The provider stack, in one file, mounted once from `layout.tsx`.
 *
 * Two providers, in this order: React Query owns the cache that session state
 * lives in, and `AuthProvider` owns the rules for what goes in it. The identity
 * client and the token store are parameters rather than module-level singletons
 * for one reason — a test injects a scripted client and a memory store, so
 * there is no code path from a test to a socket. The app passes neither and
 * gets the real ones.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AuthProvider } from "@/lib/auth";
import { createIdentityClient, type IdentityClient } from "@/lib/identity";
import { createTokenStore, type TokenStore } from "@/lib/token-store";

export function Providers({
  children,
  identity,
  tokens,
}: {
  children: ReactNode;
  /** Overrides the real client. Tests only. */
  identity?: IdentityClient;
  /** Overrides the real store. Tests only. */
  tokens?: TokenStore;
}) {
  // `useState` with an initializer, not a module constant: one client per
  // request on the server, and a fresh cache per mount in the browser.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Nothing here refetches behind someone's back. A session is
            // fetched when it is asked for and when its token changes.
            refetchOnWindowFocus: false,
            staleTime: Infinity,
          },
        },
      }),
  );

  const [client] = useState(() => identity ?? createIdentityClient());
  const [store] = useState(() => tokens ?? createTokenStore());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider identity={client} tokens={store}>
        {children}
      </AuthProvider>
    </QueryClientProvider>
  );
}
