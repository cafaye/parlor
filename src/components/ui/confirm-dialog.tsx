"use client";

/**
 * The destructive confirmation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE, AND WHY THAT IS NOT A STYLISTIC CHOICE
 * ---------------------------------------------------------------------------
 * It used to live in `feedback.tsx` next to `Callout`, on the argument that the
 * states an async screen must render belong together. That argument was right
 * about the *idea* and wrong about the *module*, and being wrong about the
 * module cost this template a class of bug the test suite cannot see.
 *
 * `ConfirmDialog` calls `useId`, `useEffect` and `useState`. `Callout` calls
 * no hooks at all. Under the previous framework one file could not be both: a
 * file whose components had to run on a server and a file whose components had
 * to run in a browser were different modules, and this one had members of each.
 *
 *   - Left without a directive, the file was a server module calling hooks, and
 *     any server module importing it through the `@/components/ui` barrel was
 *     rejected by the compiler.
 *   - Given a file-level `"use client"`, `Callout` was marked as a browser
 *     component too — for markup that needed none of it.
 *
 * That is why this is its own file, and the split is still worth keeping: the
 * marker on it is descriptive, so it says "these components need the browser",
 * and it is true. Note what the split is NOT buying in this tree, because the
 * old comment here claimed it and it is not true here: there is no server/client
 * split for `vite build` to enforce, and no RSC configuration anywhere in `src/`,
 * so a hook-free `Callout` reaches `dist/client/assets` anyway — the forms that
 * render it are client components. Marking this file costs nothing and saves
 * nothing; what it buys is an accurate marker.
 *
 * A caller reaching for either this or `Callout` still imports from
 * `@/components/ui`, which is the point of the barrel: the split is invisible at
 * the call site and enforced where the facts are.
 *
 * The check that keeps the markers honest is
 * `src/components/ui/client-boundary.test.ts` — the three tests in it, one per
 * direction, plus the one that names these two files. It used to be named
 * `no-hooks-without-use-client` in `tests/validate-ci.sh`, and that name now
 * points at nothing: `grep -n "no-hooks-without-use-client" tests/validate-ci.sh`
 * is empty.
 */

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "./button";
import {
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogViewport,
} from "./dialog";
import { Input } from "./input";

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
  // Property declarations, not method shorthand: a `onConfirm(): void`
  // signature tells TypeScript the member has a `this`, and destructuring it
  // out of the props — which this component does below — is then a method
  // separated from its object under `@typescript-eslint/unbound-method`. The
  // callbacks arrive from a caller's props and are never called on anything, so
  // there is no `this` to lose. See `IdentityClient` for the same decision at
  // the boundary.
  onConfirm: () => void;
  onCancel: () => void;
  /** The confirm is in flight. Disables it; never renames it. */
  busy?: boolean;
  /**
   * The exact string the person must type before the confirm enables.
   *
   * For the actions where a second click is not enough — deleting the account
   * you are signed in with, where the reference product makes the person type
   * the account name. The expected value is shown so the person knows what to
   * type, and the confirm stays disabled until the input matches it exactly.
   * Omit for a plain two-step confirm.
   */
  requireTyping?: string;
};

/**
 * A modal confirmation for an action that cannot be undone.
 *
 * Built on the Base UI dialog primitives in `./dialog` (the shadcn/ui default
 * foundation) rather than on the hand-built `<div role="dialog">` this file
 * used to carry, and the trade being made is the point. `showModal()` was
 * rejected because jsdom does not implement it, so every property that makes a
 * native dialog good would have been untestable in the tier this repository
 * gates on — and the hand-built trap bought testability at the price of owning
 * the trap. Base UI moves that ownership: the focus trap, Escape handling,
 * initial and final focus, and hiding the page behind the dialog from
 * assistive interaction are library behavior now, asserted here by what the
 * screen does rather than by trap internals.
 *
 * Four decisions that are not obvious:
 *
 *   - **Focus lands on Cancel, including when `requireTyping` is present.**
 *     The safe default for a destructive action is the one that does nothing.
 *     Landing on the destructive button means the spacebar a person is already
 *     holding down destroys something — and the type-to-confirm input sits
 *     earlier in document order, so the default "first tabbable" focus would
 *     land there instead. `initialFocus` names Cancel explicitly.
 *   - **The scrim does not close it.** Escape and Cancel do. A confirmation
 *     that dismisses on an accidental click outside is not a confirmation of
 *     anything — it is a second way to be wrong. `disablePointerDismissal`
 *     means an outside press never even reaches `onOpenChange`.
 *   - **A busy confirm cannot be dismissed at all.** Escape arrives as a close
 *     request through `onOpenChange`, and while `busy` the request is ignored:
 *     the delete it announced is still in progress.
 *   - **Focus goes back where it came from.** Base UI restores focus to the
 *     previously focused element on close by default; closing a dialog and
 *     dumping somebody at the top of the document is a small, common,
 *     maddening bug, and the default is what prevents it.
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
  requireTyping,
}: ConfirmDialogProps) {
  // The cancel button, named as the dialog's initial focus. A ref, not state:
  // a re-render must not be able to steal focus back from somebody who has
  // already tabbed to the confirm button.
  const cancel = useRef<HTMLButtonElement>(null);
  // The typed value for a `requireTyping` confirm. Reset on open so a dialog
  // reopened after a cancel starts empty rather than pre-filled with the
  // previous attempt.
  const [typed, setTyped] = useState("");
  const typedId = useId();

  useEffect(() => {
    if (open) setTyped("");
  }, [open ]);

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (next) return;
        // A busy confirm is mid-flight; no dismissal may make the dialog
        // disappear while the delete it announced is still in progress.
        if (busy) return;
        // The scrim never dismisses, so the only close request that reaches
        // here is Escape (or an imperative close, which this dialog never
        // issues). Anything else is ignored: this dialog closes through its
        // own Cancel and confirm buttons, which call the callbacks directly.
        if (eventDetails.reason === "escape-key") onCancel();
      }}
      disablePointerDismissal
    >
      <DialogPortal>
        <DialogViewport>
          {/* Present for the tap-to-dismiss instinct and for the dimming; not a
              dismiss target, on purpose — `disablePointerDismissal` above is
              what makes that true rather than a missing handler. */}
          <DialogBackdrop data-testid="confirm-scrim" />
          {/*
            `aria-modal` is stated explicitly rather than left to the
            primitive: Base UI hides the page behind the dialog with
            `aria-hidden` on outside content and traps focus inside, which IS
            modal behavior, but it does not print the attribute — so the
            assertion that this dialog announces itself as modal names it here,
            where the modality is decided, rather than in the wrapper.
          */}
          <DialogPopup aria-modal="true" initialFocus={cancel}>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
            {/*
              The type-to-confirm input, rendered only when `requireTyping` is set.
              The expected value is shown so the person knows what to type, and the
              confirm stays disabled until the input matches it exactly. The input
              is part of the focus trap automatically — it is inside the popup.
            */}
            {requireTyping !== undefined ? (
              <div className="mt-4 flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor={typedId}>
                  Type <span className="font-semibold">{requireTyping}</span> to confirm
                </label>
                <Input
                  autoComplete="off"
                  id={typedId}
                  onChange={(event) => setTyped(event.target.value)}
                  value={typed}
                />
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button disabled={busy} onClick={onCancel} ref={cancel} variant="secondary">
                {cancelLabel}
              </Button>
              <Button
                aria-busy={busy}
                disabled={busy || (requireTyping !== undefined && typed !== requireTyping)}
                onClick={onConfirm}
                variant="destructive"
              >
                {confirmLabel}
              </Button>
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  );
}
