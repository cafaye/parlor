/**
 * Layout primitives barrel.
 *
 * One component per file, named export, re-exported here — the convention
 * Phase 1 set up and shadcn/ui will keep when it installs into this directory,
 * so a product never has two import paths for the same button.
 *
 * The Button, Input and Field are hand-rolled for the auth screens; the shadcn
 * CLI is a later packet (AGENTS.md) and will replace them in place, at which
 * point the call sites do not move.
 */
export { Button, type ButtonProps, type ButtonVariant } from "./button";
export { Field, FieldSummary, type FieldProps } from "./field";
export { Input, type InputProps } from "./input";
