import { createFileRoute, useLocation } from "@tanstack/react-router";

import LoginPage from "@/app/login/page";
import { searchParamsOf } from "@/lib/search-params";

/**
 * `/login` — the sign in screen.
 *
 * The query is read here, off the resolved location, and handed down as a plain
 * object. The page decides what the presence of `password-changed` means; this
 * file's only job is to notice that the location exists.
 */
export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · parlor" }] }),
  component: Login,
});

function Login() {
  const { searchStr } = useLocation();

  return <LoginPage searchParams={searchParamsOf(searchStr)} />;
}