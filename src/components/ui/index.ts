/**
 * cafaye's design system.
 *
 * One component per file, named export, re-exported here, so a screen has one
 * import path and never two ways to reach the same button.
 *
 * ---------------------------------------------------------------------------
 * RE-EXPORTING A CLIENT COMPONENT FROM A BARREL HAS A COST, SO KNOW IT
 * ---------------------------------------------------------------------------
 * Most of what is re-exported here is hook-free and renders as a Server
 * Component. `ConfirmDialog` is not: it carries `"use client"` in its own file
 * because it uses hooks. Importing it from `@/components/ui` still works, and
 * still gives you only the dialog — a `"use client"` boundary ends at the
 * importing module's own frame of reference, so it does not drag the rest of
 * this barrel across with it.
 *
 * That is exactly why `Callout` had to be split out of `feedback.tsx` rather
 * than that whole file being marked `"use client"`: the split is what lets a
 * Server Component reach `Callout` through this barrel without paying for a
 * client bundle. Keep the two in one file again and the barrel starts lying
 * about what is free.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE OURS, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * The Button, Input, Field, Select and the state components were hand-rolled
 * for the auth screens and are now a designed system. This file used to
 * describe itself as a staging post for a shadcn/ui install; it is not one, and
 * that description was the wrong shape for the first thing a product developer
 * reads.
 *
 * Every value in here is a token from `src/styles/tokens.css`. No component
 * hardcodes a colour, and `src/styles/tokens.test.ts` walks this directory to
 * keep it that way.
 *
 * `docs/design-system.md` is the guide: which component to reach for, what the
 * variants mean, and what is deliberately not here.
 */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export { Field, FieldSummary, type FieldProps } from "./field";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
export { Callout, type CalloutTone } from "./feedback";
export { Input, type InputProps } from "./input";
export {
  CardLink,
  linkClasses,
  TextLink,
  type CardLinkProps,
  type TextLinkProps,
} from "./link";
export { Spinner } from "./spinner";
export {
  DescriptionList,
  EmptyState,
  ErrorState,
  FormStack,
  LoadingState,
  Panel,
  RoleBadge,
} from "./state";
export { Select, type SelectProps } from "./select";
export { Surface, VisuallyHidden, type SurfaceProps } from "./surface";
