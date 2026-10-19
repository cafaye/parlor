import { Link } from "@tanstack/react-router";

import { BoxesScreen } from "./boxes-screen";
import { TwoPaths } from "./two-paths";

/**
 * `/box` — the Cafaye Box surface, and the front door it is.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE LEADS WITH
 * ---------------------------------------------------------------------------
 * The 2026-10-15 decision settled the order: the two paths come first — hosted
 * in thirty seconds, or a box you own — and the boxes list sits under them.
 * The list is still here and still doing its job, but its job changed: it is
 * the visual confirmation for somebody who already enrolled a box, not the
 * first thing a visitor meets. A signed-out visitor used to open this route on
 * "sign in to see your boxes", which is the dashboard framing, and it is the
 * reason the paths are above the list and are rendered to everyone.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE, AND WHY
 * ---------------------------------------------------------------------------
 * The install script. `/box/install` serves kit's vendored bytes and is linked
 * from the paths above; this file is a page and that one is a byte endpoint.
 * A copy of the command here is a copy of a front door, and the front door has
 * one address.
 */

export default function BoxesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Cafaye</p>
        <h1 className="text-2xl font-semibold tracking-tight">Cafaye Box</h1>
        <p className="text-sm text-muted">
          The substrate, on a box. Start in thirty seconds on ours, or install it on one you
          own — the commands for both are below.
        </p>
      </header>
      <TwoPaths />
      <BoxesSection />
    </main>
  );
}

/**
 * The boxes list, under the paths.
 *
 * It keeps the composition the operator screens use — a heading, a line of
 * orientation, a hairline — and it keeps every state the screen already had:
 * the list, the empty answer, the not-configured note, the load failure, and
 * the signed-out panel below. The one thing that changed is its place on the
 * page, and the section heading that says what it is now: confirmation, not
 * the front door.
 */
function BoxesSection() {
  return (
    <section aria-labelledby="your-boxes">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <h2 className="text-lg font-semibold tracking-tight" id="your-boxes">
          Your boxes
        </h2>
        <p className="text-sm text-muted">
          The boxes your accounts have enrolled, and the install phase each one last reported.
          This page is the visual confirmation — the CLI is the front door.
        </p>
      </div>
      <div className="mt-6">
        <BoxesScreen />
      </div>
    </section>
  );
}

/**
 * What a signed-out visitor is shown instead of a list.
 *
 * Kept here rather than in the client screen, the same reason the accounts
 * page keeps its own: the sentence is static, and the screen carries no
 * branch for a state it cannot produce. It sits under the two paths now, so
 * the heading takes the rung below them: a signed-out visitor has already had
 * the answer to "what is this" from the top of the page.
 */
export function SignedOut() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-6">
      <h3 className="text-base font-medium">Sign in to see your boxes</h3>
      <p className="mt-1 text-sm text-muted">
        Boxes belong to accounts, so there is nothing to show until we know who you are.
      </p>
      <p className="mt-4 text-sm">
        <Link className="font-medium underline underline-offset-2 hover:no-underline" to="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
