import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./privacy";
import { renderWithRouter } from "@/test/support/render";

/**
 * The privacy policy page, and the honesty it is made of.
 *
 * The property that matters is the last one: the page IS the placeholder. A
 * later edit that replaced the placeholder with real policy — or deleted the
 * "this is a placeholder" note and left the generator pointers looking like the
 * content — would be silent without the assertions below.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE'S HONESTY IS THE STRONGEST ONE
 * ---------------------------------------------------------------------------
 * This deployment really does hold things: identity holds accounts, the browser
 * holds a session token, telemetry emits spans. None of it is named on this
 * page, and the assertions below hold that shut by holding the page to exactly
 * the placeholder's words and the four generator pointers. A sentence such as
 * "we store your email address" is a data-processing claim nobody has approved,
 * and it is the failure mode this page exists to avoid.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT ASSERTED HERE, AND WHY
 * ---------------------------------------------------------------------------
 * No class names. The retired `cafaye/site` asserted `.border-t.border-border`
 * for the hairline rule and queried the kicker as `main.querySelector("p")`;
 * this repository's house rule is to assert on role and accessible name, never
 * on class names. So the hairline rule is not asserted at all, and the kicker is
 * asserted by its text.
 */
describe("privacy page", () => {
  it("names itself", () => {
    renderWithRouter(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Privacy Policy");
  });

  it("carries a Last updated line, because a legal page without one is a claim", () => {
    renderWithRouter(<PrivacyPage />);

    expect(screen.getByText(/^last updated:/i)).toBeInTheDocument();
  });

  it("says it is a placeholder rather than drafting a policy nobody wrote", () => {
    renderWithRouter(<PrivacyPage />);

    expect(screen.getByText(/^this page is a placeholder/i)).toBeInTheDocument();
  });

  it("tells the operator to update the Last updated line when they replace it", () => {
    renderWithRouter(<PrivacyPage />);

    expect(screen.getByText(/don't forget to update the last updated line/i)).toBeInTheDocument();
  });

  it("points at the policy generators, and at nothing else", () => {
    renderWithRouter(<PrivacyPage />);

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

  it("opens with the capitalised brand kicker, the wayfinding every public page carries", () => {
    renderWithRouter(<PrivacyPage />);

    expect(screen.getByText("Cafaye")).toBeInTheDocument();
  });

  it("prints no date on the Last updated line, because there is no agreement record to read one from", () => {
    renderWithRouter(<PrivacyPage />);

    expect(screen.getByText(/^last updated:/i)).toHaveTextContent(
      /last updated: this page is a placeholder/i,
    );
    expect(screen.getByText(/^last updated:/i).textContent ?? "").not.toMatch(/\d{4}/);
  });
});
