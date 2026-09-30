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
        "w-full appearance-none rounded-md border border-border bg-surface px-3 py-2 text-sm",
        "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
        "focus-visible:outline-cafaye-600 disabled:cursor-not-allowed disabled:opacity-50",
        "bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat",
        "pr-9",
        className,
      )}
      style={{
        // A data URI rather than a colour: the arrow has to follow the theme,
        // and a `currentColor` mask is the one form that does without a token
        // per theme. Tailwind cannot express `mask` on a background image, so
        // this is the single inline value in the component library.
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
