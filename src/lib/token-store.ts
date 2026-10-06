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

/**
 * Written as PROPERTY declarations holding function types, not as method
 * shorthand, and that is not a formatting preference.
 *
 * TypeScript reads `get(): string | null` as a method with an implicit `this`,
 * and `subscribe(listener)` handed to `useSyncExternalStore` — which is
 * exactly what `AuthProvider` does, since that hook takes two loose
 * functions — is therefore a method separated from its object. Under
 * `@typescript-eslint/unbound-method` that is an error, and it is right to be
 * suspicious of it in general: a method that reads `this` and is called
 * detached fails.
 *
 * These three do not read `this`. They close over `storage` and `listeners`,
 * and `createTokenStore` below returns them from an object literal, so there
 * is no object for a `this` to belong to. The method spelling asserts a
 * binding that does not exist; the property spelling states the truth and is
 * the same type at run time.
 */
export type TokenStore = {
  get: () => string | null;
  /**
   * Write the token, and the expiry `POST /v1/session` reported beside it.
   *
   * The second argument is optional rather than required because the two callers
   * that CLEAR the store have no expiry to write, and a required parameter would
   * make them pass `null` for a field they are not talking about.
   */
  set: (token: string | null, expiresAt?: string | null) => void;
  /**
   * The expiry login reported, or null when there is none.
   *
   * Null is a real answer rather than a fallback: a session stored before this
   * field existed is a valid session with no expiry to report, and saying so is
   * different from inventing an instant.
   */
  getExpiry: () => string | null;
  /** Returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
};
type Options = {
  key?: string;
  storage?: Storage | null;
};

export function createTokenStore(options: Options = {}): TokenStore {
  const key = options.key ?? SESSION_TOKEN_KEY;
  const listeners = new Set<() => void>();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  /**
   * The stored envelope, or null when there is not a usable one.
   *
   * One reader for both getters, and that is the point: `get` and `getExpiry`
   * cannot disagree about whether an entry is readable, so a screen that reads
   * the token and a screen that reads the expiry are always talking about the
   * same session. A hand-edited or truncated entry reads as no session at all
   * rather than as half of one.
   */
  function read(): { token?: unknown; expires_at?: unknown } | null {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { token?: unknown; expires_at?: unknown };
    } catch {
      // Not worth a crash: read as signed out and let the next write replace it.
      return null;
    }
  }

  return {
    get() {
      const entry = read();
      return typeof entry?.token === "string" ? entry.token : null;
    },

    getExpiry() {
      const entry = read();
      return typeof entry?.expires_at === "string" ? entry.expires_at : null;
    },

    set(token, expiresAt) {
      if (token === null) {
        storage?.removeItem(key);
      } else {
        // `expires_at: undefined` is DROPPED by `JSON.stringify`, so a session
        // with no expiry to report writes exactly the envelope this file wrote
        // before the field existed — one shape for readers and migrators, not two.
        storage?.setItem(key, JSON.stringify({ token, expires_at: expiresAt ?? undefined }));
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
