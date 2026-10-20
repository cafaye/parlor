"use client";

/**
 * The screen a person lands on after the provider has sent them back.
 *
 * `GET /v1/auth/oauth/{provider}/callback` arrives here as a top-level browser
 * navigation. Identity answers it with 200, a JSON body and a `Set-Cookie` — it
 * does NOT redirect onward — so without this page a completed round trip shows
 * somebody a JSON blob. That asymmetry is the whole design: the START leg is a
 * redirect the browser follows, the CALLBACK leg is a body this app has to turn
 * into a page.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROUTE SERVES THE PAGE AND DOES NOT DO THE EXCHANGE
 * ---------------------------------------------------------------------------
 * `src/routes/v1/auth/oauth/$provider/callback.tsx` answers a document
 * navigation with this component and forwards anything else to identity. So the
 * document that loads this page never reaches identity, and the exchange below
 * is the only request that does. That is not an accident of the shape, it is the
 * property: an authorization code is ONE-SHOT, spent by the single request
 * identity sees, so a page whose own navigation reached identity and then
 * fetched the same URL would spend the code twice and the second attempt would
 * fail on a spent code — reported to the person as "this did not work", which is
 * the worst possible reading of a sign-in that actually worked.
 *
 * The latch below is the second half of the same guarantee. `useEffect` runs
 * once per mount in normal React, but a StrictMode double-invoke, a remount or
 * a parent that hands this component a fresh query object must not turn one page
 * load into two exchanges either, and the refusal has to be cheap enough that
 * nobody is tempted to remove it.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR ANSWERS, AND NONE OF THEM IS "SIGNED IN" BY DEFAULT
 * ---------------------------------------------------------------------------
 * `completeSocialLogin` returns a discriminated union because the wire can carry
 * three mutually exclusive bodies, and reading the wrong one is the risk:
 *
 *   * `session` — a token was minted. Adopt it, then go where the password sign
 *     in goes.
 *   * `linked` — the flow started while somebody was SIGNED IN, so the provider
 *     identity was attached to that account and NOTHING was minted. There is no
 *     token in that body, and reading one is how a client claims a session that
 *     does not exist.
 *   * `mfa_required` — a 2xx that is NOT a session. A second factor is owed, so
 *     this app is not signed in and has not finished signing anybody in.
 *   * a thrown `IdentityError` — a refusal: declined at the provider, forged
 *     state, an address another account already holds, an unreachable provider.
 *     Each gets a sentence and a way back; none of them is a dead end and none of
 *     them renders a status code.
 */
import { useEffect, useRef, useState } from "react";

import { Callout, LoadingState } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { IdentityError, type SocialCallbackInput, type SocialSignIn } from "@/lib/identity";
import { useNavigation } from "@/lib/navigation";
import { SOCIAL_PROVIDERS, socialStartPath } from "@/lib/social";

/**
 * The states this page renders, plus the failure.
 *
 * `signed_in` and `linked` both read as "done", for different reasons and with
 * different copy: a session means somebody is now signed in, a link means
 * nothing was minted and the person who started it is still signed in as they
 * were. Rendering one as the other would tell somebody they had just signed in
 * when they had not.
 */
type Landing =
  | { kind: "working" }
  | { kind: "signed_in" }
  | { kind: "linked" }
  | { kind: "second_factor" }
  | { kind: "failed"; sentence: string };

/** What the person sees while identity decides. */
const WORKING = "Finishing your sign in…";

/**
 * A refusal, and it says nothing about which refusal it was.
 *
 * The 400 the callback answers covers four different facts about a credential —
 * a declined consent, a state that was never issued, a state minted for another
 * provider, a code the provider has already retired — and the service
 * deliberately collapses them into one answer because each is attacker-
 * influenced and the difference between them is an oracle about the state
 * cookie. This screen keeps that collapse: one sentence for all four, naming
 * the one thing the person needs to know, which is that nothing was signed in.
 */
const DID_NOT_FINISH = "That sign-in did not finish here. Nothing was signed in.";

/**
 * What a person is told when a second factor is owed.
 *
 * It names the state and the way out, and it does NOT claim the sign-in worked
 * or claim that the password path asks for anything. This screen still cannot
 * FINISH an MFA login — the route exists in the forwarder's table now and the
 * password path's prompt drives it, but a social sign-in that lands on the
 * challenge has no form here to answer it with — so the honest sentence is the
 * one that says "you are not signed in" and points at the screen that exists.
 * See `HANDOFF-parlor-02-social-ui` for the finding.
 */
