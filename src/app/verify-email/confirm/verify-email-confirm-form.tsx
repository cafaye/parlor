"use client";

/**
 * `/verify-email/confirm` — spending the verification link.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE RESET SCREEN WITH THE PASSWORD FIELDS REMOVED
 * ---------------------------------------------------------------------------
 *
 * The two flows share a shape and almost nothing else, and the differences are
 * the whole design:
 *
 *   * **A verification revokes nothing and mints nothing.** `RedeemVerification`
 *     changes a fact about an address; it is not a change of credential, and
 *     identity is explicit that ending sessions over it "would punish somebody for
 *     clicking a link that proved who they already were". So there is no
 *     "sign in again" here — a reader who was signed in is still signed in, and
 *     the success state says so by offering the app rather than a login form.
 *   * **There is nothing to type.** The token IS the credential and it arrived in
 *     the URL, so the form is a single button. That button is the reason this
 *     screen does not redeem on load: see below.
 *   * **Every failure is recoverable by asking again.** No half-finished state,
 *     because nothing was half-changed.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURES, AND WHY THERE IS ONLY ONE SENTENCE FOR THEM
 * ---------------------------------------------------------------------------
 *
 * `POST /v1/email-verifications/confirm` answers 404 for everything that is not a
 * live token — never existed, expired, already spent, or minted for another flow
 * — behind the single sentinel `ErrTokenNotFound`. There is no honest way to tell
 * those four apart, so this screen does not try: it says the link cannot be used
 * and offers a new one. It specifically does NOT name any of the four, because
 * naming one confirms the token was once real and turns a guess into a probe.
 *
 * **A TRUNCATED TOKEN IS ALSO A 404, and that is measured rather than assumed.**
 * `identity/openapi/v1.yaml` declares `RecoveryTokenRequest.token` as exactly 43
 * characters and lists a 422 on the route, so this file first carried a branch for
 * it. A real identity was asked, with `{"token":"too-short"}`, and answered 404
 * with the ordinary `not_found` problem: `RedeemVerification` goes straight to
 * `tokens.Live(digest)`, and `tokenRequest` is one `string` with no validation on
 * it. So there is no separate sentence for a short token — it is one of the dead
 * ones, which is the honest answer anyway, since a truncated link is exactly as
 * unusable as a spent one and no more explicable. Recorded in CHANGELOG "Known
 * gaps".
 *
 * There is **no 503 branch here either, and that is not an oversight**: redemption
 * never touches the mailer — verified by reading the body live with the mailer
 * stopped, which still answers 404 — so a deployment that cannot send can still
 * verify an address that was mailed before the mailer went away. A "cannot send
 * email" sentence here would be a sentence about a dependency this route does not
 * use.
 *
 * Everything else is one generic sentence. `thrown.message` is never rendered;
 * that is where a host and a port live.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT SUBMIT ON LOAD
 * ---------------------------------------------------------------------------
 *
 * Same reason as the reset screen and the invitation screen: mail clients, chat
 * apps and link scanners fetch a URL to preview it. Confirming on render would
 * mark an address verified without a person clicking anything, and the link would
 * be dead for the human who then clicked it.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button, Callout, FieldSummary } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { IdentityError } from "@/lib/identity";

/**
 * 404 from `ErrTokenNotFound`, and the wording is doing real work.
 *
 * The service answers one 404 for a token that never existed, one that expired,
 * one already spent, and one minted for another flow. This sentence says only
 * that the link cannot be used, and deliberately does NOT speculate about which
 * of the four it was — the same rule the reset screen and the invitation screen
 * follow, and for the same reason.
 *
 * The first draft of this file said "it may have expired, or it may already have
 * been used". That reads as more careful and is strictly worse: it names two of
 * the four as the plausible ones, which tells anybody probing tokens that the one
 * they held had once been a good one.
 */
const LINK_UNUSABLE =
  "That verification link cannot be used. Ask for a new one and use the link that arrives.";

