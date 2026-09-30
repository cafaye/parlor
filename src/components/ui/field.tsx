import {
  cloneElement,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cx } from "@/lib/cx";

/**
 * Label, hint, control, error — wired together.
 *
 * The three relationships a form field has to state are the easy ones to leave
 * out and the expensive ones to leave out: which control the label names, what
 * extra text describes the control, and whether the control is currently
 * invalid. Doing that by hand at every call site is how a screen reader ends
 * up announcing "Email, edit, invalid" and dropping the reason. So this
 * component owns it: it takes the ids it needs and hands them to the control.
 *
 * The message text is passed in, not derived here. What "too_short" means in
 * English is contract knowledge, and it lives with the contract
 * (`src/lib/identity.ts`).
 */
export type FieldProps = {
  /** Also the control's `id` — this is the join between label and control. */
  id: string;
  label: string;
  /** Always-visible help. Present in the description whether or not it errors. */
  hint?: string;
  /** Replaces nothing, appends: both hint and error describe the control. */
  error?: string;
  /**
   * The control this field labels.
   *
   * An input or a select — the union is here because both are native controls
   * that take the same four attributes, and narrowing it to inputs would push
   * somebody into hand-wiring `aria-describedby` on the next `<select>`, which
   * is the mistake this component exists to prevent.
   */
  children: ReactElement<InputHTMLAttributes<HTMLInputElement> | SelectHTMLAttributes<HTMLSelectElement>>;
};

export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p className="text-sm text-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-critical" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The alert region a form reports through: one per form, never per field. */
export function FieldSummary({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cx("rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-sm", className)}
      role="alert"
      {...rest}
    >
      {children}
    </div>
  );
}
