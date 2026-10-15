"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useBilling } from "@/lib/billing-context";
import { BILLING_NOT_CONFIGURED_CODE } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import type { Entitlements, InvoicePreview, PaymentMethodUrl, Plan, Subscription } from "@/lib/billing";

/**
 * `/billing/subscriptions` — what this account is paying for, and the four
 * things a subscriber does about it.
 *
 * Every action here calls a route the forwarder carries, and none of them
 * claims state this service does not own: cancelling asks the processor and
 * returns, changing a plan asks the processor and returns, and the row moves
 * when the processor's webhook says it did. The one thing this screen may say
 * plainly is what the processor already said — the status on the row.
 */
export function SubscriptionsScreen() {
  const billing = useBilling();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(() => {
    billing
      .listSubscriptions({ limit: 100 })
      .then((page) => setSubscriptions(page.data))
      .catch((cause: unknown) => setFailure(failureCopy(cause)));
  }, [billing]);

  useEffect(load, [load]);

  if (failure) return <Notice description={failure} />;
  if (subscriptions === null) return <Notice description="Loading subscriptions..." />;
  if (subscriptions.length === 0) {
    return (
      <Notice description="This account has no subscription yet. The pricing page lists what is on sale." />
    );
  }

  return (
    <ul className="flex flex-col gap-6">
      {subscriptions.map((subscription) => (
        <li key={subscription.id}>
          <SubscriptionRow subscription={subscription} onChange={load} />
        </li>
      ))}
    </ul>
  );
}

/** One subscription: its state, its facts, and the actions its status allows. */
function SubscriptionRow({ subscription, onChange }: { subscription: Subscription; onChange: () => void }) {
  const billing = useBilling();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [invoice, setInvoice] = useState<InvoicePreview | null>(null);
  const [portal, setPortal] = useState<PaymentMethodUrl | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = subscription.status !== "canceled";

  useEffect(() => {
    if (!live) return;
    billing
      .getEntitlements(subscription.id)
      .then(setEntitlements)
      .catch(() => null);
    if (plans.length === 0) {
      billing
        .listPlans({ limit: 100 })
        .then((page) => setPlans(page.data.filter((plan) => plan.active)))
        .catch(() => null);
    }
  }, [billing, subscription.id, live, plans.length]);

  async function act(what: "cancel" | "resume" | "change", planId?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (what === "cancel") {
        await billing.cancelSubscription(subscription.id, { at_period_end: true });
        // The row has not moved: the processor cancels at the period end and
        // the webhook that follows moves this status. Saying "canceled" here
        // would be a claim about a state this service does not own.
        setMessage("Cancellation requested. The subscription stays active until the period ends.");
      } else if (what === "change" && planId) {
        await billing.changeSubscriptionPlan(subscription.id, { plan_id: planId });
        setMessage("Plan change requested. The new plan takes effect when the processor confirms it.");
      }
      onChange();
    } catch {
      setError("The payment processor refused that. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      // An absolute URL on this origin, the same shape the checkout sends as
      // `success_url`: the processor redirects the browser here afterwards and
      // refuses a relative path (`Not a valid URL` — measured against the live
      // API, 2026-10-16, where the portal could never open).
      const origin = window.location.origin;
      setPortal(await billing.createPaymentMethodUrl(subscription.id, { return_url: `${origin}/billing/subscriptions` }));
    } catch {
      setError("The payment portal could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      setInvoice(await billing.getUpcomingInvoice(subscription.id));
    } catch {
      setError("The next invoice could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{subscription.plan_slug}</h2>
        <p className="font-mono text-xs uppercase tracking-wide text-muted">{subscription.status}</p>
      </div>
      {/* No interval here: a subscription does not have one of its own — the
          plan's cadence is the plan's fact, and a screen that guessed "per
          month" from a price would be inventing a billing period. */}
      <p className="text-sm text-muted">
        {formatMoney(subscription.price)}
        {subscription.cancel_at_period_end ? " · cancels at the end of the period" : ""}
      </p>

      {entitlements?.granted && entitlements.features.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {entitlements.features.map((feature) => (
            <li key={feature} className="rounded-full border border-border px-2 py-0.5 text-xs">
              {feature}
            </li>
          ))}
        </ul>
      )}

      {message && <p className="text-sm" role="status">{message}</p>}
      {error && <p className="text-sm" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {live && (
          <>
            <button
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void act("cancel")}
              type="button"
            >
              Cancel at period end
            </button>
            <button
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void openPortal()}
              type="button"
            >
              Update payment method
            </button>
            <button
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void preview()}
              type="button"
            >
              Show next invoice
            </button>
          </>
        )}
      </div>

      {live && plans.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor={`plan-${subscription.id}`}>
            Change plan
          </label>
          <select
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            disabled={busy}
            id={`plan-${subscription.id}`}
            onChange={(event) => void act("change", event.target.value)}
            value=""
          >
            <option value="">Choose a plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {formatMoney(plan.price)}
              </option>
            ))}
          </select>
        </div>
      )}

      {portal && (
        <a className="text-sm underline" href={portal.payment_method_url} rel="noreferrer">
          Open the payment portal
        </a>
      )}

      {invoice && (
        <table className="w-full text-sm">
          <caption className="pb-2 text-left text-muted">
            Next invoice, {new Date(invoice.period_end).toLocaleDateString()}
          </caption>
          <tbody>
            {invoice.line_items.map((line) => (
              <tr key={line.description}>
                <td className="py-0.5">{line.description}</td>
                <td className="py-0.5 text-right">
                  {formatMoney({ amount_minor: line.amount, currency: line.currency })}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-0.5">Subtotal</td>
              <td className="py-0.5 text-right">
                {formatMoney({ amount_minor: invoice.subtotal, currency: invoice.currency })}
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Tax</td>
              <td className="py-0.5 text-right">
                {formatMoney({ amount_minor: invoice.tax, currency: invoice.currency })}
              </td>
            </tr>
            <tr className="font-semibold">
              <td className="py-0.5">Total</td>
              <td className="py-0.5 text-right">
                {formatMoney({ amount_minor: invoice.total, currency: invoice.currency })}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="text-xs text-muted">
        <Link className="underline" to="/billing/charges">
          See every charge
        </Link>
      </p>
    </article>
  );
}

function failureCopy(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  if (code === BILLING_NOT_CONFIGURED_CODE) {
    return "Billing is not configured in this deployment, so there is no subscription to show.";
  }
  return "Billing could not be reached, so the subscriptions could not be loaded.";
}

function Notice({ description }: { description: string }) {
  return (
    <p className="rounded-lg border border-border p-5 text-sm text-muted" role="status">
      {description}
    </p>
  );
}


