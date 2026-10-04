import { VerifyEmailConfirmForm } from "./verify-email-confirm-form";

/**
 * `/verify-email/confirm` — spending an emailed verification link.
 *
 * A page that hands `searchParams` down. The
 * query parameter is read HERE and nowhere else, so there is exactly one place
 * that knows what the link carries.
 *
 * **The parameter is `token`,** which is what every `RECOVERY_LINK_TEMPLATE`
 * example in identity spells, rendered by `internal/courier`'s `LinkTemplate`
 * for a `verify_email` message. It is deployment configuration rather than
 * something the service fixes, which is why a link with no `token` is a rendered
 * state in the client screen and not an exception thrown here.
 *
 * `searchParams` is a plain object rather than a Promise: the route that
 * renders this has already resolved the location, so there is nothing to await.
 * Same rule as the reset page.
 */
export default function VerifyEmailConfirmPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams.token;
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