import type { ReactNode } from "react";

import { Surface, TextLink } from "@/components/ui";

import { CommandLine } from "./command-line";
import { EnrollCapability } from "./enroll-capability";
import { InstallBlock } from "./install-block";

/**
 * The two ways in, from the 2026-10-15 decision.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE LEADS WITH NOW
 * ---------------------------------------------------------------------------
 * `/box` used to open on the operator's list — the dashboard framing — which
 * meant a signed-out visitor arrived at a screen whose only content was "sign
 * in to see your boxes". That is the wrong first thing for the surface whose
 * job is to be the front door, and the decision settled it: the page leads
 * with the two paths, and the boxes list sits under them as the visual
 * confirmation for someone who already has one.
 *
 * So this section is the top of the page and it is rendered to EVERYONE —
 * signed-out visitors especially, because they are the reason it exists. The
 * hosted path is server markup with no branch on the session. The "Your box"
 * path holds one session-aware island — the enrollment-token mint below —
 * because the mint is member-scoped and a signed-out visitor has no session
 * to mint with; that island invites sign-in first rather than mocking the
 * minted state.
 *
 * ---------------------------------------------------------------------------
 * THE COMMANDS ARE THE DECISION'S, NOT THIS FILE'S
 * ---------------------------------------------------------------------------
 * Every command below is one of the fixed names the decision settled on and
 * `cafaye/cafe` is adding in the same wave. Nothing here invents a verb: a
 * screen that showed a command the CLI does not answer would be a screen
 * somebody follows into a failure. `curl … /box/install | bash` is a link to
 * the front door this app already serves, and it is copyable beside being
 * clickable — the person installing wants the command, the person auditing it
 * wants to read the script.
 */

/**
 * One path: what it is, the one sentence that makes the choice, and the
 * commands that take it.
 *
 * A `Surface` and not a drawing: this is an app screen, and the landing's
 * figure components are a different language for a different job. The card,
 * the hairline and the `max-w-3xl` column are the composition the account and
 * auth screens already use, so `/box` reads as one product with them.
 */
function Path({
  eyebrow,
  title,
  sentence,
  children,
}: {
  eyebrow: string;
  title: string;
  sentence: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface as="article" padding="pane">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{eyebrow}</p>
      <h3 className="mt-1 text-base font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted">{sentence}</p>
      <div className="mt-4 flex flex-col gap-2">{children}</div>
    </Surface>
  );
}

export function TwoPaths() {
  return (
    <section aria-labelledby="two-paths" className="mb-10">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <h2 className="text-lg font-semibold tracking-tight" id="two-paths">
          Two ways in
        </h2>
        <p className="text-sm text-muted">
          Both end with the same services running. What differs is whose box they run on, and
          that is the whole decision.
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        <Path
          eyebrow="Hosted"
          sentence={
            <>
              You need api.cafaye.com and a key, and nothing else, to start.{" "}
              <TextLink href="/register">Create your hosted account</TextLink>.
            </>
          }
          title="Use hosted — 30 seconds, free"
        >
          {/*
            The prefix variable is cafe's OWN name, `CAF_IDENTITY_URL`
            (internal/cli/agent.go:44 — the only env var `cafe login` reads,
            login.go:36). cafe's own help text at login.go:197 prints
            `IDENTITY_URL=…`, and that is a bug in the help, not the interface:
            measured against the built binary, `IDENTITY_URL=… cafe login
            --email … --password-stdin` is refused with "pass --base-url <url>
            or set CAF_IDENTITY_URL", while `CAF_IDENTITY_URL=…` reaches the
            endpoint. Do not "fix" this back to `IDENTITY_URL` to match the
            help text — that shows a command cafe refuses, which is the one
            thing this page must never do.
          */}
          <CommandLine
            command="CAF_IDENTITY_URL=https://api.cafaye.com cafe login --email you@example.com --password-stdin"
            copyLabel="CAF_IDENTITY_URL=https://api.cafaye.com cafe login --email you@example.com --password-stdin"
          />
          <CommandLine command="cafe add pantry/identity" copyLabel="cafe add pantry/identity" />
        </Path>
        <Path
          eyebrow="Your box"
          sentence="You own the box, and your data is not with us."
          title="Deploy to your box — you own it"
        >
          {/*
            `cafe box init` stays first because it is what generates the block
            below it: run it, fill in the placeholders it prints, then run the
            block in one shell. The block IS that command's output, transcribed
            into `install-inputs.ts` — a bare `curl | bash` died at step 5 of
            the walk demanding variables a stranger cannot know, so the
            one-liner is not shown on its own anywhere on this card.
          */}
          <p className="text-sm text-muted">
            Run <code className="font-mono text-xs">cafe box init</code> first — it generates
            the complete install block below, with every value the installer reads.
          </p>
          <CommandLine command="cafe box init" copyLabel="cafe box init" />
          <InstallBlock />
          {/*
            The missing step the page used to skip: the enroll needs a
            capability no static command can carry, so this island mints one
            for a signed-in visitor and invites sign-in first for anyone else.
            The stdin form of the enroll lives in the island, beside the token
            it feeds — never in argv, and never as a `<capability>` placeholder
            somebody has to go and find.
          */}
          <EnrollCapability />
        </Path>
      </div>
    </section>
  );
}
