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
 *
 * Resetting a password is that moment again, which is why
 * `validateNewPassword` applies the floor and `validateSignIn` does not. The two
 * live in the same file precisely so the difference is visible in one place
 * rather than rediscovered as a bug.
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

/**
 * Rules for the routes that ask for a message to be sent: `POST
 * /v1/password-resets` and `POST /v1/email-verifications`.
 *
 * **ONE validator for both, because the service has one request type for both.**
 * `identity/internal/httpapi/recovery.go` declares a single `emailRequest{Email}`
 * body for the two routes and pins with `TestTheTwoRequestRoutesAnswerIdentically`
 * that they answer identically — so two validators here would be two places for
 * that identity to drift, and the drift would be invisible until a malformed
 * address was refused by one route and accepted by the other. It was called
 * `validatePasswordResetRequest` when only the reset flow existed.
 *
 * THE SAME ADDRESS RULE AS SIGN IN, and there is no more to it: that request
 * carries an address and nothing else, so this is `checkEmail` on its own rather
 * than a new shape. The important thing it does NOT do is anything about whether
 * the address has an account — the service answers 202 either way, and a local
 * check that guessed would put back the oracle the constant 202 exists to remove.
 *
 * **On the verification route this is one rule in two, not one.** That route also
 * declares a 409 for an address that is already proved, so it is the one place
 * the service answers differently about whether an address exists. Nothing here
 * reads that difference — the shape of what was typed is all this can see, and
 * the address's account state is the service's business.
 */
export function validateRecoveryEmailRequest({ email }: { email: string }): FieldError[] {
  const failures: FieldError[] = [];

  const address = checkEmail(email);
  if (address) failures.push(address);

  return failures;
}

/**
 * Rules for `POST /v1/password-resets/confirm`: the new password and its
 * confirmation.
 *
 * **The floor APPLIES HERE AND NOT ON SIGN IN**, which is the whole distinction
 * this file draws and the reason it exists in this shape. Resetting is the moment
 * a password is being set, so `MinPasswordLength` applies to the value somebody
 * is choosing. Signing in is not that moment: an account may predate the rule,
 * and refusing to *send* a short password would lock out the accounts the reset
 * screen exists to rescue. See `validateSignIn` above.
 *
 * **`password_confirmation` is a client-only field.** The service's body is
 * `{token, password}` and it never sees a confirmation, so a mismatch can only be
 * caught here — and `mismatch` is therefore a code this app invents rather than
 * one from the contract. It goes through `fieldErrorMessage` all the same, because
 * that is where a code becomes a sentence and a screen must not write its own.
 *
 * A mismatch is reported only once both fields have something in them. Three
 * complaints about one unfinished form is noise, and the too-short line already
 * says what to fix.
 */
export function validateNewPassword({
  password,
  confirmation,
}: {
  password: string;
  confirmation: string;
}): FieldError[] {
  const failures: FieldError[] = [];

  if (password === "") {
    failures.push({ field: "password", code: "required" });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    failures.push({ field: "password", code: "too_short" });
  }

  if (confirmation === "") {
    failures.push({ field: "password_confirmation", code: "required" });
  } else if (
    failures.length === 0 &&
    password !== "" &&
    confirmation !== password
  ) {
    failures.push({ field: "password_confirmation", code: "mismatch" });
  }

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
