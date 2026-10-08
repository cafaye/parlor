import { createFileRoute } from "@tanstack/react-router";

import SettingsPage from "@/app/settings/page";

/**
 * `/settings` — the profile screen, version 2.
 *
 * A flat `settings.tsx` rather than a `settings/` directory, because there is
 * exactly one screen here and no sibling to keep beside it; `login.tsx` is the
 * same shape. A directory only earns itself when a second route joins the
 * first, as `accounts/` has with `$accountId`.
 *
 * The screen renders its own signed-out state rather than branching on the
 * session here, so the shell keeps one answer to "is anybody signed in" (see
 * `src/lib/auth.tsx`).
 */
export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · parlor" }] }),
  component: Settings,
});

function Settings() {
  return <SettingsPage />;
}