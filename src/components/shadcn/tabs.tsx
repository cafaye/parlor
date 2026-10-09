"use client";

/**
 * The document boundary, and it is the boundary rather than a hint.
 *
 * Base UI's tab family is a context family: `Root` provides what every `Tab`
 * and `Panel` consumes. With the directive stripped, the wrapper is a
 * server module, the context provider is serialized, the triggers render —
 * and nothing activates. That is measured, not argued: the same experiment
 * on the Radix build of this component (the website's `m207`) left all three
 * panels mounted with no click landing. The marker is the file's reason for
 * being, which is the case `components/ui/client-boundary.test.ts` names and
 * excludes by name.
 *
 * ---------------------------------------------------------------------------
 * WHY BASE UI AND NOT RADIX, IN THE TEMPLATE
 * ---------------------------------------------------------------------------
 * parlor already carries `@base-ui/react` — the dialog is built on it, and
 * the barrel's own header calls it the shadcn/ui default foundation. A
 * second headless library in the template every product starts from is a
 * dependency decision nobody should inherit by accident, so the site
 * primitives are Base UI's and stay that way. The API is shadcn's:
 * `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, one value per trigger, so a
 * page reads the same whichever build it meets.
 *
 * The skin is the house's: the active trigger is raised paper on the sunken
 * list, the inactive triggers are muted and arrive at full contrast on
 * hover, and the focus indicator is the measured `focus-ring` again.
 */

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cx } from "@/lib/cx";

/**
 * Base UI lets `className` be a function of state; this wrapper composes it
 * with `cx`, which joins strings. The function form would be the way to
 * style a tab by its state from the outside — and that is exactly what the
 * `data-active` variants already do, so the honest API here is a string and
 * the state styling stays in the component where it is asserted.
 */
type WithoutClassName<T> = Omit<T, "className"> & { className?: string };

function Tabs({
  className,
  ...props
}: WithoutClassName<React.ComponentProps<typeof TabsPrimitive.Root>>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cx("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: WithoutClassName<React.ComponentProps<typeof TabsPrimitive.List>>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cx(
        "inline-flex w-fit items-center justify-center rounded-lg bg-surface-sunken p-[3px] text-muted",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: WithoutClassName<React.ComponentProps<typeof TabsPrimitive.Tab>>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cx(
        "focus-ring inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-muted",
        "transition-[color,background-color,border-color] duration-fast ease-standard motion-reduce:transition-none",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        "data-active:border-border data-active:bg-surface-raised data-active:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: WithoutClassName<React.ComponentProps<typeof TabsPrimitive.Panel>>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cx("flex-1 outline-none focus-ring", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