const SECOND_FACTOR =
  "This account has a second factor, so this sign-in is not finished and nobody is signed in. Sign in with your email and password instead.";

export function SocialCallbackScreen({
  provider,
  searchParams,
}: {
  provider: string;
  searchParams: Record<string, string>;
}) {
  const { client, adoptSession } = useAuth();
  const router = useNavigation();
  const [landing, setLanding] = useState<Landing>(() => landingFrom(searchParams));
  // The exchange happens exactly once per page load. See the header.
  const exchanged = useRef(false);

  useEffect(() => {
    if (landing.kind !== "working") return;
    if (exchanged.current) return;
    exchanged.current = true;

    void (async () => {
      try {
        const result = await client.completeSocialLogin(provider, callbackInput(searchParams));
        if (result.kind === "session") {
          // The token is written before the navigation, because the navigation is
          // what renders a header that reads it. Same order as the password path.
          adoptSession(result.session);
          setLanding({ kind: "signed_in" });
          await router.push("/");
          return;
        }
        setLanding(landingFromResult(result));
      } catch (thrown) {
        setLanding({ kind: "failed", sentence: failureSentence(thrown) });
      }
    })();
    // The dependency list is deliberately not empty and the latch above is
    // deliberately not the only guard: this runs once because `exchanged` says so,
    // not because the framework was trusted to call it once.
  }, [landing.kind, provider, searchParams, client, adoptSession, router]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          {landing.kind === "working" ? "Signing you in" : "Sign in"}
        </h1>

        {landing.kind === "working" ? <LoadingState label={WORKING} /> : null}

        {landing.kind === "signed_in" ? (
          <LoadingState label="Signed in. Taking you to your account…" />
        ) : null}

        {landing.kind === "linked" ? (
          <Callout title="That provider is now linked" tone="positive">
            <p>
              Your {provider} account is attached to the account you were already signed in to. You
              are still signed in as you were — no new session was created.
            </p>
          </Callout>
        ) : null}

        {landing.kind === "second_factor" ? (
          <Callout title="This sign-in is not finished" tone="caution">
            <p>{SECOND_FACTOR}</p>
          </Callout>
        ) : null}

        {landing.kind === "failed" ? (
          <Callout tone="critical">
            <p>{landing.sentence}</p>
          </Callout>
        ) : null}

        {/*
          The way back, on every state that is not a navigation already in
          progress. Two links and not one: somebody whose provider is not
          configured needs the sign-in screen, and somebody whose provider was
          unreachable needs to be able to start again with the same button they
          used the first time. Both are anchors, because both are navigations —
          and the second is the only thing on this page that can restart a flow.
        */}
        {landing.kind !== "working" && landing.kind !== "signed_in" ? (
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
            <a className="underline hover:no-underline" href="/login">
              Back to sign in
            </a>
            {knownProvider(provider) ? (
              <span className="text-muted">
                <span>or</span>{" "}
                <a className="underline hover:no-underline" href={socialStartPath(provider)}>
                  try {labelFor(provider)} again
                </a>
              </span>
            ) : null}
          </p>
        ) : null}

        {/*
          No JavaScript, no exchange, and no way for this page to say so by
          itself. A `<noscript>` is the only honest way to put a sentence on a
          page whose entire content is produced by script: without it the person
          reads "Signing you in" forever and concludes the app is broken.
        */}
        <noscript>
          <p className="text-sm text-muted">
            Finishing a sign in needs JavaScript. With it turned off, sign in with your email and
            password instead.
          </p>
        </noscript>
      </div>
    </main>
  );
}

