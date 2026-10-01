import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password · parlor",
};

/**
 * `/forgot-password` — asking for a reset link.
 *
 * A server component that renders the heading and hands the form to the client,
 * for the same reason `/login` does: the form needs interactivity and the page
 * does not. It reads no session, so a signed-in visitor asking for a reset sees
 * the same screen as one who is not.
 *
 * The anti-enumeration argument lives in `forgot-password-form.tsx` rather than
 * here, because this file renders no responses at all — it is the client screen
 * that decides what a person is told, and that is where the rule is enforceable.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="text-sm text-muted">
            Tell us the address on the account and we will send a link to choose a new
            password.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-sm text-muted">
          Remembered it?{" "}
          <Link className="underline hover:no-underline" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}