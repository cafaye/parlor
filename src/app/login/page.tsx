import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm, PASSWORD_CHANGED_PARAM } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · parlor",
};

/**
 * `/login` — the sign in screen.
 *
 * A server component that renders the heading and hands the form to the client.
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
 * `searchParams` is typed explicitly rather than with Next 16's generated
 * `PageProps`, which only exists after `next build` has written `.next/types`
 * and `npm run typecheck` has to pass on a fresh clone. It is also optional, so
 * a test or a caller that has no query to pass does not have to invent one.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const passwordChanged = Object.hasOwn(params, PASSWORD_CHANGED_PARAM);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted">
            No account yet?{" "}
            <Link className="underline hover:no-underline" href="/register">
              Create account
            </Link>
          </p>
        </div>
        <LoginForm passwordChanged={passwordChanged} />
      </div>
    </main>
  );
}
