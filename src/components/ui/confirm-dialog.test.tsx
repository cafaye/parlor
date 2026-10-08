/**
 * The dialog's keyboard contract, asserted directly against the component.
 *
 * Why this file exists beside the one jsdom test in `controls.test.tsx`: that one
 * counts the buttons, which is a statement about markup. Every property that
 * makes a hand-built modal usable without a mouse is behaviour — where focus
 * lands, what Escape does, whether Tab stays inside — and behaviour is not
 * visible in a rendered tree.
 *
 * The e2e tier drives the same three properties in a real browser
 * (`e2e/design-system.e2e.spec.ts`), and that is the tier that decides. This one
 * is here because jsdom can run it in a second, so a regression in the trap is
 * caught by the per-commit gate rather than by a whole-stack bring-up.
 *
 * WHAT JSDOM CAN AND CANNOT PROVE, because the difference is not academic:
 * `fireEvent.keyDown` delivers the event to the component, which is what the
 * trap and Escape both hang off. It does NOT move focus the way the browser's
 * own Tab does — so the two wrap assertions below are about the component
 * CALLING `.focus()` at the edges (the half that is ours and can be wrong), not
 * about the browser walking the middle of the list. The browser end of the same
 * property is asserted in the e2e spec.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui";

/**
 * A harness with a real opener, because "focus goes back where it came from" is
 * a claim about a node that has to exist before the dialog opens. Rendering the
 * dialog with `open` and no opener would assert nothing about the restore: the
 * recorded element would be `<body>`.
 */
function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete account
      </button>
      <ConfirmDialog
        busy={busy}
        confirmLabel="Delete this account"
        description="There is no undo."
        onCancel={() => setOpen(false)}
        onConfirm={vi.fn()}
        open={open}
        title="Delete this account?"
      />
    </>
  );
}

/** Opens the dialog the way the e2e spec does: focus the opener, activate it. */
function openViaKeyboard(): HTMLElement {
  const opener = screen.getByRole("button", { name: "Delete account" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

const cancel = () => screen.getByRole("button", { name: "Cancel" });
const confirm = () => screen.getByRole("button", { name: "Delete this account" });

describe("ConfirmDialog, from the keyboard", () => {
  it("puts focus on Cancel when it opens, so a held spacebar cannot delete anything", () => {
    render(<Harness />);
    openViaKeyboard();

    expect(document.activeElement).toBe(cancel());
  });

  it("closes on Escape and returns focus to the control that opened it", () => {
    render(<Harness />);
    const opener = openViaKeyboard();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    // Closing a dialog and dumping somebody at the top of the document is a
    // small, common, maddening bug, and it is the reason `restoreTo` is a ref.
    expect(document.activeElement).toBe(opener);
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<Harness />);
    openViaKeyboard();

    // Tab is pressed while the DESTRUCTIVE button is focused, which is the last
    // control in document order.
    confirm().focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });

    expect(document.activeElement).toBe(cancel());
  });

  it("wraps Shift+Tab from the first control back to the last", () => {
    render(<Harness />);
    openViaKeyboard();

    cancel().focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(confirm());
  });

  it("does not close on Escape while the confirm is in flight", () => {
    render(<Harness busy />);
    openViaKeyboard();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

    // Escape must not make the dialog disappear while the delete it announced
    // is still happening.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ConfirmDialog, modal inertness", () => {
  /**
   * The property the hand-built `<div role="dialog">` never provided: the page
   * behind the dialog is hidden from assistive interaction while it is open,
   * not merely dimmed. A scrim that only dims still leaves every control behind
   * it reachable to a screen reader.
   */
  it("hides the page behind the dialog from assistive interaction while it is open", () => {
    render(<Harness />);
    const opener = openViaKeyboard();

    expect(opener.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("restores the page behind the dialog when it closes", () => {
    render(<Harness />);
    const opener = openViaKeyboard();
    expect(opener.closest('[aria-hidden="true"]')).not.toBeNull();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener.closest("[aria-hidden]")).toBeNull();
  });
});

describe("ConfirmDialog, type-to-confirm", () => {
  it("disables the confirm until the input matches the expected value", () => {
    render(
      <ConfirmDialog
        confirmLabel="Delete my account"
        description="There is no undo."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        open
        requireTyping="Kaka"
        title="Delete your account?"
      />,
    );

    const input = screen.getByRole("textbox");
    const confirm = screen.getByRole("button", { name: "Delete my account" });

    // The confirm is disabled until the input matches exactly — the reference
    // product's shape for an irreversible action.
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "wrong" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "Kaka" } });
    expect(confirm).toBeEnabled();
  });

  it("resets the typed value when the dialog reopens", () => {
    function ReopenHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ConfirmDialog
            confirmLabel="Delete my account"
            description="There is no undo."
            onCancel={() => setOpen(false)}
            onConfirm={vi.fn()}
            open={open}
            requireTyping="Kaka"
            title="Delete your account?"
          />
        </>
      );
    }

    render(<ReopenHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Kaka" } });
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();

    // Close and reopen — the typed value must not survive.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeDisabled();
  });
});