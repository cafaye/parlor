"use client";

/**
 * The account-scoped read, for a screen over a member-scoped service.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Box's reads are member-scoped PER ACCOUNT: `GET
 * /v1/accounts/{account_id}/boxes` and the email-provider pair take the
 * account id in the path and answer the same 404 upstream for "no such
 * account" and "not a member" — the service's own stance, and not this app's
 * to narrow. A standalone route (`/boxes`, `/email-providers`) has no account
 * id in its path, so it reads the caller's accounts from identity (`GET
 * /v1/accounts`, a route the forwarder has carried since tenancy landed) and
 * asks Box about each one in turn.
 *
 * That is not a convenience and it is not a guess: the union of the reads IS
 * exactly what the caller may see, because a row from an account they do not
 * belong to never arrives. There is no "all accounts" surface here and none
 * is implied — a screen over this hook shows the caller's own rows and
 * nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not merge, sort or invent. Rows arrive in account order, and a
 * screen that needs an account name for a row reads it off the row itself
 * (`ScopedRow.accountName`), which came from the accounts list rather than
 * from a second service. It never caches a credential: nothing in this file
 * knows one exists.
 */

import { useQueries } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { useAccounts } from "./accounts";
import { useAuth } from "./auth";
import { BOX_NOT_CONFIGURED_CODE, BoxError } from "./box";
import type { AccountListItem } from "./identity";

/** One row, with the account it came from. */
export type ScopedRow<T> = {
  accountId: string;
  /** The account's name as the accounts list answered it. */
  accountName: string;
  row: T;
};

export type AccountScopedList<T> = {
  /** True while the accounts list or ANY per-account read is unresolved. */
  loading: boolean;
  rows: ScopedRow<T>[];
  /** The accounts list itself failed. */
  accountsFailed: boolean;
  /** At least one per-account read failed. */
  readFailed: boolean;
  /**
   * This deployment runs no Box. A note, not an error: there is
   * nothing to retry and nothing that went wrong.
   */
  notConfigured: boolean;
  retry: () => void;
};

/**
 * Reads one Box collection across every account the caller belongs to.
 *
 * `key` discriminates the query keys between the two surfaces that use this
 * hook, so a refetch of one does not answer the other's question.
 */
export function useAccountScopedList<T>(
  key: string,
  read: (token: string, accountId: string) => Promise<T[]>,
): AccountScopedList<T> {
  const { token } = useAuth();
  const accounts: UseQueryResult<AccountListItem[]> = useAccounts();
  const accountList = accounts.data ?? [];

  const results = useQueries({
    queries: accountList.map((account) => ({
      queryKey: ["box", key, token, account.id],
      queryFn: () => read(token as string, account.id),
      enabled: token !== null,
      retry: false,
    })),
  });

  const rows: ScopedRow<T>[] = [];
  let readFailed = false;
  let notConfigured = false;

  results.forEach((result, index) => {
    if (result.isError) {
      readFailed = true;
      if (
        result.error instanceof BoxError &&
        result.error.code === BOX_NOT_CONFIGURED_CODE
      ) {
        notConfigured = true;
      }
      return;
    }
    const account = accountList[index];
    for (const row of result.data ?? []) {
      rows.push({ accountId: account.id, accountName: account.name, row });
    }
  });

  return {
    loading: accounts.isPending || results.some((result) => result.isPending),
    rows,
    accountsFailed: accounts.isError,
    readFailed,
    notConfigured,
    retry: () => {
      void accounts.refetch();
      for (const result of results) void result.refetch();
    },
  };
}
