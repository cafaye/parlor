import type { Metadata } from "next";
import Link from "next/link";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create an account · parlor",
};

/**
 * `/register` — the account creation screen.
 *
 * A server component that renders the shell's own heading and hands the form to
 * the client. No data fetching here: identity is a separate service, reached
 * from the browser, not through this process.
 */
export default function RegisterPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted">
            Already have one?{" "}
            <Link className="underline hover:no-underline" href="/login">
              Sign in
            </Link>
          </p>
        </div>
        <RegisterForm />
      </div>
    </main>
  );
}
