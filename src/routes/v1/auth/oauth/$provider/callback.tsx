import { createFileRoute, useLocation } from "@tanstack/react-router";

import { GET as forwardGet } from "@/app/v1/[...path]/route";
import { SocialCallbackScreen } from "@/components/social/social-callback-screen";
import { searchParamsOf } from "@/lib/search-params";
import { isDocumentNavigation } from "@/lib/social";

/**
 * `/v1/auth/oauth/$provider/callback` — where the provider sends the browser.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROUTE HERE AND NOT A PAGE UNDER `src/app/`
 * ---------------------------------------------------------------------------
 * The forwarder at `/v1/$` already answers this URL, and it answers it with
 * identity's bytes: a 200, a JSON body, and the session cookie. That is correct
 * for a programmatic caller and useless for a person, who is standing in the
 * address bar looking at a token. So this route exists to take the ONE thing
 * the forwarder cannot do — render a document — out of its hands, and the
 * forwarder keeps everything else.
 *
 * The router ranks a literal-plus-parameter path above a splat, so this file
 * wins over `src/routes/v1/$.ts` for exactly this URL and loses nowhere else.
 * That is the property `src/router.test.tsx`'s sibling, the route-tree guard,
 * and the build both depend on: the two routes are siblings in the tree and the
 * specificity decides, not the order they were written.
 *
 * ---------------------------------------------------------------------------
 * THE TWO LEGS ARE NOT THE SAME SHAPE, AND THAT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * The START leg (`GET /v1/auth/oauth/{provider}`) is a 302 the browser follows.
 * The CALLBACK leg — this route — is a 200 with a body that identity will not
 * turn into a redirect. A design that assumed symmetry renders a page that
 * waits for a redirect that never comes, which looks exactly like a hung
 * network request.
 *
 * So this handler branches on what the REQUEST is, not on the path:
 *
 *   * a DOCUMENT NAVIGATION — `Accept: text/html`, which is what the provider's
 *     redirect produces and what a person pressing a button produces — is
 *     answered with this route's component. Nothing is forwarded. Identity does
 *     not see the exchange here.
 *   * anything ELSE — a `fetch`, an XHR, a link checker — is handed to the
 *     forwarder, unchanged. That is identity's own answer for the same URL, and
 *     `completeSocialLogin` in `src/lib/identity.ts` is its caller.
 *
 * The single delivery of the exchange is the property this shape buys. The
 * authorization code is spent by the one request identity sees: if the document
 * navigation ALSO reached identity, the page would then fetch the same URL to
 * finish the sign-in and the second attempt would fail on a spent code. The
 * document navigation not being a forwarder is therefore not an optimisation —
 * it is what makes the flow work at all, and `callback.test.ts` asserts it by
 * counting hops rather than by asserting on a rendered string.
 */
export const Route = createFileRoute("/v1/auth/oauth/$provider/callback")({
  head: () => ({ meta: [{ title: "Signing you in · parlor" }] }),
  server: {
    handlers: {
      GET: ({ request, params, next }) => {
        if (isDocumentNavigation(request)) {
          // Defer to the router's own document render. `next()` is the framework's
          // way of saying "this handler has no opinion about the response"; the
          // alternative is returning `undefined`, which — for a route that also
          // declares a component — would leave the chain with no response at all.
          return next();
        }
        // Delegated, not reimplemented. The forwarder owns the allow-list, the
        // cookie relay and the redirect decision; this route owns none of them,
        // and a copy of the three lines below would be a second place to forget
        // one of them.
        return forwardGet(request, {
          params: Promise.resolve({
            path: ["auth", "oauth", params.provider, "callback"],
          }),
        });
      },
    },
  },
  component: Callback,
});

function Callback() {
  const { provider } = Route.useParams();
  const { searchStr } = useLocation();

  return <SocialCallbackScreen provider={provider} searchParams={searchParamsOf(searchStr)} />;
}