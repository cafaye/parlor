import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/**
 * The one button in the shell.
 *
 * Hand-rolled because the shadcn CLI is a later packet (AGENTS.md), and
 * three variants is the whole surface auth needs today. Every colour here is a
 * token from `src/styles/tokens.css` — `bg-accent`, `text-muted` — so the
 * brand decision stays in that one file.
 *
 * The accessible name does not change when the button is busy. A submit
 * control that renames itself from "Create account" to "Creating…" loses its
 * own label mid-interaction for anyone navigating by voice or by name; it
 * goes disabled and `aria-busy` instead, which says the same thing without
 * moving the target.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-surface hover:opacity-90 disabled:hover:opacity-50 border border-transparent",
  secondary: "border border-border bg-surface-raised text-foreground hover:border-cafaye-300",
  ghost: "border border-transparent text-muted hover:text-foreground",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "primary", className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
        "transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cafaye-600",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
