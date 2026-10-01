import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * The two link shapes this app has, so neither is re-decided per screen.
 *
 * ---------------------------------------------------------------------------
 * WHY A COMPONENT AND NOT A CLASS STRING
 * ---------------------------------------------------------------------------
 * The alternative is `className={linkClasses}` at ten call sites, and that is
 * the version where a link loses its focus ring six months from now because
 * somebody typed the class by hand. The class is exported for the cases where
 * it genuinely is not an element (`<a>` with a `mailto:`, a heading that wraps
 * a link), but the two shapes a call site actually wants are components.
 *
 * ---------------------------------------------------------------------------
 * WHY THE UNDERLINE IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * `TextLink` underlines. The other instinct — colour-only links, no underline —
 * is worse for more people than it is better-looking for, and WCAG 1.4.1 makes
 * it a failure rather than a preference. `hover:no-underline` is a nicety and
 * it is safe precisely because the underline is there at rest: removing it on
 * hover is a change, not the only cue.
 *
 * The colour is `link`, which is seal — the one chromatic voice in the system,
 * used for exactly the things you can act on.
 */
const BASE =
  "focus-ring rounded-sm text-link underline decoration-link/40 underline-offset-2 " +
  "transition-colors duration-fast motion-reduce:transition-none " +
  "hover:text-link-hover hover:decoration-link";

/** The class, for the call sites that need an element other than these two. */
export const linkClasses = BASE;

export type TextLinkProps = Omit<ComponentProps<typeof Link>, "className"> & {
  className?: string;
  children: ReactNode;
};

/**
 * An inline link in running text: "Sign in", "Go to the account", "Try again".
 *
 * Wraps `next/link`, so middle-click, open-in-new-tab and "copy link address"
 * all work. A `<button>` styled as a link does not offer any of them, which is
 * why `Button` has no `href`.
 */
export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <Link className={cx(BASE, "font-medium", className)} {...rest}>
      {children}
    </Link>
  );
}

/**
 * A link that occupies a whole row: an account in a list, a card on the
 * landing page.
 *
 * The distinction from `TextLink` is not decoration — it is that the target is
 * the entire region, not a word in a sentence. That changes what a person
 * expects to be clickable and it changes what a screen reader announces, so it
 * is a different component rather than a size variant of the same one.
 *
 * Focus ring included, which the ten hand-written versions of this did not have.
 */
export type CardLinkProps = Omit<ComponentProps<typeof Link>, "className"> & {
  className?: string;
  children: ReactNode;
};

export function CardLink({ className, children, ...rest }: CardLinkProps) {
  return (
    <Link
      className={cx(
        "focus-ring block rounded-lg border border-border bg-surface-raised p-4",
        "transition-colors duration-fast motion-reduce:transition-none",
        "hover:border-border-strong hover:bg-surface-sunken",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
