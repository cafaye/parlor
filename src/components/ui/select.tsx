import type { SelectHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/**
 * A native `<select>`, styled to match `Input`.
 *
 * Native on purpose. The role picker is a short list of known values, and a
 * native select brings keyboard behaviour, a typeahead on some platforms, and
 * the right thing on a phone — none of which a styled `<div>` with a
 * `role="listbox"` gets for free, and all of which are the expensive half of
 * "accessible".
 *
 * The arrow is a background SVG rather than a wrapper element, so the control
 * is still one focusable thing with one accessible name. `appearance-none` is
 * what hides the platform's own arrow so the two do not sit side by side.
 */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...rest }: SelectProps) {
  return (
    <select
      className={cx(
        // Everything `Input` has, so the two controls are the same object at a
        // glance. A select that is a different size or colour from the input
        // above it reads as a different kind of field, and the only thing that
        // makes it different is which values it takes.
        "focus-ring w-full appearance-none rounded-md border border-border-strong",
        "bg-surface-raised pr-9 pl-3 text-sm text-foreground",
        "transition-colors duration-fast motion-reduce:transition-none",
        "hover:border-border-strong/70",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted",
        "aria-invalid:border-critical",
        className,
      )}
      style={{
        // A data URI rather than a colour, and a MASK rather than a background
        // image: `currentColor` in the SVG follows the resolved `color` of the
        // element, so one rule serves both themes with no token per theme and
        // no second arrow to keep in step. A background-image SVG cannot do
        // that, which is why this is a mask and why it is inline — Tailwind
        // cannot express `mask-image` on a background, and the alternative
        // (a wrapper element with a chevron child) costs a focusable-looking
        // div to save one line of CSS.
        maskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m4 6 4 4 4-4'/></svg>\")",
        maskPosition: "right 0.75rem center",
        maskRepeat: "no-repeat",
        maskSize: "1rem",
        WebkitMaskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m4 6 4 4 4-4'/></svg>\")",
        WebkitMaskPosition: "right 0.75rem center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "1rem",
      }}
      {...rest}
    />
  );
}
