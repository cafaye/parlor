"use client";

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AccountSelect } from "@/app/billing/account-select";
import { useBilling, useBillingReady } from "@/lib/billing-context";
import { BILLING_NOT_CONFIGURED_CODE } from "@/lib/billing";
import type { Plan, PlanEntitlements } from "@/lib/billing";
import { formatMoney } from "@/lib/money";

/**
 * `/billing/plans` — the catalogue, and the door into checkout.
 *
 * Everything here reads a route the forwarder carries and links to a route it
 * carries. A plan that cannot be bought — withdrawn, or with no processor
 * price — renders as a price with no button, because "Buy" on a plan billing
 * would refuse is a promise the service cannot keep.
 */
export function PlansScreen({ account = null }: { account?: string | null }) {
  const billing = useBilling();
  const ready = useBillingReady();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    billing
      .listPlans({ limit: 100 })
      .then((page) => {
        if (live) {
          setPlans(page.data.filter((plan) => plan.active));
          // A load that answered is what clears an earlier failure: without
          // this, one transient error kept the screen an error screen even
          // after the data was there (measured on the launch stack, 2026-10-16).
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (live) setError(failureCopy(cause));
      });
    return () => {
      live = false;
    };
  }, [billing, ready]);

  if (error) return <Notice description={error} />;
  if (plans === null) return <Notice description="Loading plans..." />;
  if (plans.length === 0) return <Notice description="No plans are on sale right now." />;

  return (
    <>
      {/* The account the money is for, chosen here and carried by the URL
          into checkout and every billing call after it. */}
      <AccountSelect selected={account} />
      <ul className="flex flex-col gap-4">
      {plans.map((plan) => (
        <li key={plan.id} className="rounded-lg border border-border p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
            <p className="font-mono text-sm">
              {formatMoney(plan.price)} / {intervalLabel(plan.interval)}
            </p>
          </div>
          {entitlementLines(plan.entitlements).map((line) => (
            <p key={line} className="mt-1 text-sm text-muted">
              {line}
            </p>
          ))}
          {plan.trial_days > 0 && (
            <p className="mt-1 text-sm text-muted">{plan.trial_days}-day trial</p>
          )}
          <div className="mt-4">
            {plan.processor_price_id ? (
              <Link
                to="/billing/checkout"
                // The account rides the link: a checkout started from a
                // team-account page must bill that team, and the URL is where
                // that choice lives.
                search={account ? { plan: plan.slug, account } : { plan: plan.slug }}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium"
              >
                Subscribe
              </Link>
            ) : (
              <p className="text-sm text-muted">Not on sale yet.</p>
            )}
          </div>
        </li>
        ))}
      </ul>
    </>
  );
}

/** What the plan grants, as the lines a pricing page shows. */
function entitlementLines(entitlements: PlanEntitlements) {
  const lines = [...entitlements.features];
  for (const [name, count] of Object.entries(entitlements.limits ?? {})) {
    lines.push(`Up to ${count} ${name}`);
  }
  return lines;
}

function intervalLabel(interval: string): string {
  if (interval === "one_time") return "once";
  return interval === "year" ? "year" : "month";
}



/**
 * A failure in this app's own words.
 *
 * An unconfigured deployment is the launch-deploy shape, not a broken one, so
 * it gets its own sentence — the same distinction `BillingProvider`'s comment
 * makes and the same code `src/lib/upstream.ts` answers with.
 */
function failureCopy(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  if (code === BILLING_NOT_CONFIGURED_CODE) {
    return "Billing is not configured in this deployment, so there is nothing to browse.";
  }
  return "Billing could not be reached, so the plans could not be loaded.";
}

function Notice({ description }: { description: string }) {
  return (
    <p className="rounded-lg border border-border p-5 text-sm text-muted" role="status">
      {description}
    </p>
  );
}
