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
 * The navigation sits outside that conditional on purpose. Accounts and
 * settings belong to one person, so a signed-out visitor is offered the
 * sign-in screen rather than an empty page — which is why they only appear
 * once there is a session. Billing is frozen for launch and has no entry
 * here at all; `/verify-email` is deliberately NOT linked either — it is the
 * anonymous surface, and a signed-in person who wanted it has the resend on
 * this page instead.
 */

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAuth, type SessionState } from "@/lib/auth";
import { useOperator } from "@/lib/operator-context";
import { Button } from "@/components/ui";

export function ShellHeader() {
  const { session, logout, pending } = useAuth();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link className="font-mono text-sm tracking-[0.2em] uppercase" to="/">
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
      {authed ? <NavLink href="/accounts">Accounts</NavLink> : null}
      {/* Same rule as Accounts and for the same reason: every control on it
          belongs to one person, so a signed-out visitor is offered the sign-in
          screen rather than an empty page. `/verify-email` is deliberately NOT
          linked here — it is the anonymous surface, and a signed-in person who
          wanted it has the resend on this page instead. */}
      {authed ? <NavLink href="/settings">Settings</NavLink> : null}
      {authed ? <OperatorNavLink /> : null}
    </>
  );
}

/**
 * The system-admin entry: rendered only after a server-verified staff read.
 *
 * The link is hidden until `operator/me` answers `staff: true` for THIS
 * session — hiding is not authorization (the `/admin` screen re-checks, and
 * identity enforces 401/403 on every call), but showing it to everyone would
 * advertise a surface most sessions are refused at. A pending or failed gate
 * renders nothing rather than a disabled link: a control that cannot work is
 * worse than no control.
 */
function OperatorNavLink() {
  const { token } = useAuth();
  const operator = useOperator();
  const gate = useQuery({
    queryKey: ["operator", "me", token],
    queryFn: () => operator.me(token ?? ""),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  if (gate.data?.user.staff !== true) return null;
  return <NavLink href="/admin">System admin</NavLink>;
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link className="text-sm text-muted hover:text-foreground" to={href}>
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
      <Link className="text-sm text-muted hover:text-foreground" to="/login">
        Sign in
      </Link>
      <Link
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
        to="/register"
      >
        Create account
      </Link>
    </div>
  );
}
