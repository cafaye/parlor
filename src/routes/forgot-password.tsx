import { createFileRoute } from "@tanstack/react-router";

import ForgotPasswordPage from "@/app/forgot-password/page";

/**
 * `/forgot-password` — asking for a reset link.
 *
 * This route reads no query. That is deliberate and is asserted in
 * `src/app/forgot-password/page.test.tsx`: the page answers identically for a
 * registered address, an unregistered one and one inside the cooldown, so
 * nothing here may read a parameter that could make the answer vary.
 */
export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password · parlor" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  return <ForgotPasswordPage />;
}