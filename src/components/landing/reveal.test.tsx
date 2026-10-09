import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Reveal } from "./reveal";

/**
 * The reveal primitive's contract is the "no motion by default" guarantee,
 * so the test asserts exactly that: children render, the wrapper is marked,
 * and nothing requires an IntersectionObserver to exist (jsdom has none —
 * the same position as a scripting-off visitor).
 */
describe("Reveal", () => {
  it("renders its children inside the reveal wrapper", () => {
    render(
      <Reveal>
        <p>built once</p>
      </Reveal>,
    );

    const child = screen.getByText("built once");
    expect(child).toBeInTheDocument();
    expect(child.closest(".reveal")).not.toBeNull();
  });

  it("passes its className and delay through", () => {
    render(
      <Reveal className="mx-auto" delay={120}>
        <p>used everywhere</p>
      </Reveal>,
    );

    const wrapper = screen.getByText("used everywhere").closest(".reveal");
    expect(wrapper).toHaveClass("mx-auto");
    expect(wrapper).toHaveStyle({ transitionDelay: "120ms" });
  });
});
