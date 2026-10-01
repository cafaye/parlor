"use client";

/**
 * The shell header: brand, navigation, session.
 *
 * Two concerns that used to be one. The session controls render three states
 * and the third is deliberate — while a stored token is being exchanged, they
 * render neither the signed-in nor the signed-out controls, because showing
 * "Sign in" to someone who is signed in is the kind of wrong that costs a
 * support ticket.
 *
 * The navigation sits outside that conditional on purpose. billing's plan
 * catalogue is the one surface in this app that needs no account, so hiding it
 * behind a session would hide the only thing a prospective customer can look
 * at. Accounts, on the other hand, is a dead end without one — it renders "Sign
 * in to see your accounts" — so it only appears once there is a session.
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

        <nav aria-label="Main" className="flex items-center gap-4">
          <HeaderNav authed={session.status === "authed"} />
          <SessionControls
            status={session.status}
            email={session.status === "authed" ? session.user.email : null}
            pending={pending}
            onSignOut={() => {
              // The local half of a sign out always happens, so there is no
              // failure left to put in front of anyone. Swallowing it here is
              // the difference between a quiet console and an unhandled
              // rejection on every service hiccup.
              void logout().catch(() => undefined);
            }}
          />
        </nav>
      </div>
    </header>
  );
}

function HeaderNav({ authed }: { authed: boolean }) {
  return (
    <>
      <NavLink href="/billing/plans">Plans</NavLink>
      {authed ? <NavLink href="/accounts">Accounts</NavLink> : null}
    </>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link className="text-sm text-muted hover:text-foreground" href={href}>
      {children}
    </Link>
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
  // over a signed-in reload is the wrong answer to a question that has not been
  // answered yet.
  if (status === "loading") return null;

  if (email) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted sm:inline">{email}</span>
        <Button aria-busy={pending} busy={pending} disabled={pending} onClick={onSignOut} variant="secondary">
          Sign out
        </Button>
      </div>
    );
  }

  // A signed-out visitor is the common case on a template, so it is the one
  // that gets the two ways forward.
  return (
    <div className="flex items-center gap-3">
      <Link className="text-sm text-muted hover:text-foreground" href="/login">
        Sign in
      </Link>
      <Link
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
        href="/register"
      >
        Create account
      </Link>
    </div>
  );
}
