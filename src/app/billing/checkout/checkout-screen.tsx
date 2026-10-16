"use client";

import { useEffect, useState } from "react";
import { useBilling, useBillingReady } from "@/lib/billing-context";
import { useAuth } from "@/lib/auth";
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
export function CheckoutScreen({
  planSlug,
  account = null,
}: {
  planSlug?: string;
  account?: string | null;
}) {
  const billing = useBilling();
  const ready = useBillingReady();
  const { session: authSession } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!planSlug) {
      setFailure("No plan was chosen. Pick one on the pricing page.");
      return;
    }
    // The session gate: a plan read sent before the token is there is a 401
    // wearing the words "that plan could not be read". See `useBillingReady`.
    if (!ready) return;
    let live = true;
    billing
      .getPlanBySlug(planSlug)
      .then((found) => {
        if (live) {
          setPlan(found);
          setFailure(null);
        }
      })
      .catch(() => {
        if (live) setFailure("That plan could not be read, so it cannot be bought.");
      });
    return () => {
      live = false;
    };
  }, [billing, planSlug, ready]);

  async function start() {
    if (!plan) return;
    setBusy(true);
    setFailure(null);
    try {
      // The buyer is this account's customer, resolved rather than chosen:
      // `customers` holds one row per (owner, processor) and the owner is the
      // token's account — which is the account the URL named, because the BFF
      // minted the token for it — so the first row is the caller's own under
      // the account this page is billing for. A body that let a caller name a
      // customer would be a cross-tenant checkout.
      let mine = (await billing.listCustomers()).data[0];
      if (!mine) {
        // A FIRST PURCHASE BY THIS ACCOUNT, and the row has to exist before
        // the processor can be asked for a session. `POST /v1/customers`
        // writes the token's account onto the row — never a body's idea of an
        // owner — so the row belongs to the account this page bills for. No
        // processor customer id: nothing calls Stripe at creation; Stripe
        // makes its own customer at the hosted checkout and the webhook writes
        // the id back through the `customer_reference` the session carries.
        //
        // The email is the signed-in buyer's, because it is where the receipt
        // goes: billing puts it on the event and courier refuses an event with
        // no address, so a row created without it would buy silently.
        mine = await billing.createCustomer({
          processor: "stripe",
          email: authSession.status === "authed" ? authSession.user.email : null,
        });
      }
      // The return URLs are absolute and this app's own: Stripe requires
      // `success_url` on a hosted session, and the page a buyer lands on
      // after paying is this app's subscriptions screen — not a URL the
      // billing service may invent.
      const origin = window.location.origin;
      // THE ACCOUNT RIDES THE RETURN URLS. A buyer who started on a team's
      // checkout must land back on THAT team's subscriptions page — the
      // processor's redirect is a browser navigation, and the URL is the only
      // place the choice survives the round trip through Stripe.
      const carried = account ? `&account=${encodeURIComponent(account)}` : "";
      setSession(
        await billing.startSubscriptionCheckout({
          customer_id: mine.id,
          plan_id: plan.id,
          success_url: `${origin}/billing/subscriptions${account ? `?account=${encodeURIComponent(account)}` : ""}`,
          cancel_url: `${origin}/billing/checkout?plan=${encodeURIComponent(plan.slug)}${carried}`,
        }),
      );
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
        // The click resolves the buyer — and on a first purchase creates the
        // customer with the buyer's own email — so the button waits for the
        // session to be KNOWN rather than racing its answer. A row created a
        // hair too early would carry no address, and courier refuses an event
        // with no address: the purchase would be silent.
        disabled={busy || plan === null || authSession.status === "loading"}
        onClick={() => void start()}
        type="button"
      >
        {busy ? "Starting checkout..." : "Continue to checkout"}
      </button>
    </section>
  );
}


