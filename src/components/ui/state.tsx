import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";
import { roleLabel, type Role } from "@/lib/roles";

/**
 * The states every async screen has to render, and the containers they sit in.
 *
 * They are here rather than in each screen because they are the parts that are
 * easy to leave out and expensive to leave out. A loading state that announces
 * nothing and an error that is not a live region are the two failures a person
 * experiences as "this page is broken" with no way to say so, and a section
 * with no name is a section a screen reader cannot navigate to.
 */

/**
 * "We are fetching."
 *
 * `role="status"` and not `role="alert"`: nothing has gone wrong, and
 * interrupting whatever the person was reading to announce a fetch that will
 * finish in a moment is the wrong urgency. The label is required, because a
 * spinner with no accessible name is a silent pause that looks exactly like a
 * hung page.
 */
export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <p className={cx("text-sm text-muted", className)} role="status">
      {label}
    </p>
  );
}

/**
 * "It did not work, and here is what you can do about it."
 *
 * The retry is a real button with a real name rather than a click handler on
 * the container, so it is reachable by keyboard and findable by name — and so
 * the accessible name does not change when it becomes busy. A caller passes a
 * plain sentence for `title`: this component never invents copy about a failure
 * it cannot see, because the service's own `detail` is where a host or an
 * internal class would come from.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = "Try again",
}: {
  title: string;
  detail?: string;
  onRetry(): void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-md border border-critical/40 bg-critical/5 px-3 py-3" role="alert">
      <p className="text-sm font-medium text-critical">{title}</p>
      {detail ? (
        <p className="mt-1 text-sm text-muted" data-testid="error-detail">
          {detail}
        </p>
      ) : null}
      <button
        className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
        onClick={onRetry}
        type="button"
      >
        {retryLabel}
      </button>
    </div>
  );
}

/**
 * "There is nothing here, and that is a fine answer."
 *
 * Deliberately not an alert, and deliberately given a heading. An empty list
 * rendered as an empty `<ul>` reads as a failed load; this reads as an answer,
 * and it still names the section it is standing in for.
 */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-md border border-dashed border-border px-4 py-6", className)}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

/**
 * A titled section that is a navigable landmark.
 *
 * A heading on its own is not a landmark — `role="region"` with `aria-labelledby`
 * pointing at the heading is, and that is what lets somebody jump to "Members"
 * rather than read down to it. The heading keeps its level so the page still has
 * one `h1` and a real outline; pass `headingId` when something outside the panel
 * needs to reference the heading.
 */
export function Panel({
  title,
  children,
  action,
  headingId,
  className,
  headingLevel = 2,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /**
   * The heading's id, and the region's label.
   *
   * Required rather than optional because an unnamed landmark is worse than no
   * landmark: it shows up in the landmarks list as "region" with nothing after
   * it, which is a dead end for somebody navigating by landmark. Making the
   * caller supply it puts the two halves of the same relationship in the same
   * call, where they cannot get out of step.
   */
  headingId: string;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <section
      aria-labelledby={headingId}
      className={cx("rounded-lg border border-border bg-surface-raised", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Heading
          className={cx("font-medium", headingLevel === 2 ? "text-base" : "text-sm")}
          id={headingId}
        >
          {title}
        </Heading>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** A role, named. The three roles are the only vocabulary a badge has. */
export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border border-border px-2 py-0.5",
        "font-mono text-xs tracking-wide text-muted uppercase",
        className,
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

/** A `dl` of label/value pairs, for the read-only facts on a detail screen. */
export function DescriptionList({
  items,
  className,
}: {
  items: ReadonlyArray<{ term: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cx("grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm", className)}>
      {items.map((item) => (
        <div className="col-span-2 grid grid-cols-subgrid" key={item.term}>
          <dt className="text-muted">{item.term}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain wrapper for a form's fields, so spacing never gets re-decided. */
export function FormStack({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-4", className)} {...rest}>
      {children}
    </div>
  );
}
