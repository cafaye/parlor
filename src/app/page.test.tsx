import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

/**
 * The landing page.
 *
 * Asserted on the property that matters: every link here goes somewhere that
 * exists in this build. A directory that links to a screen nobody has written
 * yet is how a template starts lying, and this one has already had to decline
 * to link a subscriptions page because billing has no `/v1/subscriptions` on
 * master.
 */
describe("landing page", () => {
  it("renders the parlor brand name as the page heading", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("parlor");
  });

  it("states the template's promise that buyers own the code", () => {
    render(<Home />);

    expect(screen.getByText(/you own the code/i)).toBeInTheDocument();
  });

  it("links to the health surface", () => {
    render(<Home />);

    // A prefix match, not an exact one. The card is a single link whose
    // accessible name is its title run together with its description, and
    // testing-library builds that name by concatenating text nodes — so the
    // queryable name is "HealthThe liveness…", with no separator. A real
    // screen reader joins the two block-level children with a space; the test
    // just has to not insist on the shape.
    expect(screen.getByRole("link", { name: /^Health/ })).toHaveAttribute("href", "/healthz");
  });

  it("links to every section this build has", () => {
    render(<Home />);

    const nav = screen.getByRole("navigation", { name: "Sections" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));

    expect(hrefs).toEqual(
      expect.arrayContaining(["/accounts", "/billing/plans", "/billing/customers", "/healthz"]),
    );
  });

  it("links nowhere that does not exist, and in particular nowhere near subscriptions", () => {
    render(<Home />);

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");

    // The five subscription states and their actions need a
    // `/v1/subscriptions*` contract, which billing-04 is landing in parallel and
    // which is not on master. A link here would be a promise this build cannot
    // keep.
    expect(hrefs.filter((href) => /subscri|billing\/checkout|upgrade/i.test(href))).toEqual([]);
  });
});
