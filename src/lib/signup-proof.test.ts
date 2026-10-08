import { describe, expect, it, vi } from "vitest";

import {
  SIGNUP_PROOF_MIN_AGE_MS,
  SIGNUP_PROOF_RENEW_AFTER_MS,
  ensureSignupProof,
  type CachedSignupProof,
  type ProofClock,
} from "./signup-proof";

/**
 * The signup proof's lifecycle, against a scripted clock.
 *
 * The form cannot submit a pair younger than identity's two seconds or older
 * than its hour, and it cannot trust its own clock against the server's — so
 * `ensureSignupProof` works only in local elapsed time. Each case pins one arm:
 * a young pair waits out the floor, an aged one goes straight through, a stale
 * one (or none) is re-minted and then aged, and a failed mint never yields a
 * proof to submit with.
 */
const PAIR = { timestamp: 1759843200, signature: "minted-signature" };
const FRESH = { timestamp: 1759846800, signature: "renewed-signature" };

function scriptedClock(at: number, sleeps: number[] = []): ProofClock {
  let now = at;
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

function cached(ageMs: number, pair = PAIR, now = 1_000_000): CachedSignupProof {
  return { pair, mintedAt: now - ageMs };
}

describe("ensureSignupProof", () => {
  it("holds a young pair until it has aged past the floor", async () => {
    const sleeps: number[] = [];
    const mint = vi.fn(() => Promise.resolve(FRESH));

    const proof = await ensureSignupProof(cached(500), mint, scriptedClock(1_000_000, sleeps));

    expect(proof.pair).toBe(PAIR);
    expect(mint).not.toHaveBeenCalled();
    expect(sleeps).toEqual([SIGNUP_PROOF_MIN_AGE_MS - 500]);
  });

  it("sends an aged pair without waiting", async () => {
    const sleeps: number[] = [];
    const mint = vi.fn(() => Promise.resolve(FRESH));

    const proof = await ensureSignupProof(cached(30_000), mint, scriptedClock(1_000_000, sleeps));

    expect(proof.pair).toBe(PAIR);
    expect(mint).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
  });

  it("renews a stale pair and ages the renewal past the floor", async () => {
    const sleeps: number[] = [];
    const mint = vi.fn(() => Promise.resolve(FRESH));

    const proof = await ensureSignupProof(
      cached(SIGNUP_PROOF_RENEW_AFTER_MS + 1),
      mint,
      scriptedClock(1_000_000, sleeps),
    );

    expect(mint).toHaveBeenCalledTimes(1);
    expect(proof.pair).toEqual(FRESH);
    expect(sleeps).toEqual([SIGNUP_PROOF_MIN_AGE_MS]);
  });

  it("mints when there is no pair and ages the mint past the floor", async () => {
    const sleeps: number[] = [];
    const mint = vi.fn(() => Promise.resolve(PAIR));

    const proof = await ensureSignupProof(null, mint, scriptedClock(1_000_000, sleeps));

    expect(mint).toHaveBeenCalledTimes(1);
    expect(proof.pair).toEqual(PAIR);
    expect(proof.mintedAt).toBe(1_000_000);
    expect(sleeps).toEqual([SIGNUP_PROOF_MIN_AGE_MS]);
  });

  it("lets a mint failure propagate so the caller submits nothing", async () => {
    const mint = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(ensureSignupProof(null, mint, scriptedClock(1_000_000))).rejects.toThrow(
      "Failed to fetch",
    );
  });
});
