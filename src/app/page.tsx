import Link from "next/link";

/**
 * The landing page.
 *
 * A directory rather than a pitch. Every link here goes to a screen that exists
 * in this build, and the two that are deliberately incomplete say so in their
 * own pages rather than being dressed up here: the plan catalogue is a
 * catalogue and not a subscription, because billing has no `/v1/subscriptions`
 * on master.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-[0.2em] text-cafaye-600 uppercase dark:text-cafaye-400">
          cafaye
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">parlor</h1>
        <p className="max-w-prose text-pretty text-muted">
          Accounts, invitations and billing, against the cafaye services&apos; real
          contracts. You own the code — clone it, read it, change it, ship it. No
          lock-in, no black box.
        </p>
      </div>

      <nav aria-label="Sections" className="grid gap-3 sm:grid-cols-2">
        <Card href="/accounts" name="Accounts" body="The accounts you belong to, your role in each, and who else is in them." />
        <Card
          href="/billing/plans"
          name="Plans"
          body="The plan catalogue: what can be bought, at what price, on what cadence."
        />
        <Card
          href="/billing/customers"
          name="Customers"
          body="Billing's customer records, and the identity user or account each is for."
        />
        <Card
          href="/healthz"
          name="Health"
          body="The liveness and readiness probes the platform reads."
        />
      </nav>
    </main>
  );
}

function Card({ href, name, body }: { href: string; name: string; body: string }) {
  return (
    <Link
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised px-4 py-3 hover:border-cafaye-300"
      href={href}
    >
      <span className="font-medium">{name}</span>
      <span className="text-sm text-muted">{body}</span>
    </Link>
  );
}
