import { describe, expect, it } from "vitest";

import { formatMoney, isMoney, type Money } from "./money";

/**
 * Money on the wire, and money on a screen.
 *
 * billing's contract is explicit about the boundary: "an amount crosses a
 * boundary as integer minor units plus a currency, never as a decimal and never
 * as a float", and "a decimal here — as a number or as a string — is a 422: a
 * float cannot represent 0.10 exactly, so it never carries an amount".
 *
 * So the type is two integers-as-one and a currency code, and the only place a
 * decimal exists is inside `formatMoney`, at the last moment before it reaches
 * a person. Everything upstream of that is exact.
 */

describe("isMoney", () => {
  it("accepts what the schema declares", () => {
    expect(isMoney({ amount_minor: 1900, currency: "USD" })).toBe(true);
    expect(isMoney({ amount_minor: 0, currency: "EUR" })).toBe(true);
  });

  it("refuses a decimal amount, which the service would 422", () => {
    // The refusal matters more than it looks: `1900.5` would format as a
    // plausible-looking price that is not the price charged.
    expect(isMoney({ amount_minor: 1900.5, currency: "USD" })).toBe(false);
  });

  it("refuses an amount sent as a string", () => {
    // The contract says a decimal "as a number or as a string" is a 422, and
    // `"1900"` is the shape a JSON library produces for a big integer.
    expect(isMoney({ amount_minor: "1900", currency: "USD" })).toBe(false);
  });

  it("refuses a negative amount, which the schema forbids", () => {
    expect(isMoney({ amount_minor: -100, currency: "USD" })).toBe(false);
  });

  it("refuses a currency that is not three upper-case letters", () => {
    expect(isMoney({ amount_minor: 100, currency: "usd" })).toBe(false);
    expect(isMoney({ amount_minor: 100, currency: "DOLLARS" })).toBe(false);
  });
});

describe("formatMoney", () => {
  const usd = (amount_minor: number): Money => ({ amount_minor, currency: "USD" });

  // The assertions below pin the *digits*, not the symbol. Which glyph Node
  // picks for a currency depends on the locale and on the ICU build — en-GB
  // renders USD as "US$" and JPY as "JP¥", and that is correct behaviour, not
  // something to freeze into a test. What is at risk, and what these tests
  // hold still, is the exponent: whether 1900 becomes 19.00 or 1,900.
  it("renders minor units as a price, not as an integer of cents", () => {
    // The whole point of the representation. 1900 minor units is nineteen
    // pounds, and rendering it as "1900" is the bug this type exists to prevent.
    expect(formatMoney(usd(1900), "en-GB")).toMatch(/19\.00$/);
    expect(formatMoney(usd(1900), "en-GB")).not.toMatch(/1,?900/);
  });

  it("keeps the cents when they are not zero", () => {
    expect(formatMoney(usd(1999), "en-GB")).toMatch(/19\.99$/);
  });

  it("renders a free plan as zero, with the currency", () => {
    expect(formatMoney(usd(0), "en-GB")).toMatch(/0\.00$/);
  });

  it("uses the currency's own number of minor units, not a hard-coded hundred", () => {
    // JPY has no minor unit: 1900 is ¥1,900, not ¥19.00. Dividing by 100
    // because USD does is the classic bug, and the exponent is read from the
    // platform's own currency data rather than from a table written by hand.
    expect(formatMoney({ amount_minor: 1900, currency: "JPY" }, "en-GB")).toMatch(/1,900$/);
  });

  it("handles a three-decimal currency without losing the third digit", () => {
    // KWD/BHD/JOD/TND have three. 12,345 minor units is 12.345, and a
    // divide-by-100 would show 123.45.
    expect(formatMoney({ amount_minor: 12_345, currency: "KWD" }, "en-GB")).toMatch(/12\.345$/);
  });

  it("groups thousands the way the locale does", () => {
    expect(formatMoney(usd(1_250_000), "en-GB")).toMatch(/12,500\.00$/);
  });

  it("leads the locale to choose the placement, not a hard-coded prefix", () => {
    // de-DE puts the symbol after the number and swaps the separators. If this
    // ever comes back "12.500,00" with the symbol in front, the formatter has
    // been replaced by a hand-rolled string.
    expect(formatMoney(usd(1_250_000), "de-DE")).toMatch(/12\.500,00\s*\S*$/);
  });

  it("never renders a fraction of a minor unit", () => {
    // The only division in the codebase, and it is the last one. Anything that
    // needed a half-cent would mean the amount was not in minor units.
    for (const amount of [1, 7, 99, 100, 101]) {
      expect(formatMoney(usd(amount), "en-GB")).not.toMatch(/\d\.\d{3}/);
    }
  });

  it("does not mutate the amount it was given", () => {
    const money = usd(1999);
    formatMoney(money, "en-GB");
    expect(money.amount_minor).toBe(1999);
  });
});
