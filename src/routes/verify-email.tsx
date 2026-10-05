import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * `/verify-email` — a layout, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * THIS BUG CAME FROM `site`, AND IT IS HERE BECAUSE `parlor` GENERATED IT
 * ---------------------------------------------------------------------------
 *
 * `src/routes/verify-email/confirm.tsx` is a CHILD of this route, and this
 * route rendered no `<Outlet/>`. The child's loader ran and the parent painted
 * its own screen over the top, so `/verify-email/confirm?token=...` showed the
 * ask-for-an-address form instead of the screen that spends the token. **The
 * whole point of a verification link is the one thing that page could not do.**
 *
 * This is the same defect, in the same shape, that was found and fixed in
 * `site` (commit `c8b5095`, branch `worker/site-routes-01`). `site` is generated
 * from this repository, so the fix belongs here FIRST — a customer app
 * generated from an unfixed template ships a broken verification link, and
 * every one of them would fail the same way. Fixing it in `site` alone would
 * have patched one instance of a bug this file is the source of.
 *
 * The screens are now siblings: `verify-email.index.tsx` is matched at
 * `/verify-email` and `verify-email/confirm.tsx` at `/verify-email/confirm`,
 * with this layout rendering only the `<Outlet/>`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE UNIT SUITE NEVER CAUGHT IT, WHICH IS THE PART WORTH CARRYING
 * ---------------------------------------------------------------------------
 *
 * Every unit test in this repository renders a component directly rather than
 * resolving a URL to a screen, so a missing `<Outlet/>` is invisible to it *by
 * construction* — not by luck, and not because the tests are weak. A green unit
 * suite here says the screens are correct, and says nothing at all about whether
 * a person can reach one.
 *
 * Only `e2e/email-verification.e2e.spec.ts` navigates to
 * `/verify-email/confirm`, and it was red for exactly this reason: it asserts
 * the confirm screen's own "Verify my email" button, which the parent's form
 * does not have. **When this template ships, that e2e spec is the check that
 * has to run.**
 */
export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailLayout,
});

function VerifyEmailLayout() {
  return <Outlet />;
}
