"use client";

import { useEffect, useState } from "react";

import { useBilling, useBillingReady } from "@/lib/billing-context";
import { BILLING_NOT_CONFIGURED_CODE } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import type { Charge } from "@/lib/billing";

/**
 * `/billing/charges` — this account's money history.
 *
 * The listing is for a program; the receipt is for a person. Each row links to
 * `GET /v1/charges/{id}`, which billing answers as a self-contained HTML
 * document, so the receipt opens as a page a person can print, save or email —
 * and never as JSON this screen would have to render.
 */
export function ChargesScreen() {
  const billing = useBilling();
  const ready = useBillingReady();
  const [charges, setCharges] = useState<Charge[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    billing
      .listCharges({ limit: 100 })
      .then((page) => {
        if (live) {
          setCharges(page.data);
          // An answered load clears an earlier failure — see the sibling in
          // `plans-screen.tsx` for the measured sequence.
          setFailure(null);
        }
      })
      .catch((cause: unknown) => {
        if (live) setFailure(failureCopy(cause));
      });
    return () => {
      live = false;
    };
  }, [billing, ready]);

  if (failure) return <Notice description={failure} />;
  if (charges === null) return <Notice description="Loading charges..." />;
  if (charges.length === 0) return <Notice description="This account has not been charged yet." />;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-1 font-medium">Date</th>
          <th className="py-1 font-medium">Description</th>
          <th className="py-1 text-right font-medium">Amount</th>
          <th className="py-1 font-medium">Receipt</th>
        </tr>
      </thead>
      <tbody>
        {charges.map((charge) => (
          <tr key={charge.id} className="border-t border-border">
            <td className="py-2">{charge.paid_at ? new Date(charge.paid_at).toLocaleDateString() : "—"}</td>
            <td className="py-2">{charge.description ?? "Payment"}</td>
            <td className="py-2 text-right">
              {formatMoney({ amount_minor: charge.amount, currency: charge.currency })}
            </td>
            <td className="py-2">
              {/* The receipt is HTML, so a link and not a fetch: the page is
                  billing's own document, escaped at the source, and re-rendering
                  it here would be a second renderer for one thing. */}
              <a className="underline" href={`/v1/charges/${charge.id}`} rel="noreferrer">
                Receipt
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function failureCopy(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  if (code === BILLING_NOT_CONFIGURED_CODE) {
    return "Billing is not configured in this deployment, so there is no history to show.";
  }
  return "Billing could not be reached, so the charges could not be loaded.";
}

function Notice({ description }: { description: string }) {
  return (
    <p className="rounded-lg border border-border p-5 text-sm text-muted" role="status">
      {description}
    </p>
  );
}
