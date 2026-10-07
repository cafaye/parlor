"use client";

/**
 * Session state: the React Query cache for who you are, `localStorage` for the
 * token that proves it, and this file for the rules that join them.
 *
 * The token is the React Query key. That one choice is what keeps the cache
 * honest: a query keyed `["session", token]` cannot be served to a different
 * session than the one it was fetched for, so signing in as someone else can
 * never flash the previous person's name on the way to a fetch.
 *
 * What this file deliberately does not do is handle cookies. The session
 * cookie identity sets is `HttpOnly`, which means the browser owns it and this
 * bundle cannot read it, synchronize on it, or clear it. Until parlor sits
 * behind a BFF route, the token in `localStorage` is the authority; that is a
 * weaker position and it is a temporary one. See README, "Sessions".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import {
  IdentityError,
  type Credentials,
  type IdentityClient,
  type LoginResult,
  type Session,
  type User,
} from "@/lib/identity";
import { createTokenStore, type TokenStore } from "@/lib/token-store";

/** The token is the key, so a different session is a different cache entry. */
export function sessionQueryKey(token: string | null) {
  return ["session", token] as const;
}

/**
 * The server snapshot: "the browser has not told us yet".
 *
 * `useSyncExternalStore` calls `getServerSnapshot` while rendering on the
 * server and during hydration, where `localStorage` does not exist. Without a
 * third answer for that moment the two options are "anonymous" — a "Sign in"
 * link painted over a signed-in reload — or a different effect to tell
 * hydration from a normal render. One commit of nothing is the smaller lie.
 */
const UNKNOWN_TOKEN = Symbol("parlor.unknown-token");

type TokenRead = string | null | typeof UNKNOWN_TOKEN;

export type SessionState =
  /** No answer yet: server render, or a stored token we have not exchanged. */
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authed"; user: User };

/**
 * The session context's value.
 *
 * The three calls are PROPERTY declarations rather than method shorthand, and
 * for the reason `IdentityClient` and `BillingClient` spell theirs that way: a
 * method signature tells TypeScript the member has a `this`, so
 * `const { login } = useAuth()` — which every form in this app does, and which
 * is the whole point of a context — is a method separated from its object, and
 * `@typescript-eslint/unbound-method` rejects it. `AuthProvider` below supplies
 * arrow functions closing over `identity` and `store`, so there is no `this` to
 * lose. The two client types spell it the same way because all three are the
 * same shape of thing: a boundary this app injects into.
 */
