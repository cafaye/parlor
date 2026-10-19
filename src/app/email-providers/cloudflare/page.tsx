import { Link } from "@tanstack/react-router";

import { CloudflareConnectScreen } from "./cloudflare-form";

/**
 * `/email-providers/cloudflare` — the connection form.
 *
 * A server component: the heading and orientation line are static, and the
 * form needs the browser. The one line that matters on the page is the
 * boundary-6 statement, and it is here rather than in the form because a
 * person decides whether to type a credential BEFORE they reach the
 * control.
 */
export default function CloudflareConnectPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Cafaye</p>
        <h1 className="text-2xl font-semibold tracking-tight">Connect Cloudflare Email</h1>
        <p className="text-sm text-muted">
          The credential is sealed to your box's public key on the way in. We store an
          envelope we cannot open, and nothing on this site can show the credential back
          to you.
        </p>
      </header>
      <CloudflareConnectScreen />
    </main>
  );
}

/**
 * What a signed-out visitor is shown instead of the form.
 *
 * A credential typed by a stranger is a credential sealed to nobody, so
 * this state is static and carries no branch inside the form screen.
 */
export function SignedOut() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h2 className="text-base font-medium">Sign in to connect a provider</h2>
      <p className="mt-1 text-sm text-muted">
        A connection belongs to an account's box, so there is nothing to connect until we
        know who you are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" to="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
