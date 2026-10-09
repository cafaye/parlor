import { cx } from "@/lib/cx";

/**
 * The hairline, as a component.
 *
 * shadcn/ui has a `Separator` because a divider that is retyped at every
 * call site drifts: one row gets `border-t`, the next gets `border-b`, and
 * six months later two "hairlines" are two different greys. This one needs
 * no behaviour — a separator is a line — so it is a plain element with the
 * house token and no library behind it, which is also why it renders on the
 * server and carries no client boundary.
 *
 * Every ruled list in this product draws the same line; now they draw it
 * from one place. Use it between sections and rows; use `border-b` on the
 * rows themselves when the line belongs to the row, which is the other
 * honest spelling of the same idea.
 */

export type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
};

export function Separator({
  orientation = "horizontal",
  className,
  ...rest
}: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="separator"
      data-orientation={orientation}
      className={cx(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...rest}
    />
  );
}