/**
 * What the 204 means, said in the only terms the person needs.
 *
 * It does not claim a mail was sent (none was) and it does not claim a session
 * ended (none did).
 */
const VERIFIED =
  "Your email address is verified. Nothing about your account changed except that this address is now proved.";

const UNEXPECTED = "Something went wrong. Try again.";

type ScreenState = "idle" | "failed" | "unusable-link" | "verified";

export function VerifyEmailConfirmForm({ token }: { token: string | null }) {
  const router = useRouter();
  const { client, session } = useAuth();
  const [state, setState] = useState<ScreenState>("idle");
  const [pending, setPending] = useState(false);
  // A ref, not `pending`: the disabled button lands a frame late, and a stale
  // closure read would let a second click spend an already-spent token.
  const inFlight = useRef(false);

  /**
   * Whether a reader is signed in, read once at the moment the 204 lands.
   *
   * `RedeemVerification` changes no credential, so this screen must not send
   * anybody to a sign-in form they did not need — a verification that signed you
   * out would be the opposite of what it promises. Anything other than a resolved
   * session (`authed`) takes the signed-out route, including the `loading` state
   * during hydration, where claiming otherwise would flash "continue" at somebody
   * who then finds themselves anonymous.
   */
  const signedIn = session.status === "authed";

  // No token is a real state, not an error: a deployment can point
  // `RECOVERY_LINK_TEMPLATE` at a path segment instead of `?token=`, and this
  // screen cannot read what it was not given. Saying so — with the way forward —
  // beats rendering a button that could only ever fail.
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <FieldSummary>That link is missing its verification code.</FieldSummary>
        <Button onClick={() => router.push("/verify-email")} type="button" variant="secondary">
          Request a new link
        </Button>
      </div>
    );
  }

  if (state === "unusable-link") {
    return (
      <div className="flex flex-col gap-4">
        <FieldSummary>{LINK_UNUSABLE}</FieldSummary>
        <Button onClick={() => router.push("/verify-email")} type="button" variant="secondary">
          Request a new link
        </Button>
      </div>
    );
  }

  if (state === "verified") {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="positive">{VERIFIED}</Callout>
        {/*
          Two destinations, one control, chosen from the session rather than from
          anything the service said. A signed-in reader continues into the app; a
          signed-out one signs in. The link is the same button either way, so the
          screen does not narrate a branch it did not take.
        */}
        <Button
          onClick={() => router.push(signedIn ? "/accounts" : "/login")}
          type="button"
          variant="secondary"
        >
          {signedIn ? "Continue to your accounts" : "Sign in"}
        </Button>
      </div>
    );
  }

  async function onConfirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setState("idle");
    try {
      await client.redeemEmailVerification({ token: token as string });
      setState("verified");
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state === "failed" ? <FieldSummary>{UNEXPECTED}</FieldSummary> : null}
      <Button
        aria-busy={pending}
        busy={pending}
        disabled={pending}
        onClick={onConfirm}
        type="button"
      >
        Verify my email
      </Button>
    </div>
  );
}

/**
 * Picks the state out of a failure.
 *
 * The same shape as the other auth screens' `failureState`, minus the per-field
 * list: this route's only field is the token in the URL, which the person did not
 * type and cannot retype, so there is nothing to put a message next to — and
 * because a 422 the document declares is a 404 the service actually sends, there is
 * no field failure to place.
 */
function failureState(thrown: unknown): ScreenState {
  if (thrown instanceof IdentityError) {
    // 404 covers a token that never existed, one that expired, one already spent,
    // one belonging to another flow, and one of the wrong length. One sentence for
    // all of them, because there is one answer and no way to narrow it.
    if (thrown.status === 404) return "unusable-link";
    // A 503 cannot happen here and would be wrong to word as a mail failure: see
    // this file's header. It falls through to the generic sentence on purpose
    // rather than getting a branch that claims something this route never touches.
  }

  return "failed";
}