import { Link } from "@tanstack/react-router";

import { SocialProviderButtons } from "@/components/social/social-provider-buttons";

import { LoginForm, PASSWORD_CHANGED_PARAM } from "./login-form";

/**
 * `/login` — the sign in screen.
 *
 * A page that renders the heading and hands the form to an interactive screen.
 * It reads no session of its own: the session lives in the token store and the
 * query cache (see `src/lib/auth.tsx`), and duplicating that read here would
 * give the shell two answers to the same question.
 *
 * It DOES read one query parameter, and only to decide whether to say the
 * password was just changed. `/reset-password` redirects here after a successful
 * reset — the service's 204 mints no session, so signing in again is the only
 * route forward — and that redirect needs an answer on arrival. The parameter's
 * PRESENCE is the whole signal: its value is never read, so nothing a person can
 * type into a URL changes a word on this page.
 *
 * `searchParams` is a plain object, not a Promise, because the route that
 * renders this reads it off a location that is already resolved — there is no
 * framework handing out a promise here and nothing to await. It is also
 * optional, so a test or a caller that has no query to pass does not have to
 * invent one.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = searchParams ?? {};
  const passwordChanged = Object.hasOwn(params, PASSWORD_CHANGED_PARAM);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted">
            No account yet?{" "}
            <Link className="underline hover:no-underline" to="/register">
              Create account
            </Link>
          </p>
        </div>
        {/* The provider way in. Rendered UNCONDITIONALLY and above the form,
            for the same reason the "forgot your password" link below is: a
            control that appeared only after something else had happened would be
            reporting something. This one reports nothing — it is a link to the
            forwarder, and whether it leads anywhere is the service's answer. */}
        <SocialProviderButtons />
        <LoginForm passwordChanged={passwordChanged} />
        {/*
          The way in for somebody who signed up, closed the tab, and never
          verified. It is a link rather than a banner on purpose: a banner that
          said "your address is not verified" would have to read
          `GET /v1/email-verification`, which answers for the CALLER's own address
          only — so the one person who most needs to be told would never see it,
          because they are the one who is not signed in. A plain link is reachable
          by anybody and says nothing about whether the address behind it exists.

          Rendered unconditionally, like the "forgot your password" link inside the
          form: a control that appeared only after a failed attempt would be
          reporting something about the address, and this is the screen that must
          never do that.
        */}
        <p className="text-center text-sm text-muted">
          <Link className="underline hover:no-underline" to="/verify-email">
            Need to verify your email?
          </Link>
        </p>
      </div>
    </main>
  );
}
