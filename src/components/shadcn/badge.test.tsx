import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

/**
 * The chip: children render, the variant is on the element for styling and
 * for tests, and the base classes do not drift. Variant classes are
 * asserted by their token rather than by a rendered colour — jsdom does not
 * compute Tailwind, so the assertion is on the class the component chose,
 * which is the part this component owns.
 */
describe("Badge", () => {
  it("renders its label as the whole content", () => {
    render(<Badge>Go</Badge>);

    expect(screen.getByText("Go")).toBeInTheDocument();
  });

  it("marks the variant on the element", () => {
    render(<Badge variant="positive">live</Badge>);

    expect(screen.getByText("live")).toHaveAttribute("data-variant", "positive");
  });

  it("wears the status ramp for positive and caution, and the hairline by default", () => {
    const { rerender } = render(<Badge>one</Badge>);
    expect(screen.getByText("one").className).toContain("bg-surface-sunken");

    rerender(<Badge variant="positive">two</Badge>);
    expect(screen.getByText("two").className).toContain("bg-positive-surface");

    rerender(<Badge variant="caution">three</Badge>);
    expect(screen.getByText("three").className).toContain("bg-caution-surface");
  });

  it("keeps the mono eyebrow treatment the house uses for labels", () => {
    render(<Badge>Go</Badge>);

    expect(screen.getByText("Go").className).toContain("font-mono");
    expect(screen.getByText("Go").className).toContain("rounded-sm");
  });

  it("merges a caller's className over the base", () => {
    render(<Badge className="ml-2">Go</Badge>);

    expect(screen.getByText("Go")).toHaveClass("ml-2");
    expect(screen.getByText("Go").className).toContain("text-meta");
  });
});
