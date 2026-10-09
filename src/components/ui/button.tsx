import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "@/lib/cx";

import { Spinner } from "./spinner";

/**
 * The one button in the system.
 *
 * ---------------------------------------------------------------------------
 * SHADCN PROVENANCE (structure only, zero dependencies)
 * ---------------------------------------------------------------------------
 * Construction follows shadcn/ui `button`: a base string plus a variant map
 * plus a size map composed by one function (`buttonClasses`, where shadcn has
 * `buttonVariants`), and `data-slot="button"` on the root as the styling hook.
 *
 * Token substitutions (shadcn default -> this system; every value is a token
 * from `src/styles/tokens.css`, never a literal):
 * - `bg-primary text-primary-foreground` -> `bg-accent text-on-accent`
 * - `bg-secondary` -> `bg-surface-raised`
 * - `bg-destructive` -> `bg-critical`
 * - `focus-visible:ring-*` -> the `focus-ring` utility (`tokens.css` owns it:
 *   `outline`, not `box-shadow`, so Windows High Contrast Mode keeps it)
 *
 * Deliberately NOT adopted: `class-variance-authority` (variants use the
 * existing `cx` pattern in `src/lib/cx.ts`), `tailwind-merge`/`clsx`, and
 * `disabled:pointer-events-none` (this system keeps `disabled:cursor-not-allowed`
 * so a refused control still shows its state under the pointer).
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
/**
 * Four variants for the app, and one for the ink.
 *
 * `ink` is not a fifth app variant: it is the inversion a primary action
 * makes when it sits on an ink plane — a hero, a closing band, the places a
 * marketing surface paints `neutral-950`. The same inversion the accent
 * makes in dark mode ("a near-black button on a near-black page is
 * invisible" — tokens.css), one level up: on ink, the filled action is
 * PAPER-on-ink rather than ink-on-paper. It exists here rather than as a
 * one-off className at a call site because a call site that retypes it is a
 * call site that loses the focus ring six months later.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "ink";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-accent text-on-accent hover:bg-accent-hover",
  secondary:
    "border border-border-strong bg-surface-raised text-foreground hover:bg-surface-sunken",
  ghost: "border border-transparent bg-transparent text-muted hover:text-foreground",
  destructive:
    "border border-transparent bg-critical text-on-accent hover:opacity-90",
  ink: "border border-transparent bg-neutral-50 text-neutral-950 hover:opacity-90",
};

/**
 * The base every button shares, including the focus ring.
 *
 * Exported through `buttonClasses` below rather than used only by the component
 * for the same reason `linkClasses` is exported from `./link`: a call site that
 * needs a button-shaped control on an element that is NOT a `<button>` — a
 * provider sign-in link, which is an `<a href>` because the start leg is a
 * browser navigation — should not have to re-type the classes. Re-typing them
 * is how a link loses its focus ring and its disabled treatment six months from
 * now, and the focus ring is measured against the ground colour.
 */
const BASE =
  "focus-ring inline-flex items-center justify-center rounded-md font-medium " +
  "whitespace-nowrap transition-[color,background-color,border-color,transform] " +
  "duration-fast ease-standard motion-reduce:transition-none active:scale-[0.98] " +
  "disabled:cursor-not-allowed disabled:opacity-55";

/**
 * The classes for a button of a given variant and size, on whatever element.
 *
 * An anchor is not disabled, so `:disabled` never applies to one and the
 * `aria-disabled` spelling would be the honest way to say it — which is why the
 * social start link does not try to be busy and simply is not rendered while a
 * navigation is in flight. There is nothing to disable: pressing it starts a
 * browser navigation, and the browser leaves this document.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}

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
      className={cx(buttonClasses(variant, size), className)}
      data-slot="button"
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
