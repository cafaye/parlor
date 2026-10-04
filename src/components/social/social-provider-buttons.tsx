/**
 * The provider sign-in buttons.
 *
 * Two screens render this, in the same order, and the buttons are the SAME
 * buttons — one component, one list, one href — because a person who starts a
 * social sign-in from `/register` and gets sent to `/login` and back must find
 * the control in the same place with the same name.
 *
 * ---------------------------------------------------------------------------
 * WHY A LINK AND NOT A BUTTON, AND WHY NOT A `fetch`
 * ---------------------------------------------------------------------------
 * The start leg is a browser navigation and nothing else can be. `GET
 * /v1/auth/oauth/{provider}` answers a 302 to the provider and sets the
 * `__Host-oauth-state` cookie on that response; the browser has to FOLLOW it,
 * from its own address bar, carrying the cookie to this origin and not to the
 * provider. A `fetch` cannot navigate, and a `fetch` that resolved the 302 would
 * have to hand the provider's HTML back to a JavaScript caller — github.com
 * rendering a sign-in, in a screen, with no address bar and no way back.
 *
 * So it is an `<a href>` to this app's own origin. Not the router's `Link`: this
 * URL is not a route this app renders, it is the forwarder at `src/routes/v1/$`,
 * and a client-side navigation would ask the router for a route tree that does
 * not contain it. The router's absence is the reason `linkClasses` exists for
 * the `<a>` case, and `buttonClasses` (the same argument, one level up) for
 * this one: the control is button-shaped because it is a commit, and it is an
 * anchor because it goes somewhere.
 *
 * That is also why it is `secondary` and not `primary`. The password field is
 * this app's own way in, the primary action on both screens, and the provider
 * buttons are alternatives to it — a screen with three filled accent-coloured
 * commits and no hierarchy is a screen where nothing is primary.
 *
 * ---------------------------------------------------------------------------
 * WHY NO `startSocialLogin` CALL HAPPENS HERE
 * ---------------------------------------------------------------------------
 * `identity.ts` has `startSocialLogin`, and it is deliberately unused by this
 * component. It returns the ADDRESS TO GO TO rather than navigating, which is
 * correct for a caller that has to decide what to do with it — and it would mean
 * an extra same-origin round trip, a 302 the client cannot follow, and a
 * `window.location` assignment this file would rather not make, to learn an
 * address a link already knows. The forwarder relays the 302 itself; that is the
 * whole of the transport packet's contribution, and this component spends none
 * of it twice.
 */
import { buttonClasses } from "@/components/ui";
import { SOCIAL_PROVIDERS, socialStartPath } from "@/lib/social";

/**
 * One anchor per provider, stacked full width.
 *
 * `secondary` for the reason in the header, and `md` because these sit on a
 * page rather than in a table — the same size as the `Sign in` button they sit
 * beside, so the two ways in are the same size and neither is a control for
 * something more important than the other.
 *
 * `flex-col` rather than a row: on a `max-w-sm` card two buttons side by side
 * are 150px each, which is narrower than "Continue with Google" and starts
 * wrapping mid-sentence. Stacked, each is full width and the label is one line.
 */
export function SocialProviderButtons({ className }: { className?: string } = {}) {
  return (
    <nav aria-label="Sign in with a provider" className={className}>
      <ul className="flex list-none flex-col gap-2 p-0">
        {SOCIAL_PROVIDERS.map((provider) => (
          <li key={provider.id}>
            <a className={buttonClasses("secondary")} href={socialStartPath(provider.id)}>
              Continue with {provider.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}