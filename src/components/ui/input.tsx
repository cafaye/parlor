import type { InputHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/**
 * The text input.
 *
 * Two things are worth reading.
 *
 * ---------------------------------------------------------------------------
 * THE INVALID STATE IS `aria-invalid`, NOT A COLOUR
 * ---------------------------------------------------------------------------
 * The `aria-invalid:` variant does the work a red border usually does by hand,
 * which means the invalid state cannot drift out of sync with what the
 * accessibility tree reports. `Field` sets `aria-invalid`; the colour follows
 * from it. A screen that painted a field red by adding a class and forgot the
 * attribute has told a sighted person something it never told anybody using a
 * screen reader.
 *
 * The invalid border is `critical`, which the palette measures at 8.92:1 on
 * paper — comfortably past the 3:1 that a boundary needs. A "subtle red" here
 * would be a red nobody can see on the one occasion it matters.
 *
 * ---------------------------------------------------------------------------
 * WHY PLACEHOLDERS ARE `muted` AND NOT A PALER GREY
 * ---------------------------------------------------------------------------
 * `tokens.css` has no `placeholder` token, and the reason is arithmetic: a
 * placeholder is text, so it owes 4.5:1, and the lightest step of the neutral
 * ramp that clears 4.5:1 on paper is indistinguishable from the secondary
 * label colour. So a compliant placeholder is `muted`.
 *
 * That is not a limitation to work around, it is the right answer. Help text
 * that somebody needs belongs in `Field`'s `hint`, which is a real `<p>` with
 * an id that `aria-describedby` points at. A placeholder that disappears the
 * moment somebody types is the one piece of help in a form that is guaranteed
 * to be read by nobody.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      className={cx(
        "focus-ring w-full rounded-md border border-border-strong bg-surface-raised px-3",
        "text-sm text-foreground transition-colors duration-fast motion-reduce:transition-none",
        "placeholder:text-muted",
        "hover:border-border-strong/70",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted",
        "aria-invalid:border-critical",
        className,
      )}
      {...rest}
    />
  );
}
