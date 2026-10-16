/**
 * Billing's bearer, minted rather than forwarded.
 *
 * ## Why this file exists
 *
 * The browser sends identity's OPAQUE SESSION TOKEN, and billing does not speak
 * that dialect: its verifier reads an RS256 token off identity's published JWKS,
 * with a singular `account_id` claim. Forwarding the session token answers 401
 * on every billing route — measured on the whole local stack (2026-10-16), where
 * the plans screen showed its degrade state and billing's log carried the 401.
 *
 * Identity's `/v1/session/tokens` closes that gap: the session in, one
 * account-scoped token out. This module is the caller that does the exchange,
 * and it exists as its own file because the exchange is TWO calls and a failure
 * vocabulary, neither of which belongs inline in the forwarder.
 *
 * ## The acting account, said out loud
 *
 * The exchange names an account, and this app names the caller's PERSONAL
 * account. It is a deliberate choice rather than a default nobody wrote: a
 * personal account is one identity mints for every user, so the choice is total
 * (a caller has exactly one personal account) and it is the account a solo
 * subscription belongs to. A TEAM-ACCOUNT SELECTOR — the screens asking which
 * account to bill — is the next step, and when it lands it names the chosen
 * account in this same request; the membership check inside identity is what
 * makes that safe, so nothing here has to learn which accounts exist. Until
 * then the choice is stated here rather than hidden in `accounts[0]`, which is
 * the guess the exchange endpoint exists to make impossible.
 *
 * ## Why there is no cache
 *
 * The exchange is two local calls and the token is live for fifteen minutes,
 * which is the whole of the performance story. A cache — even keyed on the
 * session and bounded by the token's own expiry — is a credential that outlives
 * the session that minted it, because a revoked session does not end a token
 * already in someone's map. Billing is money; the cost of being sure is two
 * local calls per request.
 */

import type { Account } from "@/lib/identity";

/**
 * The audience the exchange is asked for.
 *
 * `billing` is billing's own `BILLING_IDENTITY_AUDIENCE`, and identity does not
 * pin a list — it validates the audience's SHAPE and each receiver validates its
 * own. The two are one claim in two files, and the tests on both sides hold it.
 */
export const BILLING_TOKEN_AUDIENCE = "billing";

/** Why the exchange does not end with a token, in the words a human reads. */
export type ExchangeFailure =
  | "identity does not answer"
  | "the caller is not signed in"
  | "the caller's session is no longer valid"
  | "the caller has no personal account to act in"
  | "identity's answer was not the shape this app expects";

export type Exchange =
  | { status: "minted"; token: string }
  /**
   * Forward anyway. The caller's own token crosses, unchanged, so billing
   * answers its own 401: no credential from this app is invented, and a
   * signed-out screen says "signed out" rather than "something broke".
   */
  | { status: "forward_untouched"; reason: ExchangeFailure }
  /** This app cannot get a token, and the reason is this app's, not the caller's. */
  | { status: "failed"; reason: ExchangeFailure }
  /**
   * The caller named an account it cannot act in — or one that does not exist;
   * identity's 404 is one sentence for both, on D33's terms (`absence, not
   * refusal`), and this outcome carries that sentence through rather than
   * inventing a second one.
   */
  | { status: "no_such_account" };

/**
 * True for a list whose entries are accounts at all.
 *
 * Identity's answer is trusted here for its SHAPE and nothing else: the ids this
 * app reads are ones identity minted, and an entry this shape rejects is an
 * answer this app does not understand rather than an account it may pick from.
 */
function isAccountList(value: unknown): value is Account[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Account).id === "string" &&
        typeof (entry as Account).personal === "boolean",
    )
  );
}

/**
 * Exchanges the caller's session for a token scoped to one account.
 *
 * `authorization` is the caller's own header, carried through verbatim: this
 * app proves nothing new about anyone, it asks identity to re-state the same
 * fact in a dialect one service accepts.
 *
 * `selectedAccountId` is the account the caller CHOSE — the team-account
 * selector's answer, named by the browser and verified by identity before
 * anything is signed. When it is absent the caller's personal account is used,
 * which is the solo-buyer default this app has always had. When it is present
 * there is ONE call instead of two, and that is not an optimization detail:
 * identity already resolves the id against the caller's own memberships and
 * refuses a stranger's with the same sentence it refuses a nonexistent one,
 * so the account list this function fetches for the default case is not
 * needed to answer "is this the caller's account".
 */
