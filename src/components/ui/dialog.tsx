import type { ComponentProps } from "react";

import { Dialog } from "@base-ui/react/dialog";

import { cx } from "@/lib/cx";

/**
 * The wrapper takes a plain string `className`: Base UI also accepts a
 * state function there, and this system styles through tokens rather than
 * dialog state, so the narrower type keeps a function from reaching `cx`.
 */
type StringClassProps<T extends { className?: unknown }> = Omit<T, "className"> & {
  className?: string;
};


/**
 * The modal primitives.
 *
 * ---------------------------------------------------------------------------
 * SHADCN PROVENANCE (structure and behavior, Anywaye tokens)
 * ---------------------------------------------------------------------------
 * Construction follows shadcn/ui `dialog` on its current default foundation,
 * which is Base UI rather than Radix: `Root` owns the open state, `Portal`
 * moves the popup to `<body>`, `Backdrop` dims the page, `Viewport` centers
 * the popup, and `Popup`/`Title`/`Description` carry the accessible dialog
 * semantics (`role="dialog"`, the labelled-by/described-by wiring — but not
 * `aria-modal`, which the primitives do not print) that the hand-built
 * `<div role="dialog">` in `confirm-dialog.tsx`
 * used to assemble by hand. `ConfirmDialog` states `aria-modal="true"`
 * explicitly on its popup, where the modal decision is made.
 *
 * What Base UI owns here, so this file does not reimplement it: the focus
 * trap (Tab and Shift+Tab stay inside while open), initial and final focus,
 * Escape handling, scroll locking, and hiding the page behind the dialog
 * from assistive interaction (`aria-hidden` on outside content while open).
 * Those are library behavior with their own test suite, not forty lines of
 * application-owned trap code that can be wrong.
 *
 * Token substitutions (shadcn default -> this system; every value is a token
 * from `src/styles/tokens.css`, never a literal):
 * - `bg-black/80` (overlay) -> `bg-foreground/40` (the scrim this dialog
 *   already dimmed with — the overlay behind a confirmation, not a blackout)
 * - `bg-background` (panel) -> `bg-overlay`
 * - `border` stays `border-border`; radius, spacing and type are this
 *   system's (`rounded-lg`, `p-5`, `text-lg font-medium` title,
 *   `text-sm text-muted` description)
 * - `focus-visible:ring-*` -> nothing on the popup: the popup is not a
 *   control and never carried a ring
 *
 * Deliberately NOT adopted: `Dialog.Trigger`/`Dialog.Close` (the caller's
 * openers and buttons stay plain controls, so `ConfirmDialog`'s public API
 * does not change), animations (`data-[state=open]:animate-in` — no motion
 * system exists in this tree), and `sm:max-w-lg` (the confirmation panel
 * stays `max-w-md`).
 */

// State ownership stays with the caller: `ConfirmDialog` is controlled, so
// `Root` takes `open` and reports close requests through `onOpenChange`
// rather than closing itself.
export const DialogRoot = Dialog.Root;
export const DialogPortal = Dialog.Portal;

export function DialogViewport({ className, ...rest }: StringClassProps<ComponentProps<typeof Dialog.Viewport>>) {
  return (
    <Dialog.Viewport
      className={cx("fixed inset-0 z-50 flex items-center justify-center p-4", className)}
      {...rest}
    />
  );
}

export function DialogBackdrop({ className, ...rest }: StringClassProps<ComponentProps<typeof Dialog.Backdrop>>) {
  return (
    <Dialog.Backdrop
      data-slot="dialog-overlay"
      className={cx("absolute inset-0 bg-foreground/40", className)}
      {...rest}
    />
  );
}

export function DialogPopup({ className, ...rest }: StringClassProps<ComponentProps<typeof Dialog.Popup>>) {
  return (
    <Dialog.Popup
      data-slot="dialog-content"
      className={cx(
        "relative w-full max-w-md rounded-lg border border-border bg-overlay p-5",
        "shadow-dialog",
        className,
      )}
      {...rest}
    />
  );
}

export function DialogTitle({ className, ...rest }: StringClassProps<ComponentProps<typeof Dialog.Title>>) {
  return (
    <Dialog.Title data-slot="dialog-title" className={cx("text-lg font-medium", className)} {...rest} />
  );
}

export function DialogDescription({ className, ...rest }: StringClassProps<ComponentProps<typeof Dialog.Description>>) {
  return (
    <Dialog.Description
      data-slot="dialog-description"
      className={cx("mt-2 text-sm text-muted", className)}
      {...rest}
    />
  );
}
