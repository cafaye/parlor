import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TermsPage from "./terms";
import { renderWithRouter } from "@/test/support/render";

/**
 * The terms page, and the honesty it is made of.
 *
 * The property that matters is the last one: the page IS the placeholder. A
 * later edit that replaced the placeholder with real terms — or deleted the
 * "this is a placeholder" note and left the generator pointers looking like the
 * content — would be silent without the assertions below.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT ASSERTED HERE, AND WHY
 * ---------------------------------------------------------------------------
 * No class names. The retired `anywaye/site` asserted
 * `.border-t.border-border` for the hairline rule and queried the kicker as
 * `main.querySelector("p")`; this repository's house rule is to assert on role
 * and accessible name, never on class names, because a test that checks for
 * `bg-accent` breaks when the palette changes and proves nothing about the
 * person using the product. So the hairline rule is not asserted at all — it is
 * a token the design system owns — and the kicker is asserted by its text.
 *
 * And the assertion that must never be written: nothing here asserts that the
 * body IS legal text. A test asserting real terms would be the failure mode
 * this page exists to avoid, wearing a green badge.
 */
describe("terms page", () => {
  it("names itself", () => {
    renderWithRouter(<TermsPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms of Service");
  });

  it("carries a Last updated line, because a legal page without one is a claim", () => {
    renderWithRouter(<TermsPage />);

    expect(screen.getByText(/^last updated:/i)).toBeInTheDocument();
  });

  it("says it is a placeholder rather than drafting terms nobody wrote", () => {
    renderWithRouter(<TermsPage />);

    expect(screen.getByText(/^this page is a placeholder/i)).toBeInTheDocument();
  });

  it("tells the operator to update the Last updated line when they replace it", () => {
    renderWithRouter(<TermsPage />);

    expect(screen.getByText(/don't forget to update the last updated line/i)).toBeInTheDocument();
  });

  it("points at the policy generators, and at nothing else", () => {
    renderWithRouter(<TermsPage />);

    const hrefs = Array.from(document.querySelectorAll("a"))
      .map((a) => a.getAttribute("href"))
      .filter((href): href is string => !!href && href.startsWith("https:"));

    // Set equality, like the footer's: a deleted pointer and an invented one
    // balance out in a length check and pass.
    expect(new Set(hrefs)).toEqual(
      new Set([
        "https://github.com/basecamp/policies",
        "https://www.iubenda.com",
        "https://termly.io",
        "https://getterms.io",
      ]),
    );
    expect(hrefs.length).toBe(4);
  });

  /**
   * The kicker is the capitalised brand, which is this app's brand rather than
   * the retired site's. Asserted on the text rather than on a `p` element with
   * a class, per the house rule above.
   */
  it("opens with the capitalised brand kicker, the wayfinding every public page carries", () => {
    renderWithRouter(<TermsPage />);

    expect(screen.getByText("Anywaye")).toBeInTheDocument();
  });

  it("prints no date on the Last updated line, because there is no agreement record to read one from", () => {
    renderWithRouter(<TermsPage />);

    // A printed date is a claim nobody made. The line states the page's state
    // instead, and `ProsePage`'s `updated` prop is the seam for the day real
    // terms exist.
    expect(screen.getByText(/^last updated:/i)).toHaveTextContent(
      /last updated: this page is a placeholder/i,
    );
    expect(screen.getByText(/^last updated:/i).textContent ?? "").not.toMatch(/\d{4}/);
  });
});
