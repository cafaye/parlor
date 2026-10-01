import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Callout, ConfirmDialog, Spinner } from "@/components/ui";
/**
 * The three states this app did not have a component for, plus the one it
 * hand-rolled six times.
 *
 * The destructive confirmation is the interesting one. Before this, deleting
 * an account was a `confirming` boolean that swapped one button for two, and
 * leaving an account was a single click with no confirmation at all — a
 * click that cannot be undone, one button deep, next to a panel of other
 * buttons. That is the shape of accident this component exists to remove.
 *
 * Asserted on role, accessible name and focus — never on class names.
 */

describe("Spinner", () => {
  /**
   * The one non-obvious assertion in this file. A spinner with no
   * `aria-hidden` is announced as an image with no name, which is either
   * silence or noise depending on the reader — and it duplicates whatever the
   * `aria-busy` on the surrounding control already says. It is decoration.
   */
  it("is hidden from assistive technology, because the busy state is announced by its control", () => {
    render(<Spinner />);

    const spinner = screen.getByTestId("spinner");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  it("takes no accessible name, so there is no name to confuse with the control's", () => {
    render(<Spinner />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("Callout", () => {
  it("renders its heading and body", () => {
    render(<Callout title="Invited">This link is shown once.</Callout>);

    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("This link is shown once.")).toBeInTheDocument();
  });

  it("is a status region by default, so it is announced when it appears", () => {
    render(<Callout title="Invited">Shown once.</Callout>);

    expect(screen.getByRole("status")).toHaveTextContent("Invited");
  });

  /**
   * A critical callout is a failure, and a failure is the one thing that
   * should interrupt whatever somebody was reading. `role="alert"` is assertive
   * for exactly that reason, and this is the one component in the system that
   * gets to choose between the two urgencies.
   */
  it("announces a critical callout assertively, because something went wrong", () => {
    render(
      <Callout title="We could not load the members." tone="critical">
        Try again.
      </Callout>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load the members.");
  });

  it("can be silenced, for a critical callout a person has already read", () => {
    render(
      <Callout title="Already known" tone="critical" assertive={false}>
        Detail.
      </Callout>,
    );

    // Still a live region — a screen reader can find it — but no longer
    // assertive, so mounting it does not cut across the current utterance.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a body only when there is one", () => {
    render(<Callout title="Title only" />);

    expect(screen.getByRole("status")).toHaveTextContent("Title only");
  });
});

describe("ConfirmDialog", () => {
  function openDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    const props = {
      open: true,
      title: "Delete this account?",
      description: "The account and everything scoped by it are removed. There is no undo.",
      confirmLabel: "Delete this account",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<ConfirmDialog {...props} />) };
  }

  it("renders nothing at all when closed, so it is not in the tab order", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete this account?"
        description="No undo."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its own title", () => {
    openDialog();

    const dialog = screen.getByRole("dialog", { name: "Delete this account?" });
    // `aria-modal` is what tells a screen reader the content behind this is not
    // available, which is why the focus trap below is a convenience rather than
    // the only thing keeping somebody inside.
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("describes itself, so the consequence is read with the question", () => {
    openDialog();

    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "The account and everything scoped by it are removed. There is no undo.",
    );
  });

  /**
   * The reason this component exists rather than a `window.confirm`. Both
   * buttons are real, focusable controls with stable names, and focus lands
   * on the one that does nothing.
   */
  it("puts focus on Cancel, not on the destructive action", () => {
    openDialog();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("confirms through a button with the action's own name, never a generic one", () => {
    const { props } = openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Delete this account" }));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels through a button, and Escape does the same thing", () => {
    const { props } = openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the dialog, so focus cannot wander onto the page behind", () => {
    openDialog();

    const dialog = screen.getByRole("dialog");
    const confirm = screen.getByRole("button", { name: "Delete this account" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    // Only the two BOUNDARIES are the component's job; the movement in between
    // is the browser's, and jsdom does not implement it. So each case parks
    // focus on an edge explicitly and presses Tab, which is exactly the
    // situation the handler exists to catch. Asserting "Tab from Cancel goes
    // to Delete" would be asserting the browser, not this file.
    expect(document.activeElement).toBe(cancel);

    // Forward off the last control wraps to the first, rather than escaping to
    // the page behind the scrim.
    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    // Backward off the first wraps to the last.
    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  /**
   * The reason the boundaries above matter. Focus starts on Cancel, which is
   * the FIRST control in the dialog, so the interesting escape is forward —
   * and it is caught by the browser's own wrap, not by this component. The
   * case this component exists for is the other edge: a Tab that reaches the
   * last control and would otherwise continue into the page.
   *
   * Asserted with a real control AFTER the dialog in document order, because
   * "focus does not escape" is only a meaningful claim when there is
   * somewhere else for focus to go.
   */
  it("does not let Tab reach a control that sits after the dialog in the document", () => {
    const after = document.createElement("button");
    after.textContent = "Behind the dialog";
    document.body.appendChild(after);

    try {
      openDialog();
      const dialog = screen.getByRole("dialog");
      const confirm = screen.getByRole("button", { name: "Delete this account" });

      confirm.focus();
      fireEvent.keyDown(dialog, { key: "Tab" });

      expect(document.activeElement).not.toBe(after);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    } finally {
      after.remove();
    }
  });

  it("gives focus back to whatever had it, so closing does not dump somebody at the top of the page", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Delete account";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <ConfirmDialog
        open
        title="Delete?"
        description="No undo."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.activeElement).not.toBe(trigger);

    rerender(
      <ConfirmDialog
        open={false}
        title="Delete?"
        description="No undo."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  /**
   * The house rule, in one test: a busy control keeps its name. A destructive
   * button that renames itself to "Deleting…" mid-flight cannot be found by
   * name at the exact moment somebody is most likely to be trying to find it.
   */
  it("keeps the confirm button's name while it is busy", () => {
    openDialog({ busy: true });

    const confirm = screen.getByRole("button", { name: "Delete this account" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
  });

  it("does not close on a click outside, because an accidental click is the accident this prevents", () => {
    const { props } = openDialog();

    fireEvent.click(screen.getByTestId("confirm-scrim"));

    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("blocks the confirm action while busy, so a slow delete cannot be submitted twice", () => {
    const { props } = openDialog({ busy: true });

    fireEvent.click(screen.getByRole("button", { name: "Delete this account" }));

    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
