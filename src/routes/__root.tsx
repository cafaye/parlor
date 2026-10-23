import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ShellFooter } from "@/components/shell/footer";
import { ShellHeader } from "@/components/shell/header";
import { Providers } from "@/app/providers";

import "@/app/globals.css";

/**
 * The document shell: the `<html>`, the `<head>`, the providers, the chrome.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE REPLACED `src/app/layout.tsx`, AND IT IS THE ROUTE TREE'S ROOT
 * ---------------------------------------------------------------------------
 * The provider stack did NOT move — `Providers` is still `src/app/providers.tsx`
 * with the same props and the same test overrides, because seven render suites
 * mount it and none of them has any business knowing which framework is above
 * it. What moved is the document: the previous framework rendered
 * `<html>`/`<body>` from a layout module and mounted a provider tree inside it,
 * and this one renders them from the root route with `HeadContent` and
 * `Scripts` beside `Outlet`.
 *
 * `HeadContent` and `Scripts` are not optional decoration. Omit `Scripts` and
 * the page renders server-side, looks correct in a screenshot, and is dead in
 * the browser — no hydration, so no session, so a sign-in form that submits
 * into nothing. Omit `HeadContent` and the title is right on the server and
 * wrong forever after.
 *
 * ---------------------------------------------------------------------------
 * THE CLASS NAMES ON `<html>` ARE THE PREVIOUS LAYOUT'S, VERBATIM
 * ---------------------------------------------------------------------------
 * `h-full antialiased` and `flex min-h-full flex-col` are what made the sticky
 * footer and the full-height surfaces work, and the focus-ring offset on every
 * interactive control is measured against the ground colour these two classes
 * paint. Nothing here is a redesign.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FONT IS NO LONGER A LAYOUT CONCERN
 * ---------------------------------------------------------------------------
 * The old layout called `next/font/google`, which fetched Geist at build time
 * and handed back a CSS variable to hang on `<html>`. There is no framework to
 * ask now, so the faces are self-hosted from `@fontsource` and imported by
 * `src/app/globals.css`, and `--font-geist-sans` / `--font-geist-mono` are
 * declared in `src/styles/tokens.css` where the token that consumes them
 * lives. Same family, same variable names, same rendered type — one fewer
 * build-time network request and no runtime request at all.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "parlor" },
      {
        name: "description",
        content:
          "The anywaye app shell. Layout primitives, theme tokens and health surfaces — you own the code.",
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <Providers>
      <ShellHeader />
      <Outlet />
      <ShellFooter />
    </Providers>
  );
}