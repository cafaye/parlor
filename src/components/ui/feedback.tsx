/**
 * The states an async screen has to render, and the one that was missing.
 *
 * Why these are one file: they are the parts that are easy to leave out and
 * expensive to leave out. A loading state that announces nothing and an error
 * that is not a live region are both experienced as "this page is broken" with
 * no way to say so. A destructive action with no confirmation is experienced
 * as "I deleted my account" with no way to undo it.
 *
 * ---------------------------------------------------------------------------
 * WHY `ConfirmDialog` NO LONGER LIVES HERE
 * ---------------------------------------------------------------------------
 * It did, and the reason it does not any more is the same reason this file has
 * no `"use client"` directive. `ConfirmDialog` calls `useId`, `useEffect` and
 * `useCallback`, which makes it a Client Component. `Callout` calls no hooks,
 * which makes it a perfectly good Server Component. One file cannot be both, and
 * the barrel at `@/components/ui` re-exports both — so whichever way this file
 * was resolved, it was wrong for one of them.
 *
 * Left as a Server Component that calls hooks, any Server Component importing
 * `Callout` through the barrel breaks `next build` — and jsdom cannot see it
 * coming, because jsdom has no server/client boundary to cross. Given a
 * `"use client"` directive, `Callout` ships hydration JavaScript on every
 * server-rendered page that uses one, which is most of them, to render a
 * `<div>` with a `role`.
 *
 * So `ConfirmDialog` is now `./confirm-dialog`, carrying the directive it
 * needs, and the barrel re-exports both. `Callout` stays here, hook-free, so a
 * Server Component can safely reach it.
 *
 * The `no-hooks-without-use-client` check in `tests/validate-ci.sh` keeps the
 * split from quietly healing back into one file.
 */

import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

export type CalloutTone = "note" | "positive" | "caution" | "critical";

const TONES: Record<CalloutTone, string> = {
  note: "border-border bg-surface-sunken text-muted",
  positive: "border-positive/30 bg-positive-surface text-positive",
  caution: "border-caution/30 bg-caution-surface text-caution",
  critical: "border-critical/30 bg-critical-surface text-critical",
};

/**
 * A titled note inside a panel.
 *
 * The urgency is the interesting parameter. `role="status"` is polite: it
 * waits for a pause, which is right for something that appeared without
 * anything having gone wrong — a saved token, a created account. `role="alert"`
 * is assertive: it cuts across the current utterance, which is right for a
 * failure and wrong for anything else.
 *
 * `assertive={false}` exists because a critical callout that a person has
 * already been shown and is now re-rendering should not interrupt them a
 * second time. It stays a live region — still findable — and just stops
 * shouting.
 */
export function Callout({
  title,
  tone = "note",
  assertive,
  children,
  className,
  action,
}: {
  /**
   * Optional on purpose. A callout that must have a title forces the author to
   * invent one, and inventing a sentence about a failure the component cannot
   * see is exactly what `AGENTS.md` forbids — the copy belongs to whoever knows
   * what happened. `FieldSummary` is the case in point: it has no title, and
   * the sentence inside it is the one the form already wrote.
   *
   * When there is no title the region is still a live region; it just has no
   * visible heading, which is the correct rendering of "one sentence, no
   * heading" — the form's error summary style this app already used.
   */
  title?: string;
  tone?: CalloutTone;
  /** `critical` is assertive unless this says otherwise. */
  assertive?: boolean;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const isCritical = tone === "critical";
  const region = isCritical && assertive !== false ? "alert" : "status";

  return (
    <div className={cx("rounded-md border px-3 py-2.5", TONES[tone], className)} role={region}>
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      {children ? <div className={cx(title ? "mt-1" : "", "text-sm")}>{children}</div> : null}
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}