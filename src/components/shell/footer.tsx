import { TextLink } from "@/components/ui";

/**
 * The shell footer: the fine print.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MOUNTS BESIDE `ShellHeader` IN THE ROOT ROUTE
 * ---------------------------------------------------------------------------
 * The header's navigation is the session — Accounts and Settings render only
 * once a session exists (`src/components/shell/header.tsx:58-71`), so it is the
 * wrong place for anything a signed-out visitor needs. The landing page's own
 * test asserts it links exactly the ways it links (`src/app/page.test.tsx`), and
 * weakening that allow-list to add a legal link would be trading a property
 * worth keeping for a route nobody finds. The footer is the one component every
 * page already shares, so `/terms` and `/privacy` are linked from every page and
 * from nowhere else.
 *
 * A legal page a visitor cannot navigate to is not a page a visitor can read.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT IN THE PROVIDER STACK
 * ---------------------------------------------------------------------------
 * It reads no session and holds no state, so it is a plain component that
 * mounts inside `RootComponent` beside `ShellHeader`. That is also why
 * `src/components/shell/footer.test.tsx` renders it through
 * `renderWithRouter` and not `renderWithProviders`: scripting an identity
 * client this component never touches is noise.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE
 * ---------------------------------------------------------------------------
 * One section per concern, each a heading plus a list labelled by it — the
 * same idiom the header uses for its own `nav` (`aria-label="Main"`), so a
 * screen-reader user gets a landmark with a name rather than an unnamed `nav`
 * in the landmarks list. The heading carries the `id` and the `<nav>` points
 * `aria-labelledby` at it, so the landmark is named by the visible text a
 * sighted reader sees.
 *
 * The links are `TextLink`, which wraps the router's own `Link` — a raw `<a>`
 * would work for the first full-page load and be the wrong answer for every
 * navigation after it, which is the whole reason `TextLink` exists. Middle-click
 * and open-in-new-tab therefore work, which is what somebody does with a legal
 * page they want to finish reading later.
 */
export function ShellFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-6">
          <h2 className="text-sm font-medium" id="legal-heading">
            The fine print
          </h2>
          <nav
            aria-labelledby="legal-heading"
            className="flex flex-wrap items-baseline gap-x-6 gap-y-2"
          >
            <TextLink href="/terms">Terms of Service</TextLink>
            <TextLink href="/privacy">Privacy Policy</TextLink>
          </nav>
        </div>
      </div>
    </footer>
  );
}
