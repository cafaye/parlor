import { AccountScreen } from "./account-screen";

/**
 * `/accounts/[accountId]` — one account.
 *
 * A page that does one thing: take the route parameter and hand the id down. The account's *name* is the natural `h1` and it is not
 * known until the client has asked the service, so the heading is rendered by
 * the screen rather than here — a server component that rendered "Account" and
 * let the client overwrite it would produce two `h1`s on the same page.
 *
 * Params are a plain object for the same reason `searchParams` is on the reset
 * page: the router has already parsed them, and awaiting a resolved value buys
 * a suspension and nothing else.
 */
export default function AccountPage({ params }: { params: { accountId: string } }) {
  const { accountId } = params;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <AccountScreen accountId={accountId} />
    </main>
  );
}
