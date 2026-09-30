import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState, ErrorState, LoadingState, Panel, RoleBadge } from "@/components/ui";

/**
 * The three states every async screen in this app has to render, plus the two
 * containers they sit in.
 *
 * They live here rather than in each screen because they are the parts that are
 * easy to leave out and expensive to leave out: a loading state that announces
 * nothing, an error that is not a live region, an empty state that reads like
 * a failure. Asserted on role and accessible name, never on class names.
 */

describe("LoadingState", () => {
  it("announces itself as a status, politely", () => {
    render(<LoadingState label="Loading accounts…" />);

    // `status` rather than `alert`: nothing has gone wrong, and a screen
    // reader interrupting whatever the person was reading to say "loading" is
    // the wrong urgency for a fetch that will finish in a moment.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading accounts…");
  });

  it("says what is loading rather than a bare spinner", () => {
    // A spinner with no accessible name is a silent pause, and the only way to
    // tell it from a hung page is to guess.
    render(<LoadingState label="Loading members…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading members…");
  });
});

describe("ErrorState", () => {
  it("is an alert, so it is announced when it appears", () => {
    render(<ErrorState title="We could not load your accounts" onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your accounts");
  });

  it("offers a retry that is a real button with an accessible name", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Something went wrong" onRetry={onRetry} />);

    screen.getByRole("button", { name: "Try again" }).click();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a detail line only when there is one", () => {
    const { rerender } = render(<ErrorState title="Something went wrong" onRetry={vi.fn()} />);
    expect(screen.queryByTestId("error-detail")).toBeNull();

    rerender(
      <ErrorState
        title="Something went wrong"
        detail="The service did not answer."
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("error-detail")).toHaveTextContent("The service did not answer.");
  });

  it("does not render a detail element when no detail was given", () => {
    render(<ErrorState title="Something went wrong" onRetry={vi.fn()} />);

    // An empty <p> is worse than none: it is announced as a blank region.
    expect(screen.queryByTestId("error-detail")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("has a heading, so the section still has a name when it is empty", () => {
    render(<EmptyState title="No accounts yet">Create one to get started.</EmptyState>);

    expect(screen.getByRole("heading", { name: "No accounts yet" })).toBeInTheDocument();
    expect(screen.getByText("Create one to get started.")).toBeInTheDocument();
  });

  it("is not an alert: an empty list is an answer, not a failure", () => {
    render(<EmptyState title="No accounts yet">Create one.</EmptyState>);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Panel", () => {
  it("renders a labelled region, so a screen reader can navigate to it", () => {
    render(
      <Panel title="Members" headingId="members-heading">
        <p>Two members.</p>
      </Panel>,
    );

    // A heading alone does not create a landmark. `aria-labelledby` pointing at
    // it does, which is what makes this a place somebody can jump to.
    const region = screen.getByRole("region", { name: "Members" });
    expect(region).toHaveTextContent("Two members.");
  });

  it("takes the heading id from the caller, and uses it for both halves", () => {
    render(
      <Panel title="Members" headingId="members-heading">
        <p>Body.</p>
      </Panel>,
    );

    // The same id joins the label to the heading. If the two ever disagreed the
    // region would be named by nothing.
    expect(screen.getByRole("region", { name: "Members" })).toHaveAttribute(
      "aria-labelledby",
      "members-heading",
    );
    expect(screen.getByRole("heading", { name: "Members" })).toHaveAttribute("id", "members-heading");
  });

  it("renders an action alongside the heading without moving the name", () => {
    render(
      <Panel title="Members" headingId="members-heading" action={<button type="button">Invite</button>}>
        <p>Body.</p>
      </Panel>,
    );

    expect(screen.getByRole("region", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
  });

  it("can render as a nested heading, so a page keeps one h1 and a real outline", () => {
    render(
      <Panel title="Members" headingId="members-heading" headingLevel={3}>
        <p>Body.</p>
      </Panel>,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Members" })).toBeInTheDocument();
  });
});

describe("RoleBadge", () => {
  it("names the role it is showing", () => {
    render(<RoleBadge role="owner" />);

    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("reads the same for all three roles", () => {
    for (const role of ["member", "admin", "owner"] as const) {
      const { unmount } = render(<RoleBadge role={role} />);
      expect(screen.getByText(role[0].toUpperCase() + role.slice(1))).toBeInTheDocument();
      unmount();
    }
  });
});
