/**
 * Money, at the wire and on a screen.
 *
 * billing's contract is explicit about the boundary it will not cross: "an
 * amount crosses a boundary as integer minor units plus a currency, never as a
 * decimal and never as a float", and "a decimal here — as a number or as a
 * string — is a 422: a float cannot represent 0.10 exactly, so it never carries
 * an amount".
 *
 * So `Money` is a whole number of minor units and a currency code, and the only
 * place a decimal exists in this whole codebase is inside `formatMoney`, at the
 * last moment before the number reaches a person. Everything upstream of that is
 * exact, which is why nothing here rounds and nothing here can drift.
 */

/**
 * An amount in integer minor units.
 *
 * `amount_minor` is a `number` because that is what JSON.parse produces, and it
 * is checked rather than trusted: `isMoney` is what stands between a response
 * and a screen, and it refuses a decimal, a string, or a negative.
 */
export type Money = {
  /** A whole number of minor units: 1900 is nineteen units of a cent currency. */
  readonly amount_minor: number;
  /** ISO 4217, stored and returned upper case. */
  readonly currency: string;
};

const CURRENCY = /^[A-Z]{3}$/;

/**
 * Whether an untrusted value is a `Money` the schema would have accepted.
 *
 * Written as a runtime check rather than a cast because the values arrive from
 * `response.json()` and a type annotation is a promise rather than a check. The
 * service would 422 a decimal on the way in, so it is not supposed to send one
 * on the way out — but "not supposed to" is exactly what this guards.
 */
export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.amount_minor === "number" &&
    Number.isInteger(record.amount_minor) &&
    record.amount_minor >= 0 &&
    typeof record.currency === "string" &&
    CURRENCY.test(record.currency)
  );
}

/**
 * Renders an amount for a person.
 *
 * The number of minor units per unit is read from the platform's own currency
 * data, through `Intl.NumberFormat`, rather than from a constant. That matters
 * for every currency whose minor unit is not a hundred: JPY has none, so 1900
 * is ¥1,900 and not ¥19.00; KWD has three, so 12,345 is 12.345 and not 123.45.
 * A hand-written exponent table would be a second source of truth that has to be
 * kept in step with a list of 180 currencies, and would be wrong the day a
 * currency is redenominated.
 *
 * The division happens here and nowhere else. `Intl` also does the grouping and
 * the symbol placement, so a de-DE locale gets "12.500,00 $" without this file
 * knowing anything about German.
 */
export function formatMoney(money: Money, locale = "en-GB"): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  });

  // `resolvedOptions` is the only public way to ask a formatter what its
  // currency's exponent is, and it is the same answer the formatter will use.
  // TypeScript types the field as optional because a runtime that omits it
  // exists, so the fallback is ISO 4217's own default exponent rather than a
  // number chosen here — a currency with no data is formatted as the contract's
  // default, not as something this file decided.
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const perUnit = 10 ** digits;

  return formatter.format(money.amount_minor / perUnit);
}
