import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_TOKEN_KEY, createTokenStore } from "./token-store";

/**
 * The store is the only thing that survives a reload, so its contract is
 * small and worth pinning: one key, string in / string|null out, and a
 * subscription React can re-render on.
 *
 * These tests drive the real `localStorage`, not a fake — persistence is the
 * whole point of the module, and a fake would only prove the fake works.
 */
describe("token store", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("reports no token before one is written", () => {
    const store = createTokenStore();

    expect(store.get()).toBeNull();
  });

  it("reads back the token it was given", () => {
    const store = createTokenStore();

    store.set("tok_abc");

    expect(store.get()).toBe("tok_abc");
  });

  it("writes to localStorage under the shared session key", () => {
    // The key is a contract with the BFF packet that will own the cookie. A
    // rename here silently orphans every session in the field, so pin it.
    const store = createTokenStore();

    store.set("tok_abc");

    expect(localStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
    expect(localStorage.length).toBe(1);
  });

  it("clears the stored token when set to null", () => {
    const store = createTokenStore();
    store.set("tok_abc");

    store.set(null);

    expect(store.get()).toBeNull();
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  it("notifies subscribers when the token changes", () => {
    const store = createTokenStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("tok_abc");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers when the token is cleared", () => {
    const store = createTokenStore();
    store.set("tok_abc");
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(null);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createTokenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set("tok_abc");

    expect(listener).not.toHaveBeenCalled();
  });

  it("survives a corrupted entry by reporting no token", () => {
    // localStorage is attacker-writable in any XSS, and a hand-edited value is
    // not a crash worth a stack trace. Anything unparseable reads as signed out.
    localStorage.setItem(SESSION_TOKEN_KEY, "{not json");
    const store = createTokenStore();

    expect(store.get()).toBeNull();
  });

  it("round-trips a token through the stored JSON envelope", () => {
    const store = createTokenStore();
    store.set("tok_abc");

    const raw = JSON.parse(localStorage.getItem(SESSION_TOKEN_KEY) ?? "null") as {
      token: string;
    };

    expect(raw.token).toBe("tok_abc");
  });

  /**
   * The expiry `POST /v1/session` reports, kept beside the token in the SAME
   * envelope rather than under a second key.
   *
   * The envelope was a JSON object from the first commit precisely so this could
   * be added later without a migration, and this is that later. A second key
   * would mean a second read, a second write and a second thing to forget to
   * clear — and two sources of truth for one session.
   */
  describe("the expiry login reported", () => {
    it("reads back the instant it was given", () => {
      const store = createTokenStore();
      store.set("tok_abc", "2026-03-14T12:00:00Z");

      expect(store.getExpiry()).toBe("2026-03-14T12:00:00Z");
    });

    it("reports no expiry for an entry written before the field existed", () => {
      // A session stored by an older build is real and must keep working; it
      // simply has nothing to report, which is different from reporting an
      // instant nobody gave us.
      const store = createTokenStore();
      store.set("tok_abc");

      expect(store.getExpiry()).toBeNull();
    });

    it("reports no expiry when there is no token at all", () => {
      expect(createTokenStore().getExpiry()).toBeNull();
    });

    it("ignores an expiry that is not a string", () => {
      localStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify({ token: "tok_abc", expires_at: 17 }));
      const store = createTokenStore();

      expect(store.get()).toBe("tok_abc");
      expect(store.getExpiry()).toBeNull();
    });

    it("forgets the expiry with the token", () => {
      const store = createTokenStore();
      store.set("tok_abc", "2026-03-14T12:00:00Z");
      store.set(null);

      expect(store.getExpiry()).toBeNull();
    });

    it("survives a corrupted entry by reporting neither", () => {
      localStorage.setItem(SESSION_TOKEN_KEY, "{not json");
      const store = createTokenStore();

      expect(store.getExpiry()).toBeNull();
    });
  });
});
