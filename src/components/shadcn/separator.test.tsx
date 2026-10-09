import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Separator } from "./separator";

/**
 * The hairline. The properties that matter are the ones a screen reader
 * and a future reader both depend on: it is announced as a separator, the
 * orientation is honest, and the line is the house token rather than a
 * literal grey.
 */
describe("Separator", () => {
  it("is a separator, horizontally by default", () => {
    render(<Separator />);

    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
    expect(separator.className).toContain("bg-border");
    expect(separator.className).toContain("h-px");
  });

  it("stands vertical when asked, with the honest orientation", () => {
    render(<Separator orientation="vertical" />);

    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator.className).toContain("w-px");
  });

  it("merges a caller's className", () => {
    render(<Separator className="my-8" />);

    expect(screen.getByRole("separator")).toHaveClass("my-8");
  });
});