/**
 * The first landing state, and it is decided by ONE thing: is there a `state`?
 *
 * Everything else — a decline at the provider, a state that was never issued, a
 * code the provider has retired — is identity's to answer, and this page asks.
 * The tempting shortcut is to short-circuit a provider's `error` locally, and it
 * is wrong twice over:
 *
 *   * It renders a caller-supplied parameter as a conclusion. `?error=` is
 *     something anybody can type into a URL, and "you stopped the sign-in" is a
 *     claim about what a person did. Whether the round trip was refused is
 *     identity's answer, made with the state cookie in hand — the CSRF check is
 *     the first thing that handler does, before it reads the error at all.
 *   * The state cookie is ONE-SHOT. `handleSocialCallback` clears both state
 *     cookies before it answers, whether or not the rest succeeds, so a page
 *     that never asks leaves that cookie in the browser until it expires — a
 *     longer window on the one cookie this flow authenticates itself with.
 *
 * Asking anyway costs one request whose only possible answer is a refusal, and
 * that is the point: the service clears its own cookie and the person gets the
 * service's verdict rather than this page's guess at it.
 *
 * `state`'s ABSENCE is the single case handled here, because there is genuinely
 * nothing to send. `completeSocialLogin` declares `state` as required rather
 * than as something a screen may invent, and a URL without one is not a round
 * trip — it is a person who typed the path, or a link scanner. That gets a
 * sentence and a way back rather than a request whose only answer is a refusal.
 */
function landingFrom(searchParams: Record<string, string>): Landing {
  if (!searchParams.state) {
    return { kind: "failed", sentence: DID_NOT_FINISH };
  }
  return { kind: "working" };
}

/**
 * The three parameters, and only those, in the shape the client declares.
 *
 * `error` is included when the provider sent one, so the SERVICE sees what the
 * provider said and not merely the fact that something was missing. A parameter
 * that was not supplied is not sent as an empty one: `?error=` is a different
 * answer from no `error` at all.
 */
function callbackInput(searchParams: Record<string, string>): SocialCallbackInput {
  const input: SocialCallbackInput = { state: searchParams.state };
  if (searchParams.code !== undefined) input.code = searchParams.code;
  if (searchParams.error !== undefined) input.error = searchParams.error;
  return input;
}

/**
 * The two answers that are 2xx and are NOT a session.
 *
 * Kept as its own function so the `switch` is exhaustive by construction: a
 * fourth arm added to `SocialSignIn` upstream is a type error here rather than a
 * `signed_in` for something that minted nothing. There is deliberately no
 * `default`, because a default here would be exactly that bug wearing a hat.
 */
function landingFromResult(result: SocialSignIn): Landing {
  switch (result.kind) {
    case "session":
      // Handled by the caller, which is the only place that knows about the
      // token. Unreachable from there.
      return { kind: "signed_in" };
    case "linked":
      return { kind: "linked" };
    case "mfa_required":
      return { kind: "second_factor" };
  }
}

/**
 * The sentence for a refusal.
 *
 * Never `thrown.message` and never the service's `detail`: those carry the
 * service's internals, and a provider's own error body has been known to carry
 * a client secret, a `redirect_uri` and an account identifier. The status is the
 * only thing read, and each of the three gets a sentence that is true for every
 * cause behind it.
 *
 * A 409 is the one case where the person is told what happened, and it is the
 * same reasoning as the 409 on registration: the person has just proved they
 * control this provider account, and "there is already an account for that
 * address" is the information they need in order to act. It names the state and
 * never an address.
 */
function failureSentence(thrown: unknown): string {
  if (!(thrown instanceof IdentityError)) {
    return "Something went wrong finishing the sign in. Nobody was signed in.";
  }
  if (thrown.status === 409) {
    return "There is already an account for the email address that provider reports. Sign in with that account instead.";
  }
  if (thrown.status === 502) {
    return "That provider could not be reached. Try again in a moment.";
  }
  return DID_NOT_FINISH;
}

/**
 * The provider's own name for itself, or "" when it is not one of ours.
 *
 * `SOCIAL_PROVIDERS` is the list this app OFFERS, not the list this app
 * accepts: the forwarder's provider segment is deliberately open (see
 * `SEGMENT_PATTERNS.provider`), so a callback can arrive naming anything. A
 * label reaches rendered copy only for a name on that list, and everything else
 * gets no provider name at all — which is why `knownProvider` exists rather than
 * a truthiness check on the label.
 */
function labelFor(provider: string): string {
  return SOCIAL_PROVIDERS.find((entry) => entry.id === provider)?.label ?? "";
}

/** True when the provider is one this app offers, so "try again" is honest. */
function knownProvider(provider: string): boolean {
  return SOCIAL_PROVIDERS.some((entry) => entry.id === provider);
}