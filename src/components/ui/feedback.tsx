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
 * WHY `ConfirmDialog` NO LONGER LIVES HERE, AND WHAT THE SPLIT BUYS *NOW*
 * ---------------------------------------------------------------------------
 * It did, and the reason it does not is the same reason this file has no
 * `"use client"` directive. `ConfirmDialog` calls `useId`, `useEffect` and
 * `useCallback`; `Callout` calls no hooks. Under the previous framework one file
 * could not hold both kinds — the barrel at `@/components/ui` re-exports
 * everything, so whichever way this file was resolved, it was wrong for one of
 * them. So `ConfirmDialog` is `./confirm-dialog`, carrying the directive it
 * needs, and `Callout` stays here, hook-free and unmarked.
 *
 * The honest accounting of what that is worth today, because the version of this
 * comment that said `Callout` "ships hydration JavaScript on every
 * server-rendered page that uses one" was not true of this tree and had stopped
 * being measurable:
 *
 *   * There is no server/client split here to keep `Callout` out of. `vite build`
 *     is `package.json` `scripts.build`, no RSC configuration exists in `src/`,
 *     and nothing reads `"use client"`.
 *   * So `Callout` is in `dist/client/assets/ui-BseiPOyp.js` today, directive or
 *     not — `login-form.tsx` and `register-form.tsx` render it, and both are
 *     client components. That was measured with `grep -l bg-positive-surface
 *     dist/client/assets/*.js`, not assumed.
 *
 * What the split buys is an accurate marker, and that is the whole of it. It is
 * still worth having: it is what makes `"use client"` in this directory mean
 * something, and it is what a future move to a framework that *does* enforce the
 * split would need to already be true.
 *
 * The check that keeps it from healing back into one file is
 * `src/components/ui/client-boundary.test.ts` — which also names these two files
 * by hand, because no rule can tell a file that merely absorbed `ConfirmDialog`
 * from a correct client file.
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