export type AuthValue = {
  session: SessionState;
  /**
   * The first leg of a sign in, which is sometimes the whole of one.
   *
   * Returns the `LoginResult` rather than writing it into the void, because the
   * 202 arm is a second factor owed and NOT a session: the caller has to know
   * which of the two arrived before it can decide whether to navigate. The
   * session arm's token is written here, exactly as it always was; the
   * `mfa_required` arm mints nothing, so there is nothing to write until
   * `completeSecondFactor` finishes the flow.
   */
  login: (credentials: Credentials) => Promise<LoginResult>;
  register: (credentials: Credentials) => Promise<User>;
  logout: () => Promise<void>;
  /**
   * Forget the session this browser holds WITHOUT asking the service.
   *
   * For the case where the session is already dead server-side: a session this
   * app revoked by id (`DELETE /v1/sessions/{id}`), a password reset redeemed
   * in another tab. Calling `logout` there would send a token the service has
   * already refused, and the 401 it answers with is noise rather than
   * information — the revocation already happened, and the local half is the
   * only half left to clear.
   *
   * The same two writes `logout`'s `finally` makes — `store.set(null)` and
   * `queryClient.clear()` — because the token is the query key and an entry
   * keyed on a dead token is an entry that can only ever 401.
   */
  forgetSession: () => void;
  /**
   * Take a session identity has already minted, without asking it again.
   *
   * `login` and `register` both make their request and write the token
   * themselves. A social sign-in cannot use either: `completeSocialLogin` hands
   * back a token that was spent exchanging an authorization code, and there is
   * nothing left to ask the service — asking again would be a second request
   * for a session that already exists, on the one leg where an extra request can
   * cost something.
   *
   * So this is the same write, exposed: `store.set(session.token)`, which is
   * what changes the query key and what starts the `me` fetch. Nothing needs
   * invalidating for the same reason nothing does after `login` — the new key
   * names a different session, so it has no data to be stale.
   *
   * It is a method on the context rather than a `createTokenStore()` call at the
   * call site because the store is an INSTANCE (`createTokenStore` closes over
   * its own listeners), and a second instance would write the same key to
   * `localStorage` without notifying the one the provider is subscribed to. The
   * header would stay signed out; the reload would be signed in. That is the
   * bug this method exists to make unwriteable.
   */
  adoptSession: (session: Session) => void;
  /** True while any of the three is in flight. */
  pending: boolean;
  /**
   * The identity client every screen in this app talks to.
   *
   * On the same context as the session rather than in a context of its own,
   * because there is one client and one session and they are set up together in
   * `Providers`. A second provider would be a second place to inject a stub,
   * and a render test that injected one and forgot the other would get a tree
   * that half-works — which is the failure mode this file exists to prevent.
   *
   * Every call still goes through here and never through `fetch`: the client
   * carries the transport, so handing a screen this object is handing it the
   * only sanctioned way to reach the network.
   */
  client: IdentityClient;
  /**
   * The session token, or null when there is not one.
   *
   * Exposed because every tenancy call takes it as its first argument: the
   * service resolves a session at the top of every account route, so a screen
   * that wants an account has to hold the credential that authorises it. It is
   * the same token the store holds and the same one the query keys are built
   * from — one value, read from one place, so there is no second answer to
   * "who is asking" for a component to disagree with.
   */
  token: string | null;
  /**
   * When the session expires, as `POST /v1/session` reported it, or null when
   * nothing recorded one.
   *
   * Read from the same store as `token` rather than held here, because it is a
   * property of THAT session: a value kept in this component would outlive the
   * token it belongs to and be shown beside a different person's session. It is
   * null after a sign-out, and null for a session stored before the store kept
   * the field — which is a fact, not a value to reconstruct.
   */
  expiresAt: string | null;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  identity,
  tokens,
  children,
}: {
  identity: IdentityClient;
  tokens?: TokenStore;
  children: ReactNode;
}) {
  const store = useMemo(() => tokens ?? createTokenStore(), [tokens]);
  const queryClient = useQueryClient();

  // Subscribing to the store is what makes sign-in and sign-out re-render the
  // shell: nobody has to remember to invalidate anything after writing a token.
  const read = useSyncExternalStore<TokenRead>(
    store.subscribe,
    store.get,
    () => UNKNOWN_TOKEN,
  );
  const token = read === UNKNOWN_TOKEN ? null : read;

  const session = useQuery({
    queryKey: sessionQueryKey(token),
    queryFn: async ({ queryKey }) => {
      const current = queryKey[1] as string;
      try {
        return await identity.me(current);
      } catch (error) {
        // A rejected token is the normal case — an expiry, a sign-out on
        // another device, a service restart. Forgetting it here is what stops
        // every later render from re-asking a question with a dead answer.
        if (error instanceof IdentityError && error.status === 401) store.set(null);
        throw error;
      }
    },
    enabled: read !== null && read !== UNKNOWN_TOKEN,
    staleTime: Infinity,
    // 401 is an answer, not a hiccup. Retrying it three times would turn a
    // signed-out visitor into a burst of failing requests.
    retry: false,
    // Nothing outlives its token: the entry for a signed-out session is gone
    // from memory the moment the key changes.
    gcTime: 0,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: Credentials) => {
      const result = await identity.login(credentials);
      // Only the session arm has a token to write. Writing it changes the query
      // key, which is what starts the `me` fetch. Nothing needs invalidating:
      // the new key names a different session, so it has no data to be stale,
      // and the old entry is dropped by `gcTime: 0` the moment it goes
      // inactive. A person signing in as someone else sees the header go quiet
      // and then the right name — never the previous one.
      //
      // The `mfa_required` arm mints nothing and sets no session cookie, so
      // there is nothing to write: the token arrives with the SECOND leg, and
      // `adoptSession` below is what writes it. Writing nothing here is the
      // whole of the property — a challenge is a one-time credential for the
      // leg that spends it, never a session.
      if (result.kind === "session") {
        store.set(result.session.token, result.session.expires_at);
      }
      return result;
    },
  });

  const registerMutation = useMutation({
    mutationFn: (credentials: Credentials) => identity.register(credentials),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const current = store.get();
      try {
        // Best effort. The local half below is what the person asked for; the
        // server half is cleanup, and holding their click hostage to it would
        // leave them stuck in a session with no way out of it.
        if (current) await identity.logout(current);
      } finally {
        store.set(null);
        queryClient.clear();
      }
    },
  });

  const value: AuthValue = {
    session: deriveSession({ read, query: session }),
    client: identity,
    login: (credentials) => loginMutation.mutateAsync(credentials),
    register: (credentials) => registerMutation.mutateAsync(credentials),
    logout: () => logoutMutation.mutateAsync(),
    forgetSession: () => {
      store.set(null);
      queryClient.clear();
    },
    // Deliberately NOT a mutation. There is nothing in flight here — the request
    // that matters has already resolved by the time this is called, and a
    // mutation would put a second one in `pending` for the span between the
    // exchange and the navigation, which is the span in which the header reads
    // `anonymous` and flickers.
    adoptSession: (session) => store.set(session.token, session.expires_at),
    pending: loginMutation.isPending || registerMutation.isPending || logoutMutation.isPending,
    // `UNKNOWN_TOKEN` is the server render and the hydration commit, where
    // there is genuinely no token to report. Collapsing it to null is the same
    // answer the session state gives for "nobody is signed in yet", so a
    // component reading both never sees a token without a session.
    token: read === UNKNOWN_TOKEN ? null : read,
    expiresAt: read === UNKNOWN_TOKEN ? null : store.getExpiry(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function deriveSession({
  read,
  query,
}: {
  read: TokenRead;
  query: { isPending: boolean; isError: boolean; data: User | undefined };
}): SessionState {
  // Server render, and the first client commit while hydrating it.
  if (read === UNKNOWN_TOKEN) return { status: "loading" };
  // No token means no question to ask, and no round trip to find out.
  if (read === null) return { status: "anonymous" };
  // A token we have not exchanged yet. Reporting "loading" rather than
  // "anonymous" is what stops a reload from flashing a sign-in link at someone
  // who is in fact signed in.
  if (query.isPending) return { status: "loading" };
  // A failure that is not a 401 — the service is down, say — leaves the token
  // alone and reads as signed out. The next load re-asks. Noting it here
  // because "signed out" is a claim the user will believe.
  if (query.isError || !query.data) return { status: "anonymous" };
  return { status: "authed", user: query.data };
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside <Providers> (src/app/providers.tsx)");
  }
  return value;
}
