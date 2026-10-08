import { Link } from "@tanstack/react-router";

import { Surface } from "@/components/ui";
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
        {/* The header block: eyebrow, heading, supporting line — above the
            card, not inside it. Same composition as `/login`, so the two auth
            screens read as one product. The eyebrow adds no copy: "parlor" is
            already on the page. The heading steps up one rung and no further. */}
        <div className="flex flex-col gap-2 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">parlor</p>
          <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted">
            Already have one?{" "}
            <Link className="underline hover:no-underline" to="/login">
              Sign in
            </Link>
          </p>
        </div>
        {/* The card: the way in sits on the system's raised surface. Order
            inside is unchanged — provider buttons above the form. */}
        <Surface className="flex flex-col gap-6">
          {/*
            The provider way in, ABOVE the form and below the heading.

            Above because it is the shorter path for somebody who already has a
            provider account and came here because they were told to create an
            account — and above because a screen that leads with the email field
            says "type your address" before it has said "you do not have to".
          */}
          <SocialProviderButtons />
          <RegisterForm />
        </Surface>
      </div>
    </main>
  );
}
