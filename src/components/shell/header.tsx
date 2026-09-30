"use client";

/**
 * The shell header: brand on the left, session on the right.
 *
 * This is the whole session-aware shell for now. It renders three states and
 * the third one is deliberate — while a stored token is being exchanged, it
 * renders neither the signed-in nor the signed-out controls, because showing
 * "Sign in" to someone who is signed in is the kind of wrong that costs a
 * support ticket.
 */

import Link from "next/link";

import { useAuth, type SessionState } from "@/lib/auth";
import { Button } from "@/components/ui";

export function ShellHeader() {
  const { session, logout, pending } = useAuth();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link className="font-mono text-sm tracking-[0.2em] uppercase" href="/">
          parlor
        </Link>
        <SessionControls
          status={session.status}
          email={session.status === "authed" ? session.user.email : null}
          pending={pending}
          onSignOut={() => {
            // The local half of a sign out always happens, so there is no
            // failure left to put in front of anyone. Swallowing it here is
            // the difference between a quiet console and an unhandled rejection
            // on every service hiccup.
            void logout().catch(() => undefined);
          }}
        />
      </div>
    </header>
  );
}

function SessionControls({
  status,
  email,
  pending,
  onSignOut,
}: {
  status: SessionState["status"];
  email: string | null;
  pending: boolean;
  onSignOut: () => void;
}) {
  // Neither state, while a stored token is being exchanged. Showing "Sign in"
  // to someone who is signed in is the kind of wrong that costs a ticket.
  if (status === "loading") return null;

  if (email) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">{email}</span>
        <Button aria-busy={pending} disabled={pending} onClick={onSignOut} variant="secondary">
          Sign out
        </Button>
      </div>
    );
  }

  // A signed-out visitor is the common case on a template, so it is the one
  // that gets the two ways forward.
  return (
    <nav className="flex items-center gap-3">
      <Link className="text-sm text-muted hover:text-foreground" href="/login">
        Sign in
      </Link>
      <Link
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
        href="/register"
      >
        Create account
      </Link>
    </nav>
  );
}
