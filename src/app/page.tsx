import Link from "next/link";

/**
 * Landing placeholder.
 *
 * Phase 1 scope only: brand text plus the two health surfaces. Real screens
 * (signup, dashboard, settings, team) arrive in Phase 2 — see AGENTS.md.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="font-mono text-xs tracking-[0.2em] text-cafaye-600 uppercase dark:text-cafaye-400">
        cafaye
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">parlor</h1>
      <p className="max-w-prose text-pretty text-muted">
        The cafaye app shell: layout primitives, theme tokens, health surfaces
        and a test rig. You own the code — clone it, read it, change it, ship
        it. No lock-in, no black box.
      </p>
      <p className="font-mono text-sm">
        <Link className="underline hover:no-underline" href="/healthz">
          /healthz
        </Link>{" "}
        <span className="text-muted">·</span>{" "}
        <Link className="underline hover:no-underline" href="/readyz">
          /readyz
        </Link>
      </p>
    </main>
  );
}
