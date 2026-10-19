"use client";

import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { Button, linkClasses } from "@/components/ui";

/**
 * A command a person copies off this page.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A FOURTH LOCAL COPY AND NOT A COMPONENT IN `ui/`
 * ---------------------------------------------------------------------------
 * The house already has this affordance three times over — the MFA secret in
 * `settings/mfa-section.tsx`, the release approval in
 * `releases/$releaseId/release-screen.tsx`, and the DNS record line in
 * `email-providers/cloudflare/dns/dns-records-screen.tsx` — and in all three it
 * is a local `CopyButton` beside a `<code>` strip rather than a export from
 * the design system. This is that same pattern in a fourth place, on purpose:
 * `docs/design-system.md`'s "what is deliberately not here" is the position
 * that the system ships what it needs rather than everything, and lifting this
 * into `ui/` would be a shared component whose four callers disagree about
 * their labels, their confirmation and their layout. When they agree, it moves.
 * What is NOT re-decided here is the part that has to hold everywhere: the
 * optional-chained clipboard API, the label that never renames the control
 * away from its work, and a `<code>` that stays selectable and readable.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TEXT IS STILL TEXT
 * ---------------------------------------------------------------------------
 * The command renders as real text inside a `<code>`, so it can be selected,
 * read aloud, and copied the ordinary way. The button is the convenience on
 * top of that, never the only path — which is also why a clipboard that
 * refuses is not an error: the sentence is still on the screen.
 */

/**
 * One command, with the copy affordance beside it.
 *
 * `href` makes the command itself a link, which is what the install front
 * door wants: `curl … /box/install | bash` is both the thing you copy and the
 * thing you visit to read what it downloads. The command stays the accessible
 * name either way, so a link named after the command it runs is a link a
 * person can predict.
 */
export function CommandLine({
  command,
  copyLabel,
  href,
}: {
  command: string;
  /** What the copy button says it is copying, for its accessible name. */
  copyLabel: string;
  href?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface-sunken px-3 py-2">
      <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
        {href === undefined ? (
          command
        ) : (
          <Link className={linkClasses} to={href}>
            {command}
          </Link>
        )}
      </code>
      <CopyButton command={command} label={copyLabel} />
    </div>
  );
}

/**
 * The copy button, in the house's shape.
 *
 * The async clipboard API behind an optional chain, because a non-secure
 * context has no `navigator.clipboard` and a button that throws on click is
 * worse than one that does nothing. A refused write is caught for the same
 * reason: the confirmation must only appear when the text is really on the
 * clipboard, so a failure leaves the label at "Copy" rather than claiming
 * otherwise.
 *
 * The visible label stays "Copy"; the command is carried in the accessible
 * name. A page with four of these has four controls called "Copy" otherwise,
 * and a person navigating by name cannot tell them apart. The name starts
 * with the visible word, so it still satisfies label-in-name.
 */
function CopyButton({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      aria-label={`Copy ${label}`}
      onClick={() => void copy()}
      size="sm"
      type="button"
      variant="secondary"
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
