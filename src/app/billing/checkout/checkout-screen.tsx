"use client";

import { useEffect, useState } from "react";
import { useBilling } from "@/lib/billing-context";
import type { CheckoutSession, Plan } from "@/lib/billing";
import { formatMoney } from "@/lib/money";

/**
 * `/billing/checkout` — from a plan to a hosted Checkout session.
 *
 * The plan arrives as a **slug**, because that is the handle the pricing page
 * links with and the one the service reads by; the id goes in the POST body,
 * and the plan read supplies it. A checkout that built the body from a
 * guessed id would be a checkout for a plan the caller did not choose.
 *
 * The production door writes nothing: `POST /v1/subscriptions` returns the
 * processor's own session and no subscription exists yet. So this screen's
 * job is to hand the buyer over and **not** to say "you are subscribed" — the
 * subscription appears when the processor's webhook says one does, which is
 * the next page's news rather than this one's. That is why the success state
 * is a link to the processor and not a confirmation.
 */
export function CheckoutScreen({ planSlug }: { planSlug?: string }) {
  const billing = useBilling();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!planSlug) {
      setFailure("No plan was chosen. Pick one on the pricing page.");
      return;
    }
    let live = true;
    billing
      .getPlanBySlug(planSlug)
      .then((found) => {
        if (live) setPlan(found);
      })
      .catch(() => {
        if (live) setFailure("That plan could not be read, so it cannot be bought.");
      });
    return () => {
      live = false;
    };
  }, [billing, planSlug]);

  async function start() {
    if (!plan) return;
    setBusy(true);
    setFailure(null);
    try {
      // The buyer is this account's customer, resolved rather than chosen:
      // `customers` holds one row per (owner, processor) and the owner is the
      // token's account, so the first row is the caller's own. A body that let
      // a caller name a customer would be a cross-tenant checkout.
      const mine = (await billing.listCustomers()).data[0];
      if (!mine) {
        setFailure("This account has no billing customer yet, so there is nobody to bill.");
        return;
      }
      setSession(await billing.startSubscriptionCheckout({ customer_id: mine.id, plan_id: plan.id }));
    } catch {
      setFailure("The checkout could not be started. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold tracking-tight">Continue to the payment page</h2>
        <p className="text-sm text-muted">
          The payment is collected by the payment processor. Your subscription appears on the
          subscriptions page once the processor confirms it, which is normally a few seconds.
        </p>
        <a
          className="self-start rounded-md border border-border px-4 py-2 text-sm font-medium"
          href={session.checkout_url}
          rel="noreferrer"
        >
          Open the payment page
        </a>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-6">
      <h2 className="text-lg font-semibold tracking-tight">Subscribe</h2>
      {plan && (
        <p className="text-sm text-muted">
          {plan.name} · {formatMoney(plan.price)} per {plan.interval === "one_time" ? "one-time purchase" : plan.interval}
          {plan.trial_days > 0 ? ` · ${plan.trial_days}-day trial` : ""}
        </p>
      )}
      {failure && (
        <p className="text-sm" role="alert">
          {failure}
        </p>
      )}
      <button
        className="self-start rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        disabled={busy || plan === null}
        onClick={() => void start()}
        type="button"
      >
        {busy ? "Starting checkout..." : "Continue to checkout"}
      </button>
    </section>
  );
}


