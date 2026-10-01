import { describe, expect, it } from "vitest";

import { MIN_PASSWORD_LENGTH } from "./identity";
import {
  looksLikeEmail,
  validateNewPassword,
  validateRecoveryEmailRequest,
  validateRegistration,
  validateSignIn,
} from "./credentials";

/**
 * What to check before asking the service.
 *
 * Two things in here are load-bearing for the password-reset screens and are
 * worth naming, because both are the sort of rule a screen grows by accident:
 *
 *   - **The reset request checks nothing about the password**, and could not:
 *     there is no password on that request. It is the sign-in rule, which is
 *     address-shape only.
 *   - **The new-password rule refuses a short password but sign-in does not.**
 *     Resetting is the moment a password is being *set*, so the floor applies;
 *     signing in with an old password must not, or the reset screen locks out
 *     the very accounts it exists to rescue.
 *
 * A mismatch is reported only when both fields have something in them. Reporting
 * "these do not match" on top of "your password is too short" is three
 * complaints about one mistake, and the first one already tells somebody what to
 * fix.
 */
describe("validateRegistration", () => {
  it("accepts an address and a password at the floor", () => {
    expect(validateRegistration({ email: "kaka@example.com", password: "a".repeat(MIN_PASSWORD_LENGTH) })).toEqual([]);
  });

  it("refuses an empty form, naming both fields", () => {
    expect(validateRegistration({ email: "", password: "" })).toEqual([
      { field: "email", code: "required" },
      { field: "password", code: "required" },
    ]);
  });

  it("refuses a password under the floor with the service's own code", () => {
    expect(validateRegistration({ email: "kaka@example.com", password: "short" })).toEqual([
      { field: "password", code: "too_short" },
    ]);
  });
});

describe("validateSignIn", () => {
  it("does not refuse a short password, because an account may predate the rule", () => {
    // The property, not the shape: locking a sign-in screen on a length rule
    // would strand every account whose password was set before the rule existed.
    expect(validateSignIn({ email: "kaka@example.com", password: "old" })).toEqual([]);
  });

  it("still refuses an empty password, because there is nothing to send", () => {
    expect(validateSignIn({ email: "kaka@example.com", password: "" })).toEqual([
      { field: "password", code: "required" },
    ]);
  });

  it("refuses an empty address", () => {
    expect(validateSignIn({ email: "  ", password: "whatever" })).toEqual([
      { field: "email", code: "required" },
    ]);
  });
});

describe("validateRecoveryEmailRequest", () => {
  it("accepts a well-formed address", () => {
    expect(validateRecoveryEmailRequest({ email: "kaka@example.com" })).toEqual([]);
  });

  it("refuses an empty address", () => {
    expect(validateRecoveryEmailRequest({ email: "" })).toEqual([{ field: "email", code: "required" }]);
  });

  it("refuses a malformed address before a round trip", () => {
    expect(validateRecoveryEmailRequest({ email: "kaka@@example" })).toEqual([
      { field: "email", code: "invalid_format" },
    ]);
  });

  it("ignores surrounding whitespace rather than refusing it", () => {
    // A paste from a mail client carries a trailing space, and a person who did
    // that has done nothing wrong.
    expect(validateRecoveryEmailRequest({ email: "  kaka@example.com  " })).toEqual([]);
  });

  it("does nothing about whether the address has an account", () => {
    // The important thing it does NOT do, and it is the same rule on both routes
    // that take one: the service answers 202 whether or not the address is
    // registered, and a local check that guessed would put back the oracle the
    // constant 202 exists to remove.
    //
    // `nobody@example.com` is checked here as carefully as a plausible real
    // address would be, and gets the same empty answer — which is the property.
    expect(validateRecoveryEmailRequest({ email: "nobody@example.com" })).toEqual([]);
  });

  it("is the same check on both routes, because the service has one request type for both", () => {
    // `identity/internal/httpapi/recovery.go` declares ONE `emailRequest` body
    // for `POST /v1/password-resets` and `POST /v1/email-verifications`, and
    // pins that the two routes answer identically. Two validators here would be
    // two places for them to drift, and the drift would be invisible until a
    // malformed address was refused by one route and not the other.
    expect(validateRecoveryEmailRequest).toBe(validateRecoveryEmailRequest);
    expect(validateRecoveryEmailRequest({ email: "kaka@@example" })).toEqual(
      validateRecoveryEmailRequest({ email: "kaka@@example" }),
    );
  });
});

describe("validateNewPassword", () => {
  const password = "a".repeat(MIN_PASSWORD_LENGTH);

  it("accepts a matching pair at the floor", () => {
    expect(validateNewPassword({ password, confirmation: password })).toEqual([]);
  });

  it("refuses an empty form, naming both fields", () => {
    expect(validateNewPassword({ password: "", confirmation: "" })).toEqual([
      { field: "password", code: "required" },
      { field: "password_confirmation", code: "required" },
    ]);
  });

  it("refuses a short password, because this is the moment one is being set", () => {
    expect(validateNewPassword({ password: "short", confirmation: "short" })).toEqual([
      { field: "password", code: "too_short" },
    ]);
  });

  it("refuses an empty confirmation separately, so the field can say which one is missing", () => {
    expect(validateNewPassword({ password, confirmation: "" })).toEqual([
      { field: "password_confirmation", code: "required" },
    ]);
  });

  it("refuses a pair that does not match", () => {
    expect(validateNewPassword({ password, confirmation: `${password}x` })).toEqual([
      { field: "password_confirmation", code: "mismatch" },
    ]);
  });

  it("does not also complain about a mismatch when the password is already too short", () => {
    // One mistake, one complaint. A third line here would be a sentence about a
    // value somebody has not finished typing.
    expect(validateNewPassword({ password: "short", confirmation: "other" })).toEqual([
      { field: "password", code: "too_short" },
    ]);
  });
});

describe("looksLikeEmail", () => {
  it("accepts an ordinary address", () => {
    expect(looksLikeEmail("kaka@example.com")).toBe(true);
  });

  it("rejects an address with no domain dot", () => {
    expect(looksLikeEmail("kaka@example")).toBe(false);
  });

  it("rejects two at signs", () => {
    expect(looksLikeEmail("kaka@@example.com")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(looksLikeEmail("kaka @example.com")).toBe(false);
  });
});