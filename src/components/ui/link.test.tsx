import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardLink, Surface, TextLink, VisuallyHidden } from "@/components/ui";

/**
 * The two link shapes and the surface they sit on.
 *
 * The link tests are mostly about the ring, because the ten hand-written links
 * this replaces had none of them: a keyboard user tabbing through the account
 * screen had focus on a link and nothing to see. That is invisible in a
 * screenshot and impossible to notice in review, which is why it is asserted
 * here.
 */
describe("TextLink", () => {
  it("carries a focus ring, which the hand-written links did not", () => {
    render(<TextLink href="/login">Sign in</TextLink>);

    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.className).toContain("focus-ring");
  });

  it("underlines at rest, so it is not identified by colour alone", () => {
    render(<TextLink href="/login">Sign in</TextLink>);

    // WCAG 1.4.1 (Use of Colour). A link that is only a different shade is
    // invisible to anybody who cannot perceive that shade, and this is a
    // system-wide decision rather than a per-call-site one.
    expect(screen.getByRole("link", { name: "Sign in" }).className).toContain("underline");
  });

  it("is a real anchor, so middle-click and copy-link-address work", () => {
    render(<TextLink href="/login">Sign in</TextLink>);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});

describe("CardLink", () => {
  it("carries a focus ring, for the same reason", () => {
    render(<CardLink href="/accounts">Accounts</CardLink>);

    expect(screen.getByRole("link", { name: "Accounts" }).className).toContain("focus-ring");
  });

  it("is one link covering the whole row, not a link with a click handler on a div", () => {
    render(<CardLink href="/accounts">Accounts</CardLink>);

    const link = screen.getByRole("link", { name: "Accounts" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/accounts");
  });
});

describe("Surface", () => {
  it("renders a div by default", () => {
    render(<Surface>Content</Surface>);

    expect(screen.getByText("Content").tagName).toBe("DIV");
  });

  it("can render as the element the content actually is", () => {
    render(
      <ul>
        <Surface as="li">A row</Surface>
      </ul>,
    );

    // A card inside a `<ul>` that is not an `<li>` breaks the list semantics,
    // and that is a mistake the `as` prop is here to make impossible.
    expect(screen.getByText("A row").tagName).toBe("LI");
  });

  it("has a default padding, because ten call sites re-decided it", () => {
    render(<Surface>Content</Surface>);

    // The token, not a literal. `p-pane` resolves to `--pane`; asserting the
    // literal number here would be asserting a decision that tokens.css owns.
    expect(screen.getByText("Content").className).toContain("p-pane");
  });

  it("has no shadow, because a sheet is separated by its edge", () => {
    render(<Surface>Content</Surface>);

    expect(screen.getByText("Content").className).not.toContain("shadow");
  });
});

describe("VisuallyHidden", () => {
  /**
   * The property that is easy to get wrong. `display: none` and
   * `visibility: hidden` both remove the text from the accessibility tree, so
   * the "visually hidden" helper that uses either one is a helper that
   * silently hides the accessible name it was written to provide.
   */
  it("stays in the accessibility tree while being invisible on screen", () => {
    render(<VisuallyHidden>Delete this account</VisuallyHidden>);

    const text = screen.getByText("Delete this account");
    expect(text).toBeInTheDocument();

    // Clipped, not removed. The classes that would remove it from the
    // accessibility tree are matched as whole class names rather than as
    // substrings — `overflow-hidden` contains "hidden", and a substring check
    // would flag the correct implementation and pass the broken one.
    const classes = new Set(text.className.split(/\s+/));
    expect(classes).not.toContain("hidden");
    expect(classes).not.toContain("invisible");
    expect(classes).not.toContain("sr-only-not-a-thing");
    // The clip is what does the work.
    expect(classes).toContain("overflow-hidden");
  });
});
