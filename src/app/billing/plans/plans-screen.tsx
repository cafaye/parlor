"use client";

/**
 * `/billing/plans` — the plan catalogue.
 *
 * A catalogue, and it says so. billing's contract on master has `/v1/plans` and
 * nothing else about pricing: a `Plan` is "what can be bought, at what price,
 * on what cadence", and **nothing on the wire records which plan a customer is
 * on**. There is no `/v1/subscriptions`, and `Customer` carries no plan field.
 *
 * So there is no buy button here. Not a disabled one and not a "coming soon"
 * one: a control that cannot do what it says is worse than no control, and the
 * five subscription states this packet was told to leave to `parlor-04` start
 * with a screen that pretends a subscription exists. When billing-04 lands
 * `/v1/subscriptions*`, this page gains the action, and the catalogue framing
 * moves to a second route.
 *
 * Paging is real, because the contract says so: every collection is
 * `Page { next_cursor, has_more }`, and `next_cursor` is opaque and passed back
 * verbatim. The cursor is never parsed — the contract says its encoding may
 * change without notice.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import { Button, EmptyState, ErrorState, LoadingState, Panel } from "@/components/ui";
import { useBilling } from "@/lib/billing-context";
import { isPlan, type Plan } from "@/lib/billing";
import { formatMoney } from "@/lib/money";

/** Rows per page. The contract caps at 100 and defaults to 25. */
const PAGE_SIZE = 25;

export function PlansScreen() {
  const billing = useBilling();

  // An infinite query rather than a cursor-keyed one, because paging here
  // *accumulates*: page two is more of the catalogue, not a replacement for page
  // one. A key that changed with the cursor and rendered one page at a time
  // would drop the first twenty-five plans the moment somebody asked for more,
  // which is the difference between a catalogue and a page of it.
  const plans = useInfiniteQuery({
    queryKey: ["billing-plans"],
    queryFn: ({ pageParam }) => billing.listPlans({ limit: PAGE_SIZE, order: "asc", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    // `has_more` is the flag to branch on. A non-null cursor is not a
    // substitute: the contract allows a service to send a cursor it will not
    // honour, and "Load more" that 400s forever is worse than no button.
    getNextPageParam: (last) => (last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined),
    // A 5xx gets the explicit "Try again" below rather than a silent backoff the
    // person cannot see or cancel.
    retry: false,
  });

  if (plans.isPending) return <LoadingState label="Loading plans…" />;

  if (plans.isError) {
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => {
          void plans.refetch();
        }}
        title="We could not load the plans."
      />
    );
  }

  const rows = plans.data.pages.flatMap((page) => page.data);

  if (rows.length === 0) {
    return <EmptyState title="No plans">Nothing is published for sale at the moment.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PlanList plans={rows} />

      {plans.hasNextPage ? (
        <div>
          <Button
            aria-busy={plans.isFetchingNextPage}
            busy={plans.isFetchingNextPage}
            disabled={plans.isFetchingNextPage}
            onClick={() => {
              void plans.fetchNextPage();
            }}
            variant="secondary"
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PlanList({ plans }: { plans: Plan[] }) {
  // Checked before rendering rather than trusted: a plan whose price is not
  // integer minor units cannot be shown honestly, and guessing at it is how a
  // catalogue displays a price nobody will be charged.
  const showable = plans.filter(isPlan);
  const broken = plans.length - showable.length;

  return (
    <Panel headingId="plans" title="Available plans">
      <div className="flex flex-col gap-4">
        {broken > 0 ? (
          // Loud, because a silently missing plan is a plan somebody wanted and
          // cannot see. The count is honest rather than the reason, which is
          // not ours to know.
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
            {broken === 1
              ? "One plan could not be shown because the service returned data this app does not recognise."
              : `${broken} plans could not be shown because the service returned data this app does not recognise.`}
          </p>
        ) : null}

        {showable.length === 0 ? null : (
          <ul aria-label="Plans" className="flex flex-col gap-3">
            {showable.map((plan) => (
              <PlanRow key={plan.id} plan={plan} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  return (
    <li
      className={
        plan.active
          ? "flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
          : "flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-3 opacity-60 first:border-t-0 first:pt-0"
      }
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{plan.name}</span>
        <span className="text-xs text-muted">
          {intervalLabel(plan.interval)}
          {plan.trial_days > 0 ? ` · ${plan.trial_days}-day free trial` : null}
          {plan.active ? null : " · no longer available"}
        </span>
      </span>
      <span className="font-mono text-sm">{formatMoney(plan.price)}</span>
    </li>
  );
}

/**
 * "per month" rather than the enum value.
 *
 * The interval is the thing most often misread on a pricing page — a yearly
 * figure read as monthly is the single most expensive mistake available here —
 * so the cadence is stated in words on every row rather than inferred from a
 * column heading that only one row might be under.
 */
function intervalLabel(interval: Plan["interval"]): string {
  switch (interval) {
    case "month":
      return "per month";
    case "year":
      return "per year";
    case "one_time":
      return "one-off";
  }
}
