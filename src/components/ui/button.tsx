import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "@/lib/cx";

import { Spinner } from "./spinner";

/**
 * The one button in the system.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO `linkBUTTON` VARIANT
 * ---------------------------------------------------------------------------
 * A button that navigates is a link, and a link that submits is a button, and
 * the two have different affordances a person can see: middle-click, open in
 * a new tab, "copy link address", the status-bar URL. This component cannot
 * offer any of those, so a call site that needs them must use `<Link>` with
 * `linkClasses()` from `./link`. That split is deliberate and it is why there
 * is no `href` prop here: accepting one would make the wrong thing easy.
 *
 * ---------------------------------------------------------------------------
 * WHY `destructive` IS A VARIANT AND NOT A RED PRIMARY
 * ---------------------------------------------------------------------------
 * Because a destructive action and a primary action are not the same thing
 * wearing a colour. Before this, the delete confirmation on the account
 * screen was a `primary` button — the same visual weight as "Save name" and
 * "Create account", sitting in a panel with three other buttons. The most
 * dangerous control on the page was indistinguishable from the safest.
 *
 * `destructive` is filled rather than outlined, so it still reads as a commit
 * (an outlined red would read as "enter a mode"), but it is the only filled
 * red control in the system, so the eye finds it. The confirmation dialog uses
 * it exactly once, and that is the only place in the app a red button should
 * ever appear.
 *
 * ---------------------------------------------------------------------------
 * THE BUSY RULE
 * ---------------------------------------------------------------------------
 * The accessible name does not change when the button is busy. A submit
 * control that renames itself from "Create account" to "Creating…" loses its
 * own label mid-interaction for anyone navigating by voice or by name; it
 * goes `disabled` + `aria-busy` instead, which says the same thing without
 * moving the target. `aria-busy` is the whole mechanism, and it is what
 * `Spinner` is decorative *to* — the button is what announces.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-accent text-on-accent hover:bg-accent-hover",
  secondary:
    "border border-border-strong bg-surface-raised text-foreground hover:bg-surface-sunken",
  ghost: "border border-transparent bg-transparent text-muted hover:text-foreground",
  destructive:
    "border border-transparent bg-critical text-on-accent hover:opacity-90",
};

/**
 * Two sizes, and the heights are explicit rather than left to padding.
 *
 * `min-h` rather than `h`, because a two-line label in a button should grow
 * rather than clip. The floor is what keeps a row of mixed controls aligned:
 * 32px for a dense table action, 36px for everything on a page.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 gap-1.5 px-2.5 text-sm",
  md: "min-h-9 gap-2 px-3.5 text-sm",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /**
   * Show a spinner. The caller still owns `disabled` and `aria-busy`; this
   * only draws the mark, because a component that inferred `busy` would also
   * be inferring the disabled state, and the two are not always the same
   * thing (a control can be busy and still be clickable, or clickable and not
   * busy).
   */
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", busy = false, className, type, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      className={cx(
        "focus-ring inline-flex items-center justify-center rounded-md font-medium",
        "whitespace-nowrap transition-colors duration-fast motion-reduce:transition-none",
        "disabled:cursor-not-allowed disabled:opacity-55",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      disabled={disabled}
      ref={ref}
      // `button` is the right default: a bare `<button>` inside a `<form>` is a
      // submit, and forgetting `type` is how a "Cancel" button posts a form.
      type={type ?? "button"}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
});
