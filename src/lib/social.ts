/**
 * The social sign-in surface, as this app spells it.
 *
 * Three things live here and nothing else: the provider list the screens offer,
 * the path that starts a flow, and the one question the callback route asks
 * about an incoming request. The screens, the callback screen and the route all
 * read them from here, so "which providers do we offer" and "where does the
 * start leg live" have one answer each.
 *
 * ---------------------------------------------------------------------------
 * WHY A CONSTANT AND NOT A DISCOVERY CALL
 * ---------------------------------------------------------------------------
 * The obvious design is to ask identity which providers this deployment has
 * configured, and identity has no such route: `registerSocialRoutes` mounts a
 * PAIR of routes and nothing else, there is no index and no `GET
 * /v1/auth/oauth`, and its `Social` interface offers `Lookup(provider)` and
 * `RedirectBase()` and no enumeration. So there is nothing to ask, and a
 * configuration list in this app has to be a list somebody wrote down.
 *
 * The two below are the two the contract names (`identity/openapi/v1.yaml`'s
 * `provider` enum). This app's copy deliberately does NOT narrow the segment
 * itself — `SEGMENT_PATTERNS.provider` in `src/lib/upstream.ts` forwards any
 * slug, and the test "asks identity about a provider this app does not narrow to
 * the document's enum" holds that line — so a deployment adding a third provider
 * edits this array and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHY NAMING A PROVIDER IN THE UI IS NOT AN ENUMERATION ORACLE
 * ---------------------------------------------------------------------------
 * The service is careful: `Lookup` answers 404 for a provider it has no
 * credentials for and for a name that does not exist, so "not one of ours" and
 * "not configured here" stay indistinguishable to a caller. That defence is not
 * weakened by a button, and the reason is worth stating because it looks like
 * the one place it could be:
 *
 *   * The forwarder already answers `GET /v1/auth/oauth/{name}` for ANY slug —
 *     a 302 when the provider is configured, a 404 when it is not. Somebody
 *     enumerating this deployment's configuration does not need a button; they
 *     fetch one URL per name and read the status. A button changes nothing they
 *     cannot already see, so hiding names from the page buys no privacy.
 *   * What a button does say is what THIS APP offers, which is a property of
 *     this repository's source rather than of any deployment's secrets.
 *
 * The cost that IS real: on a deployment configured for one provider, the other
 * button leads to a 404 that the forwarder renders as problem+json, because a
 * start leg for an unconfigured provider is refused before any address is
 * contacted and there is no page here to catch it. That is honest (the same
 * answer a prober gets) and it is ugly. The alternative — a start leg that
 * rendered a screen on failure — would need this route to own the start leg
 * too, which is a larger change than this packet and is left as a finding.
 */

/**
 * One provider this app offers a button for.
 *
 * `id` is the PATH SEGMENT, so it is what goes into the URL; `label` is what a
 * person reads. The two are separate because the segment is identity's
 * vocabulary (lower case, hyphenated, matched by `SEGMENT_PATTERNS.provider`)
 * and the label is this app's.
 */
export type SocialProviderButton = {
  readonly id: string;
  readonly label: string;
};

/**
 * The providers the screens offer, in the order they are rendered.
 *
 * Order is the document's own order reversed to reading order and nothing more
 * important than that. Both screens render the same list in the same order so
 * that "Continue with GitHub" is in the same place on `/login` and `/register`:
 * a control that moves between the two screens of one flow reads as two
 * different controls.
 */
export const SOCIAL_PROVIDERS: readonly SocialProviderButton[] = [
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
];

/**
 * The path that STARTS a social sign-in, on this app's own origin.
 *
 * A path and not a full URL on purpose. This origin is the whole reason the
 * flow works: the forwarder relays the request to identity, identity answers a
 * 302 to the provider AND sets the `__Host-oauth-state` cookie on that same
 * response, and the cookie is set on the origin the button was pressed on. A
 * URL built from `window.location` would be the same origin in production and
 * a portability bug in a test.
 *
 * The provider is encoded because it is a PATH SEGMENT and this is the one
 * place a caller's string reaches a URL. The shape check downstream is the real
 * guard; the encoding is what stops `../google` from being a path before it
 * ever gets there.
 */
export function socialStartPath(provider: string): string {
  return `/v1/auth/oauth/${encodeURIComponent(provider)}`;
}

/**
 * The path the PROVIDER sends the browser back to, for one provider.
 *
 * It is built from `socialStartPath` rather than written out, because the two
 * legs are one path with `/callback` on the end and a route table that spelled
 * them separately would eventually spell them differently.
 *
 * This app does not LINK a browser to this path — the provider does, from
 * whatever `redirect_uri` identity was configured with, and that address has to
 * be this origin or the state cookie is not in scope when the callback arrives.
 * See `HANDOFF-social-parlor-01-collision.md`, "redirect_uri is a deployment
 * fact nobody has written down".
 */
export function socialCallbackPath(provider: string): string {
  return `${socialStartPath(provider)}/callback`;
}

/**
 * Whether an incoming request is a BROWSER NAVIGATION rather than a programmatic
 * one, and therefore whether it should be answered with a page.
 *
 * The test is `Accept` naming `text/html`, and the whole arrangement rests on
 * that being true of exactly the requests it means:
 *
 *   * A top-level navigation or an iframe load — which is what the start leg's
 *     302 `Location` produces, and what the provider's own redirect produces
 *     when it sends the browser back — sends
 *     `Accept: text/html,application/xhtml+xml,…`. Nobody has ever written a
 *     browser that navigates without saying so.
 *   * A programmatic request does not. `fetch()` sends a wildcard media range
 *     unless told otherwise, and the one caller in this app — `completeSocialLogin` in
 *     `src/lib/identity.ts` — sends
 *     `Accept: application/json, application/problem+json` on purpose, because
 *     it is going to parse the body.
 *
 * So the split needs no allow-list of paths, no separate URL and no second
 * route: the same URL answers a document with a page and a fetch with identity's
 * bytes, which is the asymmetry the callback needs and the one the two legs of
 * the flow do not share (the start leg IS a redirect, and is answered by the
 * forwarder alone).
 *
 * `Sec-Fetch-Dest` would be the sharper signal and is deliberately not used:
 * it is not sent by every browser, it is not in
 * `FORWARDED_REQUEST_HEADERS` (so it would be a signal this app reads and
 * identity never sees), and a check that only some clients satisfy is a check
 * that silently degrades to "everything is programmatic" — a JSON blob for the
 * one person who actually pressed the button.
 */
export function isDocumentNavigation(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}