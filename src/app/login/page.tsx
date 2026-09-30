import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "./login-form";

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
 */
export default function LoginPage() {
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
        <LoginForm />
      </div>
    </main>
  );
}
