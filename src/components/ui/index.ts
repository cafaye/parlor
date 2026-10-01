/**
 * cafaye's design system.
 *
 * One component per file, named export, re-exported here, so a screen has one
 * import path and never two ways to reach the same button.
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
export { Callout, ConfirmDialog, type CalloutTone, type ConfirmDialogProps } from "./feedback";
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
