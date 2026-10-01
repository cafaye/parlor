import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A surface. The thing a group of content sits on.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A COMPONENT AND NOT A CLASS
 * ---------------------------------------------------------------------------
 * Before this, the card appeared as a literal
 * `rounded-lg border border-border bg-surface-raised px-4 py-6` in ten places
 * across five screens, and `px-4 py-3` in three more. Ten copies of a
 * decorative decision is ten places for it to drift, and it had already drifted
 * — the two paddings are both in the tree today.
 *
 * The padding is a token (`--pane`) rather than a number, because "how much
 * air is inside a card" is a design decision that was being re-made per screen.
 *
 * ---------------------------------------------------------------------------
 * WHY NO SHADOW
 * ---------------------------------------------------------------------------
 * The paper metaphor. A card is a sheet on a desk, and a sheet is separated
 * from the desk by its own edge, not by a shadow cast on it. More practically:
 * the one elevation in this system is `--shadow-dialog`, used by
 * `ConfirmDialog`, and a screen full of shadowed cards is a screen where
 * nothing looks like the most important thing.
 */
/**
 * The props are `HTMLAttributes<HTMLElement>` rather than a generic that
 * widens per tag, and the reason is worth stating because it is a deliberate
 * trade rather than a shortcut.
 *
 * A per-tag generic (`SurfaceProps<T extends "div" | "section" | "li">`) is the
 * textbook shape, and in practice it buys exactly one thing: `<li value={n}>`,
 * the HTML attribute that renumbers an item in an ordered list. Nothing in this
 * app renumbers anything, and the generic costs two `as`-casts plus a union of
 * four attribute types to spread, which is more type machinery than the four
 * tags' shared surface justifies.
 *
 * The cost of the simpler type is that a caller cannot pass `value` to an `as="li"`.
 * If a screen ever needs to, this becomes a generic, and the comment above
 * should be updated to say so rather than quietly outlasting the reason.
 */
export type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li";
  /** `raised` lifts off the page; `sunken` presses into it. */
  tone?: "raised" | "sunken";
  /** `bordered` is the default; `plain` is for a surface inside another one. */
  border?: "bordered" | "plain";
  /** `pane` is the standard inset; `tight` is for a list row. */
  padding?: "pane" | "tight" | "none";
  children: ReactNode;
};

const TONES = {
  raised: "bg-surface-raised",
  sunken: "bg-surface-sunken",
} as const;

const BORDERS = {
  bordered: "border border-border",
  plain: "border border-transparent",
} as const;

const PADDINGS = {
  pane: "p-pane",
  tight: "px-4 py-3",
  none: "",
} as const;

export function Surface({
  as: Tag = "div",
  tone = "raised",
  border = "bordered",
  padding = "pane",
  className,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <Tag
      className={cx("rounded-lg", TONES[tone], BORDERS[border], PADDINGS[padding], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Text for assistive technology only.
 *
 * This exists because of a specific recurring need rather than as a utility to
 * have. An icon-only control needs an accessible name, and the accessible name
 * should be the word — "Delete", "Loading members" — not the word plus a
 * description of the icon. The visible label is set to `aria-hidden` and this
 * carries the real one.
 *
 * The 1px clip is the standard technique and it is not optional: `display: none`
 * and `visibility: hidden` remove the text from the accessibility tree, which
 * defeats the entire purpose. Clipping to a 1px box keeps it readable by a
 * screen reader and invisible on screen.
 */
export function VisuallyHidden({
  children,
  as: Tag = "span",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "span" | "div" | "p"; children: ReactNode }) {
  return (
    <Tag
      className={cx(
        "absolute size-px overflow-hidden",
        "[clip-path:inset(50%)] whitespace-nowrap",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
