/**
 * The states an async screen has to render, and the one that was missing.
 *
 * Why these are one file: they are the parts that are easy to leave out and
 * expensive to leave out. A loading state that announces nothing and an error
 * that is not a live region are both experienced as "this page is broken" with
 * no way to say so. A destructive action with no confirmation is experienced
 * as "I deleted my account" with no way to undo it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cx } from "@/lib/cx";

import { Button } from "./button";

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

// ---------------------------------------------------------------------------
// The destructive confirmation
// ---------------------------------------------------------------------------

/** The controls a focus trap will walk. Order is document order, which is
 *  the order somebody reading the dialog expects to move through. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ConfirmDialogProps = {
  open: boolean;
  /** The question. Read as the dialog's name, so it has to stand alone. */
  title: string;
  /** The consequence. Read as the dialog's description. */
  description: string;
  /**
   * The destructive action's own name, not "Confirm" and not "OK".
   *
   * "Delete this account" and "Delete" are the same act, and the difference is
   * the difference between reading a button and reading a dialog and knowing
   * what is about to happen. A generic confirm label is how people click
   * through things they did not read.
   */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm(): void;
  onCancel(): void;
  /** The confirm is in flight. Disables it; never renames it. */
  busy?: boolean;
};

/**
 * A modal confirmation for an action that cannot be undone.
 *
 * Built on `<div role="dialog">` rather than the native `<dialog>`, and that is
 * a measured choice rather than a preference. `HTMLDialogElement.showModal()`
 * gives focus trapping, Escape and the top layer for free — and jsdom does not
 * implement it, so every property that makes a native dialog good would be
 * untestable in the tier this repository actually gates on. Hand-building them
 * costs about forty lines and buys assertions on all of them. The consequence
 * is stated here because it is a real trade: the trap below is ours, and ours
 * is a thing that can be wrong.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE FOCUS LIST, SINCE THE OBVIOUS ONE IS WRONG
 * ---------------------------------------------------------------------------
 * The usual way to build the focusable list filters on `offsetParent !== null`,
 * which is how you skip `display: none`. It is wrong here twice over. The
 * dialog is `position: fixed`, and a fixed element's `offsetParent` is `null`
 * in a real browser — so the filter empties the list and the trap silently
 * stops working on the very element it exists for. And it is wrong under
 * jsdom, where `offsetParent` is `null` unconditionally, which is how the
 * first version of this passed a test while doing nothing.
 *
 * Hence no filter at all. The only focusable things in this dialog are the two
 * buttons, and `FOCUSABLE` already excludes disabled ones.
 *
 * Three decisions that are not obvious:
 *
 *   - **Focus lands on Cancel.** The safe default for a destructive action is
 *     the one that does nothing. Landing on the destructive button means the
 *     spacebar a person is already holding down destroys something.
 *   - **The scrim does not close it.** Escape and Cancel do. A confirmation
 *     that dismisses on an accidental click outside is not a confirmation of
 *     anything — it is a second way to be wrong.
 *   - **Focus goes back where it came from.** Closing a dialog and dumping
 *     somebody at the top of the document is a small, common, maddening bug.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  // A ref, not state: a re-render must not be able to steal the cancel button
  // back from somebody who has already tabbed to the confirm button.
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Unmounting restores focus. Without this, a dialog closed by a navigation
    // leaves focus on a node that no longer exists and the next Tab starts at
    // the top of the document.
    return () => {
      restoreTo.current?.focus();
      restoreTo.current = null;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        // A busy confirm is mid-flight; Escape must not be able to make the
        // dialog disappear while the delete it announced is still in progress.
        if (busy) return;
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel.current?.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    },
    [busy, onCancel],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Present for the tap-to-dismiss instinct and for the dimming; not a
          dismiss target, on purpose. It is a sibling of the panel rather than
          its parent so a click inside the dialog cannot bubble into it. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/40"
        data-testid="confirm-scrim"
      />
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cx(
          "relative w-full max-w-md rounded-lg border border-border bg-overlay p-5",
          "shadow-dialog",
        )}
        onKeyDown={onKeyDown}
        ref={panel}
        role="dialog"
      >
        <h2 className="text-lg font-medium" id={titleId}>
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted" id={descriptionId}>
          {description}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={onCancel} ref={cancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            aria-busy={busy}
            disabled={busy}
            onClick={onConfirm}
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
