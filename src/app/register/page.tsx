import { Link } from "@tanstack/react-router";

import { SocialProviderButtons } from "@/components/social/social-provider-buttons";

import { RegisterForm } from "./register-form";


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
            <Link className="underline hover:no-underline" to="/login">
              Sign in
            </Link>
          </p>
        </div>
        {/*
          The provider way in, ABOVE the form and below the heading.

          Above because it is the shorter path for somebody who already has a
          provider account and came here because they were told to create an
          account — and above because a screen that leads with the email field
          says "type your address" before it has said "you do not have to".
        */}
        <SocialProviderButtons />
        <RegisterForm />
      </div>
    </main>
  );
}
