"use client";

import { useNavigate } from "@tanstack/react-router";

import { Select } from "@/components/ui/select";
import { useAccounts } from "@/lib/accounts";

/**
 * Which account the money is for.
 *
 * ## What it is, and what it is not
 *
 * A `<select>` of the accounts the caller belongs to, and the choice is the
 * PAGE'S URL — `?account=<uuid>` — which is the only durable selector this app
 * has. Billing calls read that parameter at call time (see
 * `selectedAccountFromUrl` in `src/lib/billing.ts`), the BFF hands it to
 * identity's exchange, and identity verifies the membership before it signs
 * anything. Nothing here interprets the id: identity has already refused any
 * account the caller cannot act in, with the same 404 it gives an account that
 * does not exist, so this component renders what it is given and picks what
 * the person picks.
 *
 * ## Why the default is the personal account, said out loud
 *
 * With no `account` in the URL the exchange acts in the caller's PERSONAL
 * account — the solo buyer's shape, and the total choice a user without a team
 * has. This component shows that account selected so the default is visible
 * rather than implied, and the moment a person picks another one the URL says
 * so and every screen and every request that follows sees the same fact.
 *
 * ## Why a failed account list renders nothing
 *
 * The list comes from identity and a signed-out or unreachable identity is an
 * answer about the session, not about billing: the screens below already have
 * their own degrade states for that, and a selector that reported an identity
 * error would be a second, worse copy of them.
 */
export function AccountSelect({ selected }: { selected: string | null }) {
  const accounts = useAccounts();
  const navigate = useNavigate();

  if (accounts.data === undefined || accounts.data.length === 0) return null;

  const fallback = accounts.data.find((account) => account.personal)?.id ?? "";
  const value = selected ?? fallback;

  return (
    <label className="mb-6 flex items-center gap-3 text-sm">
      <span className="text-muted">Billing for</span>
      <Select
        value={value}
        className="w-auto min-w-48"
        onChange={(event) => {
          const account = event.target.value;
          void navigate({
            to: ".",
            search: (previous: Record<string, unknown>) => ({ ...previous, account }),
          });
        }}
      >
        {accounts.data.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
            {account.personal ? " (personal)" : ""}
          </option>
        ))}
      </Select>
    </label>
  );
}
