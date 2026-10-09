import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShellFooter } from "./footer";
import { renderWithRouter } from "@/test/support/render";

/**
 * The shell footer, and the one thing it is for: the legal routes.
 *
 * ---------------------------------------------------------------------------
 * WHY `renderWithRouter` AND NOT `renderWithProviders`
 * ---------------------------------------------------------------------------
 * The footer reads no session and holds no state. `renderWithProviders` scripts
 * an identity client, and scripting a stub a component never touches is noise
 * that hides the one thing this test can fail on. The router is still needed
 * and is not noise: both links are `TextLink`, which wraps the router's own
 * `Link` and reads the router out of React context, so with no provider above
 * it every assertion throws instead of resolving. `renderWithRouter` puts that
 * provider there and renders real `<a href>`s, which is what lets these
 * assertions be about where a link GOES rather than that it exists.
 *
 * The retired `cafaye/site` got this wrong first and fixed it in its own
 * packet; the fix is ported rather than rediscovered.
 */
describe("shell footer", () => {
  it("carries the terms link, through the router so it carries a real href", () => {
    renderWithRouter(<ShellFooter />);

    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  });

  it("carries the privacy link, through the router so it carries a real href", () => {
    renderWithRouter(<ShellFooter />);

    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("links to the legal pages and to nothing else", () => {
    renderWithRouter(<ShellFooter />);

    // Set equality rather than a length: a footer that dropped one link and
    // invented another would balance out in a count and pass.
    const hrefs = Array.from(document.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );

    expect(new Set(hrefs)).toEqual(new Set(["/terms", "/privacy"]));
    expect(hrefs.length).toBe(2);
  });

  /**
   * The landmark is named by the visible heading rather than by an
   * `aria-label`, so a screen-reader user gets the same words a sighted reader
   * sees and the landmarks list is navigable.
   */
  it("names its nav landmark with the section heading a reader can see", () => {
    renderWithRouter(<ShellFooter />);

    expect(screen.getByRole("navigation", { name: "The fine print" })).toBeInTheDocument();
  });

  /**
   * The landing page's link allow-list (`src/app/page.test.tsx`) is a property
   * worth keeping, and it is not weakened by the footer — that test renders
   * `<Home />` alone, with no shell above it, so a footer's links never enter
   * its `document.querySelectorAll("a")`. This assertion is the other half:
   * it pins the place the decision was recorded the footer would carry them.
   */
  it("offers no way to reach a screen this build does not serve", () => {
    renderWithRouter(<ShellFooter />);

    const hrefs = Array.from(document.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );

    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
    }
  });
});
