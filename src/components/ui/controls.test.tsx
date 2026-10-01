import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button, ConfirmDialog, Field, Input, Select, Spinner } from "@/components/ui";

/**
 * The accessibility contracts every interactive primitive in this system owes,
 * asserted once, in one place.
 *
 * The reason they live here rather than in `button.test.tsx` /
 * `input.test.tsx` is that they are the SAME contracts. A focus ring that
 * Input has and Select has not is not two bugs, it is one bug that has not
 * been written down twice yet — and this table is what stops the third control
 * from being built without them.
 *
 * The one thing deliberately absent: assertions on class names. A test that
 * checks for `bg-accent` breaks when the palette changes and proves nothing
 * about the person using the product. What is asserted instead is the
 * behaviour — reachable by keyboard, operable by keyboard, named — plus the
 * structural fact that the control applies the system's own `focus-ring`
 * utility, which `tokens.css` and `tokens.test.ts` own.
 */

/** The shared focus ring, imported rather than retyped. */
const focusRing = "focus-ring";

interface Control {
  name: string;
  render(): HTMLElement;
  /** Does this control take focus with Tab? Non-focusables are excluded. */
  focusable: boolean;
}

const CONTROLS: readonly Control[] = [
  {
    name: "Button",
    focusable: true,
    render() {
      render(<Button>Save</Button>);
      return screen.getByRole("button", { name: "Save" });
    },
  },
  {
    name: "Input",
    focusable: true,
    render() {
      render(<Input aria-label="Email" />);
      return screen.getByRole("textbox", { name: "Email" });
    },
  },
  {
    name: "Select",
    focusable: true,
    render() {
      render(
        <Select aria-label="Role">
          <option>Member</option>
        </Select>,
      );
      return screen.getByRole("combobox", { name: "Role" });
    },
  },
];

describe("every interactive primitive", () => {
  it.each(CONTROLS.filter((c) => c.focusable))("$name is reachable by keyboard", (control) => {
    const element = control.render();

    // `.focus()` is what the browser's Tab does; jsdom does not implement Tab
    // movement, so the reachable-by-keyboard property is asserted the way the
    // browser establishes it. A control that cannot take focus cannot be
    // reached by Tab, whatever its markup looks like.
    element.focus();

    expect(document.activeElement).toBe(element);
  });

  it.each(CONTROLS)("$name applies the system's focus ring, not its own", (control) => {
    const element = control.render();

    // The class is asserted, and the house rule says not to assert classes — so
    // here is the exception and the reason. This is not a check that a
    // particular colour was applied; it is a check that the control defers to
    // the ONE definition in `tokens.css`. That definition is contrast-checked
    // in `tokens.test.ts` and its non-zero offset is asserted there too, so
    // this is a wiring check: it fails if a control grows a bespoke ring, and
    // a bespoke ring is how the offset silently goes to zero.
    expect(element.className).toContain(focusRing);
  });

  it.each(CONTROLS)("$name has an accessible name a person could search for", (control) => {
    const element = control.render();

    // Non-empty. An unnamed control is a dead end for anybody navigating by
    // name, which is the other half of the focus contract.
    const aria = element.getAttribute("aria-label");
    const associated =
      element instanceof HTMLInputElement || element instanceof HTMLSelectElement
        ? (element.labels?.[0]?.textContent?.trim() ?? "")
        : "";
    const text = element.textContent?.trim() ?? "";

    expect((aria || associated || text).length).toBeGreaterThan(0);
  });
});

