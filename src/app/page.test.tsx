import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("landing page", () => {
  it("renders the parlor brand name as the page heading", () => {
    render(<Home />);

    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading).toHaveTextContent("parlor");
  });

  it("states the template's promise that buyers own the code", () => {
    render(<Home />);

    expect(screen.getByText(/you own the code/i)).toBeInTheDocument();
  });

  it("links to the health surface", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "/healthz" })).toHaveAttribute(
      "href",
      "/healthz",
    );
  });
});
