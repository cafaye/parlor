import { createFileRoute } from "@tanstack/react-router";

import RegisterPage from "@/app/register/page";

/**
 * `/register` — the account creation screen.
 *
 * No params, no search, nothing to read off the location: the route file is the
 * path, the title, and a one-line bridge to a page component that render tests
 * already call directly.
 */
export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Create an account · parlor" }] }),
  component: Register,
});

function Register() {
  return <RegisterPage />;
}