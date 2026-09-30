import type { InputHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/**
 * The one text input in the shell.
 *
 * The `aria-invalid:` variant does the work that a red border usually does by
 * hand, which means the invalid state cannot drift out of sync with what the
 * accessibility tree reports. `Field` sets `aria-invalid`; the colour follows.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      className={cx(
        "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-foreground",
        "placeholder:text-muted",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cafaye-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-critical",
        className,
      )}
      {...rest}
    />
  );
}
