import type { SignupTimestamp } from "./identity";

/**
 * The signup proof's lifecycle: when a minted pair may be sent.
 *
 * Identity refuses a pair younger than 2 seconds as bot-like and older than
 * one hour as expired (`identity/internal/signup/signup.go`, `MinAge`/`MaxAge`),
 * and every refusal is the same generic 422. The render-time mint in the
 * register form fixes the missing-pair defect but leaves the two ordinary edges
 * a form cannot avoid: a password-manager fast submit lands inside the two
 * seconds, and a tab left open past the hour keeps a stale pair.
 *
 * Both edges are handled here, at submit, from LOCAL ELAPSED time only — the
 * milliseconds since this client received the pair — and never from the
 * pair's `timestamp` against this client's clock. That is deliberate: the
 * server computes age from its own clock, and this client's clock is not a
 * party to that subtraction. Local elapsed is a LOWER bound on the age the
 * server will observe (the server minted before this client received, and the
 * server verifies after this client sends), so waiting on it is conservative
 * in the right direction, and renewing on it needs only a margin for the two
 * flights in between.
 */

/**
 * How old a pair must be, by local elapsed time, before it is sent.
 *
 * Identity's floor is 2 seconds; the extra half second is the margin for the
 * submit flight — the pair keeps ageing between this client sending it and
 * identity verifying it, so a pair this old locally cannot arrive young.
 */
export const SIGNUP_PROOF_MIN_AGE_MS = 2500;

/**
 * How old a pair may be, by local elapsed time, before it is renewed.
 *
 * Identity's ceiling is one hour; renewing at fifty-five minutes leaves five
 * for the submit flight and for a slow tab, so a pair this client keeps
 * cannot arrive expired.
 */
export const SIGNUP_PROOF_RENEW_AFTER_MS = 55 * 60 * 1000;

/** A minted pair with when this client received it, in `now()` millis. */
export type CachedSignupProof = { pair: SignupTimestamp; mintedAt: number };

/** A sleep this module can wait on; `setTimeout` in the form, scripted in tests. */
export type ProofClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const liveClock: ProofClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Returns a pair that is safe to send: aged past the floor, renewed past the
 * ceiling, freshly minted when there is nothing to keep.
 *
 * A re-mint is itself young, so it waits the full floor rather than submitting
 * instantly — minting at submit and sending in the same breath is exactly the
 * fast-submit edge. A mint failure propagates to the caller, which reports it
 * as a generic failure and never submits without a proof.
 */
export async function ensureSignupProof(
  cached: CachedSignupProof | null,
  mint: () => Promise<SignupTimestamp>,
  clock: ProofClock = liveClock,
): Promise<CachedSignupProof> {
  let current = cached;
  if (current === null || clock.now() - current.mintedAt >= SIGNUP_PROOF_RENEW_AFTER_MS) {
    const pair = await mint();
    current = { pair, mintedAt: clock.now() };
  }
  const wait = SIGNUP_PROOF_MIN_AGE_MS - (clock.now() - current.mintedAt);
  if (wait > 0) {
    await clock.sleep(wait);
  }
  return current;
}
