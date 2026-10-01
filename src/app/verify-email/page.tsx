import type { Metadata } from "next";
import Link from "next/link";

import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = {
  title: "Verify your email · parlor",
};

/**
 * `/verify-email` — asking for a verification link, and asking again.
 *
 * A server component that renders the heading and hands the form to the client,
 * for the same reason `/forgot-password` does: the form needs interactivity and
 * the page does not.
 *
 * **IT READS NO SESSION, and that is why the form is here rather than a banner.**
 * `GET /v1/email-verification` would let this page say "your address is not
 * confirmed" to a signed-in visitor — but that route answers for the caller's
 * own address only, so a screen that used it could not be reached at all by the
 * person who most needs it: somebody who signed up, closed the tab, and has
 * never been signed in since. The service's own route is anonymous for the same
 * reason. So this page asks for an address, and the answer it can give is the
 * same one for everybody.
 *
 * The anti-enumeration argument lives in `verify-email-form.tsx` rather than
 * here, because this file renders no responses — it is the client screen that
 * decides what a person is told, and that is where the rule is enforceable.
 */
export default function VerifyEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
          <p className="text-sm text-muted">
            Tell us the address on the account and we will send a link to verify it.
          </p>
        </div>
        <VerifyEmailForm />
        <p className="text-center text-sm text-muted">
          <Link className="underline hover:no-underline" href="/login">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}