"use client";

import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { Button, linkClasses } from "@/components/ui";

import { INSTALL_BLOCK } from "./install-inputs";

/**
 * The complete parameterized install, as one copyable block.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A BLOCK AND NOT A COMMAND LINE
 * ---------------------------------------------------------------------------
 * The walk proved a bare `curl … | bash` cannot complete an install: it died
 * at step 5 demanding `KIT_SUBSTRATE_BOX_ID`, and re-run, one variable per
 * run after that. A stranger reading only the one-liner has no way to know
 * those exist, so this card renders the whole block `cafe box init` prints —
 * required exports live, optional and defaults commented — with the one-line
 * meaning beside each value. The text is `INSTALL_BLOCK`, built from the one
 * list in `install-inputs.ts`, so the card cannot drift from what the
 * installer reads.
 *
 * The copy semantics are the house's (`command-line.tsx`): the visible label
 * stays "Copy", the block rides in the accessible name, and a clipboard that
 * refuses is not an error — the text is still on the screen and selectable.
 * The script itself stays auditable: the line under the block links to
 * `/box/install`, the bytes the last line downloads.
 */
export function InstallBlock() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(INSTALL_BLOCK);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
          <code>{INSTALL_BLOCK}</code>
        </pre>
        <div>
          <Button
            aria-label="Copy the install block"
            onClick={() => void copy()}
            size="sm"
            type="button"
            variant="secondary"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted">
        <Link className={linkClasses} to="/box/install">
          Read the install script
        </Link>{" "}
        before you run it — that is what the block&apos;s last line downloads.
      </p>
    </div>
  );
}
