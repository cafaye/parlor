import type { ReactNode } from "react";

/**
 * A page of readable text: a heading, a "Last updated" line, and the body.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A COMPONENT AND NOT MARKUP IN EACH ROUTE
 * ---------------------------------------------------------------------------
 * `/terms` and `/privacy` are two pages with one structure, and the structure
 * is the point. Both render from this one view — a kicker, an `<h1>`, a
 * "Last updated" line, and the body — so the two pages cannot drift apart in
 * shape even when their text differs. Two copies of that markup in two route
 * files is two places for the "Last updated" line to be forgotten, and it is
 * the line a reader reads to know whether the text in front of them is
 * current.
 *
 * ---------------------------------------------------------------------------
 * WHY THE "LAST UPDATED" LINE HAS A DEFAULT, AND WHAT IT SAYS
 * ---------------------------------------------------------------------------
 * This app has no agreement record, no CMS and no editor: the pages are static
 * files in the repository. So the default is the honest statement for a page
 * whose text has never been updated, and the prop exists so that the day real
 * terms are published the line can carry a date without the layout changing
 * underneath it. **No date is printed by default on purpose** — there is no
 * record to read one from, and a printed date is a claim nobody made.
 *
 * ---------------------------------------------------------------------------
 * THE MEASURE AND THE RHYTHM ARE THE OTHER LONG-FORM PAGES'
 * ---------------------------------------------------------------------------
 * `max-w-3xl` on the page, `max-w-prose` on the body, `text-pretty` on the
 * paragraphs — the same values `src/app/page.tsx` already uses (`:81`,
 * `:131`, `:186`), so a legal page reads at the width of every other
 * long-form page here rather than at a width of its own. `text-muted` on the
 * kicker and the "Last updated" line is the semantic layer, so both flip with
 * the theme without this file knowing the theme exists.
 */
export type ProsePageProps = {
  /** The page's own name, as the heading. The route's meta title is built from the same words. */
  title: string;
  /**
   * The mono kicker above the heading — the section wayfinding every public
   * page carries ("Cafaye" here). It reuses the existing product name, so no
   * new copy is written.
   */
  kicker?: string;
  /**
   * What the "Last updated" line says after the colon.
   *
   * Defaults to the honest answer for a page that has never been updated
   * because it is a placeholder — see `LegalPlaceholder`. Passing a date here
   * is a legal decision with a person attached, never a typo fix.
   */
  updated?: string;
  children: ReactNode;
};

export function ProsePage({
  title,
  kicker = "Cafaye",
  updated = "this page is a placeholder",
  children,
}: ProsePageProps) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">{kicker}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted">Last updated: {updated}</p>
      </div>
      {/*
        Hairline separation between the header block and the body: the heading,
        the "Last updated" line and the body are unchanged — only the rule
        between them is new. It is `border-border`, the semantic token, so it
        is the same colour the shell header and the footer use for theirs.
      */}
      <div className="flex max-w-prose flex-col gap-4 border-t border-border pt-8 text-pretty">
        {children}
      </div>
    </main>
  );
}
