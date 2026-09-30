/**
 * Where the session token lives between page loads.
 *
 * The token is stored in `localStorage` because this is the only place a
 * browser SPA can keep one while the requests are cross-origin: the
 * `HttpOnly` session cookie identity sets is unreachable from here, and
 * `document.cookie` is not a substitute. That trade is temporary and the BFF
 * packet reverses it — a server route in front of identity, same-origin, with
 * the cookie as the only authority. `SESSION_TOKEN_KEY` is the one string that
 * has to be kept in step when that happens.
 *
 * A token in `localStorage` is readable by any script on the origin, so it is
 * worth being blunt: this is the weaker of the two options, it is here because
 * the stronger one needs a server in front of identity, and it is not a place
 * to put anything long-lived. What it buys is a session that survives a
 * reload; what it costs is that an XSS on this origin is a session compromise.
 */

/** Storage key for the session token. The BFF packet renames this. */
export const SESSION_TOKEN_KEY = "parlor.session.token";

export type TokenStore = {
  get(): string | null;
  set(token: string | null): void;
  /** Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
};

/**
 * The three methods close over `storage` and `listeners` rather than reading
 * `this`, so they are safe to hand to `useSyncExternalStore` detached — which
 * is exactly what `AuthProvider` does. Keep it that way: a `this`-based method
 * would work in a test that calls `store.get()` and fail silently in the app.
 */
type Options = {
  key?: string;
  storage?: Storage | null;
};

export function createTokenStore(options: Options = {}): TokenStore {
  const key = options.key ?? SESSION_TOKEN_KEY;
  const listeners = new Set<() => void>();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  return {
    get() {
      const raw = storage?.getItem(key);
      if (!raw) return null;
      try {
        // A JSON envelope, so a later packet can add `expires_at` next to the
        // token without a second key and a second migration.
        const parsed = JSON.parse(raw) as { token?: unknown };
        return typeof parsed.token === "string" ? parsed.token : null;
      } catch {
        // Hand-edited or truncated. Not worth a crash: read as signed out and
        // let the next write replace it.
        return null;
      }
    },

    set(token) {
      if (token === null) {
        storage?.removeItem(key);
      } else {
        storage?.setItem(key, JSON.stringify({ token }));
      }
      for (const listener of listeners) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** `localStorage` in a browser, nothing on a server without a guard. */
function defaultStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
