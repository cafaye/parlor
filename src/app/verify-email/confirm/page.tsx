import type { Metadata } from "next";

import { VerifyEmailConfirmForm } from "./verify-email-confirm-form";

export const metadata: Metadata = {
  title: "Verify your email · parlor",
  // A verification link is followed from an email and its query string carries a
  // live credential. Indexing it would publish that credential to a search engine,
  // so the same answer the reset and invitation pages give.
  robots: { index: false, follow: false },
};

/**
 * `/verify-email/confirm` — spending an emailed verification link.
 *
 * A server component that awaits `searchParams` and hands the token down. The
 * query parameter is read HERE and nowhere else, so there is exactly one place
 * that knows what the link carries.
 *
 * **The parameter is `token`,** which is what every `RECOVERY_LINK_TEMPLATE`
 * example in identity spells, rendered by `internal/courier`'s `LinkTemplate`
 * for a `verify_email` message. It is deployment configuration rather than
 * something the service fixes, which is why a link with no `token` is a rendered
 * state in the client screen and not an exception thrown here.
 *
 * `searchParams` is typed explicitly rather than with Next 16's generated
 * `PageProps`: that global only exists after `next build` has written
 * `.next/types`, and `npm run typecheck` has to pass on a fresh clone. Same rule
 * as the reset and invitation pages.
 */
export default async function VerifyEmailConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  // A repeated parameter arrives as an array. `URLSearchParams.get` takes the
  // first, and so does this — a link with `?token=a&token=b` is malformed and the
  // service would answer 404 for either value.
  const token = typeof raw === "string" ? raw : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
          <p className="text-sm text-muted">
            Confirming your address does not change your password or sign you out.
          </p>
        </div>
        <VerifyEmailConfirmForm token={token ?? null} />
      </div>
    </main>
  );
}