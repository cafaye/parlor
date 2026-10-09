import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/**
 * The tab family, asserted on what Base UI owes us and what the house skin
 * adds: the roles and the wiring come from the library (tablist, tabs,
 * panels, arrow-key navigation), the active styling is ours, and a panel's
 * content is reachable by its value. The interaction test drives the same
 * events a mouse produces — Base UI activates on the pointer sequence and on
 * focus, so a bare `element.click()` is not what a person does.
 */
function ThreeTabs() {
  return (
    <Tabs defaultValue="one">
      <TabsList aria-label="Commands">
        <TabsTrigger value="one">install</TabsTrigger>
        <TabsTrigger value="two">run</TabsTrigger>
      </TabsList>
      <TabsContent value="one">the install command</TabsContent>
      <TabsContent value="two">the run command</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders a tablist with one tab per trigger", () => {
    render(<ThreeTabs />);

    const tablist = screen.getByRole("tablist", { name: "Commands" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(2);
  });

  it("shows the first panel and marks its trigger selected", () => {
    render(<ThreeTabs />);

    expect(screen.getByText("the install command")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "install" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "run" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("activates the tab a person clicks", () => {
    render(<ThreeTabs />);

    const run = screen.getByRole("tab", { name: "run" });
    fireEvent.mouseDown(run);
    fireEvent.focus(run);
    fireEvent.click(run);

    expect(run).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("the run command")).toBeInTheDocument();
  });

  it("marks the active trigger with the house styling, not the shadcn default", () => {
    render(<ThreeTabs />);

    const install = screen.getByRole("tab", { name: "install" });
    expect(install.getAttribute("data-slot")).toBe("tabs-trigger");
    // The active trigger is raised paper on the sunken list — the house
    // tokens, asserted by class because jsdom computes no styles.
    expect(install.className).toContain("data-active:bg-surface-raised");
    expect(install.className).not.toContain("bg-primary");
  });
});
