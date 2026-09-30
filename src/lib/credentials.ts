/**
 * What to check before asking the service.
 *
 * The service decides all of this. These checks exist so a person finds out
 * before pressing a button, and so an empty form from a bot does not become a
 * request — not to replace the service's own answers, which are still the ones
 * that get shown when they arrive.
 *
 * Registration and sign in are checked differently on purpose. Registration
 * can refuse a short password because it is the moment the password is being
 * set. Sign in cannot: refusing to *send* a short password would lock out
 * anyone whose password predates the rule, and the only thing a sign-in screen
 * has to decide is whether these two fields are worth a round trip.
 */

import { MIN_PASSWORD_LENGTH, type Credentials, type FieldError } from "@/lib/identity";

/** Rules for `POST /v1/users`. */
export function validateRegistration({ email, password }: Credentials): FieldError[] {
  const failures: FieldError[] = [];

  const address = checkEmail(email);
  if (address) failures.push(address);

  if (password === "") failures.push({ field: "password", code: "required" });
  else if (password.length < MIN_PASSWORD_LENGTH) {
    failures.push({ field: "password", code: "too_short" });
  }

  return failures;
}

/** Rules for `POST /v1/session`. Password length is the service's business. */
export function validateSignIn({ email, password }: Credentials): FieldError[] {
  const failures: FieldError[] = [];

  const address = checkEmail(email);
  if (address) failures.push(address);

  if (password === "") failures.push({ field: "password", code: "required" });

  return failures;
}

function checkEmail(email: string): FieldError | null {
  const trimmed = email.trim();
  if (trimmed === "") return { field: "email", code: "required" };
  if (!looksLikeEmail(trimmed)) return { field: "email", code: "invalid_format" };
  return null;
}

/**
 * Shape, not deliverability. One `@`, something either side, a dot in the
 * domain, no whitespace — enough to catch a typo and to not be the only thing
 * between a bot and the service's own validator. Deliberately looser than the
 * service's pattern: this rejects the obvious mistakes and lets the service
 * reject the rest, in its words.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}
