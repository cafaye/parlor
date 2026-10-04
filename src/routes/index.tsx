import { createFileRoute } from "@tanstack/react-router";

import HomePage from "@/app/page";

/**
 * `/` — the landing page.
 *
 * A route file is three things: the path, the document metadata, and the
 * component. It is NOT the screen: the screen is still
 * `src/app/page.tsx`, and it is still a plain default-exported function that
 * seven assertions in `src/app/page.test.tsx` call directly. That split is the
 * reason this migration did not have to rewrite a single render test.
 */
export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <HomePage />;
}