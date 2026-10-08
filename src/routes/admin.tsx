import { createFileRoute } from "@tanstack/react-router";

import AdminPage from "@/app/admin/page";

/**
 * `/admin` — the system-admin console.
 *
 * A route file is three things: the path, the document metadata, and the
 * component. It is NOT the screen and NOT the gate: the screen is
 * `src/app/admin/page.tsx`, and the staff check is a fresh `operator/me` read
 * inside it — hiding this link or rendering client-side is not authorization,
 * and the route file must not pretend it is.
 */
export const Route = createFileRoute("/admin")({
  component: Admin,
});

function Admin() {
  return <AdminPage />;
}
