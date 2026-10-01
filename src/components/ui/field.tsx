import {
  cloneElement,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cx } from "@/lib/cx";

import { Callout } from "./feedback";

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
 * `aria-describedby` carries BOTH ids when both are present, hint first. That
 * order is the reading order, and it is the order somebody editing a field
 * needs: what this is, then why it is complaining. `FieldSummary` is a
 * different thing — a summary of the form, not of this field.
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
      {/*
        The hint and the error are in a live region together, so a message that
        appears on submit is announced without moving focus. Deliberately NOT
        `aria-live="assertive"`: a field error on a form somebody is working
        through does not need to interrupt, and an assertive region that fires
        on every keystroke is the single most annoying thing a form can do.
        `role="alert"` on the summary is where the urgency lives.
      */}
      {hint || error ? (
        <p aria-live="polite" className="text-sm text-muted">
          {hint ? <span id={hintId}>{hint}</span> : null}
          {hint && error ? " " : null}
          {error ? (
            <span className="text-critical" id={errorId}>
              {error}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The alert region a form reports through: one per form, never per field.
 *
 * A thin wrapper over `Callout`, kept as its own export because every call site
 * in this app already names it and renaming a component in eight screens is not
 * this packet's business. Its default tone is `critical` and its default
 * urgency is assertive — this is the one place in a form that should interrupt,
 * because it is the one place the whole form has failed.
 */
export function FieldSummary({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <Callout className={cx(className)} tone="critical" {...rest}>
      {children}
    </Callout>
  );
}