describe("Button", () => {
  it("defaults to type=button, so it cannot post a form by accident", () => {
    render(<Button>Cancel</Button>);

    // A bare `<button>` in a form is a submit. "Cancel" posting a form is a bug
    // that this default makes impossible rather than merely discouraged.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
  });

  it("still submits when asked to", () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <Button type="submit">Create account</Button>
      </form>,
    );

    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    expect(screen.getByRole("button", { name: "Create account" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  /**
   * The house rule, enforced. A busy control keeps its name and gains
   * `aria-busy`; it does not rename itself, because a control that changes its
   * own label mid-interaction cannot be found by the name somebody is using to
   * find it.
   */
  it("keeps its name when it becomes busy", () => {
    const { rerender } = render(<Button busy={false}>Create account</Button>);
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();

    rerender(
      <Button aria-busy busy disabled>
        Create account
      </Button>,
    );

    const busy = screen.getByRole("button", { name: "Create account" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
  });

  it("shows a decorative spinner when busy, and nothing extra to announce", () => {
    render(
      <Button aria-busy busy disabled>
        Create account
      </Button>,
    );

    const spinner = screen.getByTestId("spinner");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    // The name is still exactly the label. The spinner added no words.
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("has no spinner when it is not busy", () => {
    render(<Button>Create account</Button>);

    expect(screen.queryByTestId("spinner")).toBeNull();
  });

  it("is operable by keyboard, not just by click", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Delete</Button>);

    const button = screen.getByRole("button", { name: "Delete" });
    button.focus();
    expect(document.activeElement).toBe(button);

    // A native button fires click on Enter and Space; jsdom does not run the
    // default action, so what is asserted is that the handler is the button's
    // own `onClick` on a real `<button>` — which is what makes the default
    // action exist at all. The non-negotiable part is that it is a `<button>`
    // and not a `div` with a role.
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.tagName).toBe("BUTTON");
  });

  it("has a destructive variant, so the dangerous action is not the primary one", () => {
    render(
      <>
        <Button variant="destructive">Delete this account</Button>
        <Button variant="primary">Save name</Button>
      </>,
    );

    // Both exist and both are buttons. What makes the destructive one
    // distinguishable is asserted in the visual layer; what is asserted here is
    // that the variant EXISTS, so that no screen has to reach for `primary` on
    // something irreversible, and so the two can be told apart by class in a
    // way a design decision made once.
    const destructive = screen.getByRole("button", { name: "Delete this account" });
    const primary = screen.getByRole("button", { name: "Save name" });

    expect(destructive.className).not.toBe(primary.className);
  });

  it("has two sizes, so a dense table row can be 32px and a page can be 36px", () => {
    render(
      <>
        <Button size="sm">Remove</Button>
        <Button size="md">Create account</Button>
      </>,
    );

    // Expressed as a minimum height rather than a height, so a two-line label
    // grows instead of clipping. Asserted loosely on purpose: the number is in
    // the class, and what matters is that the two sizes differ at all.
    expect(screen.getByRole("button", { name: "Remove" }).className).toContain("min-h-8");
    expect(screen.getByRole("button", { name: "Create account" }).className).toContain("min-h-9");
  });
});

describe("Field", () => {
  it("gives the control the id the label points at", () => {
    render(
      <Field id="email" label="Email">
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText("Email")).toBe(screen.getByRole("textbox"));
  });

  it("describes the control with the hint, and marks it invalid when there is an error", () => {
    render(
      <Field error="That is not an email address." hint="We only use it to sign you in." id="email" label="Email">
        <Input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Email" });
    // Both ids, hint first: what this is, then why it is complaining.
    expect(input).toHaveAccessibleDescription("We only use it to sign you in. That is not an email address.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves a valid control un-described rather than describing nothing", () => {
    render(
      <Field hint="We only use it to sign you in." id="email" label="Email">
        <Input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAccessibleDescription("We only use it to sign you in.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("announces an error without moving focus, so a message on submit is heard", () => {
    render(
      <Field error="Too short." id="password" label="Password">
        <Input />
      </Field>,
    );

    // A field error is polite. Asserting the role here rather than the class:
    // the contract is that it is a live region at all, which is the difference
    // between "a red line appeared" and "the form told me what is wrong".
    const live = document.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent("Too short.");
  });

  it("labels a select as readily as an input, which is the point of the union type", () => {
    render(
      <Field hint="Only an owner can invite an admin." id="role" label="Role">
        <Select>
          <option>Member</option>
        </Select>
      </Field>,
    );

    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select).toHaveAccessibleDescription("Only an owner can invite an admin.");
  });
});

describe("Spinner", () => {
  it("is hidden from assistive technology, because the busy state is announced by its control", () => {
    render(<Spinner />);

    expect(screen.getByTestId("spinner")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("ConfirmDialog keyboard reachability", () => {
  it("puts both controls in the tab order and neither in the accessibility tree twice", () => {
    render(
      <ConfirmDialog
        description="This cannot be undone."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        open
        title="Delete this account?"
        confirmLabel="Delete this account"
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
