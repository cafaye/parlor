import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";
import { roleLabel, type Role } from "@/lib/roles";

import { Button } from "./button";
import { Callout } from "./feedback";
import { Spinner } from "./spinner";

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
 *
 * The spinner is `aria-hidden` and therefore decorative — this sentence is the
 * announcement. Passing `rows` renders skeleton bars for a list-shaped wait,
 * where the shape of what is coming is useful and a sentence is not enough; the
 * skeletons are hidden from assistive technology for the same reason the
 * spinner is.
 */
export function LoadingState({
  label,
  rows = 0,
  className,
}: {
  label: string;
  /** Render this many skeleton rows under the label. 0 is just the label. */
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-3", className)} role="status">
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner />
        {label}
      </p>
      {rows > 0 ? (
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: rows }, (_, index) => (
            <div
              className="h-11 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
              key={index}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "It did not work, and here is what you can do about it."
 *
 * The retry is a real `Button` with a real name rather than a click handler on
 * the container, so it is reachable by keyboard and findable by name — and so
 * the accessible name does not change when it becomes busy.
 *
 * A caller passes a plain sentence for `title`: this component never invents
 * copy about a failure it cannot see, because the service's own `detail` is
 * where a host or an internal class would come from.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = "Try again",
  retrying = false,
}: {
  title: string;
  detail?: string;
  onRetry(): void;
  retryLabel?: string;
  /** The retry is in flight. Spins the button; never renames it. */
  retrying?: boolean;
}) {
  return (
    <Callout
      action={
        <Button busy={retrying} disabled={retrying} onClick={onRetry} size="sm" variant="secondary">
          {retryLabel}
        </Button>
      }
      title={title}
      tone="critical"
    >
      {detail ? <p data-testid="error-detail">{detail}</p> : null}
    </Callout>
  );
}

/**
 * "There is nothing here, and that is a fine answer."
 *
 * Deliberately not an alert, and deliberately given a heading. An empty list
 * rendered as an empty `<ul>` reads as a failed load; this reads as an answer,
 * and it still names the section it is standing in for.
 *
 * The dashed border is the one place in the system where a border is a
 * statement rather than an edge. Everywhere else a hairline separates; here it
 * says "nothing is inside this", and a dashed line says that in a shape
 * language that already has one.
 */
export function EmptyState({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
  /** An escape hatch. Rendered under the body, not in place of it. */
  action?: ReactNode;
}) {
  return (
    <div className={cx("rounded-md border border-dashed border-border px-4 py-6", className)}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-3 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A titled section that is a navigable landmark.
 *
 * A heading on its own is not a landmark — `role="region"` with
 * `aria-labelledby` pointing at the heading is, and that is what lets somebody
 * jump to "Members" rather than read down to it. The heading keeps its level so
 * the page still has one `h1` and a real outline; pass `headingId` when
 * something outside the panel needs to reference the heading.
 *
 * No shadow. A panel sits on paper with a hairline, which is what the metaphor
 * asks for and what stops a screen of five panels turning into a pile of
 * cards. The one elevation in the system is the dialog, which genuinely floats.
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

/**
 * A role, named.
 *
 * The three roles are the only vocabulary a badge has, and the badge is a
 * `role="status"`-free plain span: a role is a fact about a thing, not an
 * event, so there is nothing to announce. `aria-label` is not needed because
 * the text IS the name — `roleLabel` returns the word, not the enum, which is
 * the entire reason this component exists rather than a caller writing
 * `{member.role}` into a pill.
 */
export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border border-border-strong px-2 py-0.5",
        "font-mono text-xs tracking-wide text-muted uppercase",
        className,
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

/**
 * A `dl` of label/value pairs, for the read-only facts on a detail screen.
 *
 * `subgrid` so the term column lines up across rows without this component
 * measuring anything: a fact list whose labels are ragged is a fact list
 * nobody can scan down. The values take `tabular-nums` because every value in
 * this app is either a count, a date or an amount, and three of those in a
 * column that jitters as they change is the wrong kind of alive.
 */
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
          <dd className="min-w-0 break-words tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A plain wrapper for a form's fields, so spacing never gets re-decided.
 *
 * `gap-form` rather than a `gap-4` literal: the gap between two fields in a
 * form is a decision the design system has already made, and the reason it was
 * made is that this value appeared in almost every screen and was written out
 * eight times.
 */
export function FormStack({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-form", className)} {...rest}>
      {children}
    </div>
  );
}
