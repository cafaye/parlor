import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";
import { renderWithRouter } from "@/test/support/render";

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
    renderWithRouter(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("parlor");
  });

  it("states the template's promise that buyers own the code", () => {
    renderWithRouter(<Home />);

    expect(screen.getByText(/you own the code/i)).toBeInTheDocument();
  });

  it("does not link to the health probes, which are platform surface", () => {
    renderWithRouter(<Home />);

    // `/healthz` and `/readyz` are served — supervisors and the rollout gate
    // call them — but they answer JSON for probes, not a screen for people.
    // Linking either from here sent a customer to a not-found page, so the
    // directory no longer names them. Their handlers and their tests stay.
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");

    expect(hrefs.filter((href) => /healthz|readyz/i.test(href))).toEqual([]);
  });

  it("links to every section this build has", () => {
    renderWithRouter(<Home />);

    const nav = screen.getByRole("navigation", { name: "Sections" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));

    expect(hrefs).toEqual(["/accounts"]);
  });

  it("links nowhere near billing, which is frozen for launch", () => {
    // There is no plan catalogue in this build: billing is out of launch
    // scope, so a plans entry would advertise a screen that says billing is
    // not configured. The billing service contract is untouched — only the
    // customer entry point is gone.
    renderWithRouter(<Home />);

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");

    expect(hrefs.filter((href) => /billing/i.test(href))).toEqual([]);
  });

  it("links nowhere near the customer list, which is not shippable unscoped", () => {
    // billing scopes `GET /v1/customers` by nothing, so the screen showed every
    // customer's email to anybody signed in. The screen is removed, not the
    // link to it: a directory that links to a screen this build refuses to
    // render is the same lie as the screen was.
    renderWithRouter(<Home />);

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");

    expect(hrefs.filter((href) => /customers/i.test(href))).toEqual([]);
  });

  it("links nowhere that does not exist, and in particular nowhere near subscriptions", () => {
    renderWithRouter(<Home />);

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");

    // The five subscription states and their actions need a
    // `/v1/subscriptions*` contract, which billing-04 is landing in parallel and
    // which is not on master. A link here would be a promise this build cannot
    // keep.
    expect(hrefs.filter((href) => /subscri|billing\/checkout|upgrade/i.test(href))).toEqual([]);
  });
});
