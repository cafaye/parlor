import { Link } from "@tanstack/react-router";

import { EmailProvidersScreen } from "./email-providers-screen";

/**
 * `/email-providers` — the email-provider connections across the caller's
 * accounts.
 *
 * A server component, the split the accounts and settings pages use: the
 * heading and the orientation line are static, and only the list needs the
 * browser.
 *
 * The header's one substantive sentence is the boundary-6 statement, and it
 * is aimed at a reader rather than at an auditor: the credential a person
 * types on the connect screen is sealed to their box's public key before it
 * is stored, so this app holds an envelope it cannot open. That is the whole
 * of what the screen can honestly say about the credential, and it says it
 * here rather than leaving a reader to wonder.
 */
export default function EmailProvidersPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Cafaye</p>
        <h1 className="text-2xl font-semibold tracking-tight">Email providers</h1>
        <p className="text-sm text-muted">
          Where your mail goes, and the box each credential is sealed to. A stored
          credential is an envelope only your box can open — this app cannot read it,
          and never prints it.
        </p>
      </header>
      <EmailProvidersScreen />
    </main>
  );
}

/**
 * What a signed-out visitor is shown instead of a list.
 *
 * The same shape the boxes and accounts pages use: a static sentence, kept
 * out of the client screen so the screen carries no branch for a state it
 * cannot produce.
 */
export function SignedOut() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h2 className="text-base font-medium">Sign in to see your email providers</h2>
      <p className="mt-1 text-sm text-muted">
        Providers belong to accounts, so there is nothing to show until we know who you
        are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" to="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
