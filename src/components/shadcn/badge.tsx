import { cx } from "@/lib/cx";

/**
 * The label chip: a language, a status, a one-word fact about a row.
 *
 * shadcn/ui's Badge, built the way this repository builds primitives — a
 * base string and a variant map composed by `cx`, exactly as `button.tsx`
 * does it — so the site primitives carry no dependency the app primitives do
 * not already carry. The variant names are shadcn's, with the house's
 * substitutions: `bg-primary` is `bg-accent` and its foreground is
 * `text-on-accent`, because those are the tokens this system owns.
 *
 * The shape is not a pill. The paper metaphor wants corners — "a ledger
 * sheet has corners, it does not have bubbles" (tokens.css) — so the base
 * is `rounded-sm` in mono uppercase at meta size, the same typographic
 * treatment the eyebrows use. A chip that looks like a button gets pressed.
 *
 * `positive` and `caution` are the house status ramp with their surface
 * partners, and they carry meaning — a service is live, or it ships with
 * launch — which is the only reason status colours exist in the palette at
 * all: a status is a fact about something, seal is an invitation to do
 * something.
 */

export type BadgeVariant =
  | "default"
  | "solid"
  | "outline"
  | "positive"
  | "caution";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "border-border bg-surface-sunken text-muted",
  solid: "border-transparent bg-accent text-on-accent",
  outline: "border-border-strong text-muted",
  positive: "border-transparent bg-positive-surface text-positive",
  caution: "border-transparent bg-caution-surface text-caution",
};

const BASE =
  "focus-ring inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-meta uppercase tracking-[0.08em] whitespace-nowrap " +
  "transition-[color,background-color,border-color] duration-fast ease-standard motion-reduce:transition-none";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({
  variant = "default",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cx(BASE, VARIANTS[variant], className)}
      {...rest}
    >
      {children}
    </span>
  );
}