export async function mintBillingToken(
  identityUrl: string,
  authorization: string | null,
  fetchImpl: typeof fetch,
  selectedAccountId?: string | null,
): Promise<Exchange> {
  if (authorization === null || authorization === "") {
    return { status: "forward_untouched", reason: "the caller is not signed in" };
  }

  let accountId: string | undefined;
  if (selectedAccountId !== undefined && selectedAccountId !== null && selectedAccountId !== "") {
    accountId = selectedAccountId;
  } else {
    // Which account the caller acts in when nothing was chosen. One call, and
    // it is also where an expired or revoked session answers 401 — the one
    // refusal that reaches this function before anything is minted.
    const accounts = await call("GET", `${identityUrl}/v1/accounts`, authorization, null, fetchImpl);
    if (accounts.outcome === "refused") {
      return { status: "forward_untouched", reason: "the caller's session is no longer valid" };
    }
    if (accounts.outcome !== "ok" || !isAccountList(accounts.body)) {
      return {
        status: "failed",
        reason: accounts.outcome === "ok" ? "identity's answer was not the shape this app expects" : "identity does not answer",
      };
    }

    const personal = accounts.body.find((account) => account.personal);
    if (personal === undefined) {
      return { status: "failed", reason: "the caller has no personal account to act in" };
    }
    accountId = personal.id;
  }

  const minted = await call(
    "POST",
    `${identityUrl}/v1/session/tokens`,
    authorization,
    { account_id: accountId, audience: BILLING_TOKEN_AUDIENCE },
    fetchImpl,
  );
  if (minted.outcome === "refused") {
    return { status: "forward_untouched", reason: "the caller's session is no longer valid" };
  }
  if (minted.outcome === "absent") {
    // The caller named an account it is not a member of (or one that does not
    // exist — identity answers both the same way, deliberately), and that call
    // passing through the 404 on the STATUS rather than folding it into "this
    // app cannot mint" is the whole distinction: 502 is this app's fault and
    // this is the caller's choice.
    return { status: "no_such_account" };
  }
  if (minted.outcome !== "ok") {
    return { status: "failed", reason: "identity does not answer" };
  }
  const token = (minted.body as { token?: unknown })?.token;
  if (typeof token !== "string" || token === "") {
    return { status: "failed", reason: "identity's answer was not the shape this app expects" };
  }

  return { status: "minted", token };
}

/**
 * One call to identity, with the caller's credential carried across unchanged.
 *
 * `refused` is identity's own 401/403 — the caller's credential is the thing
 * that was refused, and a caller whose session expired is a 401 from billing
 * rather than a 502 from this app. Everything else that is not a 2xx is an
 * operational fact: identity is configured away, down, or answering something
 * other than what this app asked it for.
 */
async function call(
  method: "GET" | "POST",
  url: string,
  authorization: string,
  body: { account_id: string; audience: string } | null,
  fetchImpl: typeof fetch,
): Promise<
  | { outcome: "ok"; body: unknown }
  | { outcome: "refused" }
  | { outcome: "absent" }
  | { outcome: "error" }
> {
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body === null ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 || response.status === 403) return { outcome: "refused" };
    // A 404 from the exchange is the ONLY absence this function passes
    // through, and it means one thing: the account the caller named is not one
    // it can act in. Every other non-2xx is an operational fact about
    // identity, not a fact about the caller's choice.
    if (response.status === 404) return { outcome: "absent" };
    if (!response.ok) return { outcome: "error" };

    const text = await response.text();
    try {
      return { outcome: "ok", body: JSON.parse(text) as unknown };
    } catch {
      return { outcome: "error" };
    }
  } catch {
    return { outcome: "error" };
  }
}
