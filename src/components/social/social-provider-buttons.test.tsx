/**
 * The provider buttons, on both screens that render them.
 *
 * The assertions are about where the button GOES and what it is, because both
 * are load-bearing in ways a rendered string is not:
 *
 *   * An `href` of `/v1/auth/oauth/{provider}` — this origin's forwarder. Not
 *     identity's address (which is not in this bundle and never was), and not a
 *     `fetch` (which cannot follow the 302 that starts the flow).
 *   * A LINK, not a button. The start leg is a browser navigation; a `<button>`
 *     with a click handler cannot perform one, and a `<Link>` would ask the
 *     router for a route that does not exist.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { stubIdentity } from "@/test/support/identity";
import { renderWithProviders } from "@/test/support/render";

/**
 * Both screens, so a control that moved between them would go red.
 *
 * `render` is a property holding a function type rather than `render(): ...`
 * method shorthand, for the reason every other type in this repository spells
 * it that way — see `IdentityClient` in `src/lib/identity.ts`. The
 * destructuring in `describe.each` below is a method separated from its object
 * under `@typescript-eslint/unbound-method`, and these arrows read no `this`.
 */
const SCREENS: ReadonlyArray<{ name: string; render: () => React.ReactElement }> = [
  { name: "the sign in screen", render: () => <LoginPage searchParams={{}} /> },
  { name: "the registration screen", render: () => <RegisterPage /> },
];

describe.each(SCREENS)("$name", ({ render }) => {
  it("offers a way in for every provider this app is configured for", () => {
    renderWithProviders(render(), { identity: stubIdentity() });

    for (const provider of SOCIAL_PROVIDERS) {
      const link = screen.getByRole("link", { name: `Continue with ${provider.label}` });
      expect(link, `${provider.id} must be offered on this screen`).toBeInTheDocument();
    }
  });

  it("points each button at this origin's forwarder", () => {
    renderWithProviders(render(), { identity: stubIdentity() });

    for (const provider of SOCIAL_PROVIDERS) {
      const link = screen.getByRole("link", { name: `Continue with ${provider.label}` });
      expect(link).toHaveAttribute("href", `/v1/auth/oauth/${provider.id}`);
    }
  });

  it("uses a link, because the start leg is a browser navigation", () => {
    // A `<button>` cannot navigate the document, and this is the assertion that
    // would catch somebody "fixing" it into a click handler.
    renderWithProviders(render(), { identity: stubIdentity() });

    for (const provider of SOCIAL_PROVIDERS) {
      const name = `Continue with ${provider.label}`;
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("keeps the password form reachable as the other way in", () => {
    // The provider buttons are alternatives to this app's own sign-in, not a
    // replacement for it. A screen that had lost its form would still satisfy
    // every assertion above.
    renderWithProviders(render(), { identity: stubIdentity() });

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });
});

describe("the provider list", () => {
  it("holds at least one provider, or both screens render an empty group", () => {
    // A guard against a refactor that empties the list: the buttons would still
    // render — as nothing — and every test above would pass vacuously.
    expect(SOCIAL_PROVIDERS.length).toBeGreaterThan(0);
  });

  it("gives every provider an id and a label", () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(provider.id, "a provider with no id has no path").toMatch(/^[a-z0-9-]+$/);
      expect(provider.label, "a provider with no label has no button text").not.toBe("");
    }
  });

  it("names each provider exactly once", () => {
    const ids = SOCIAL_PROVIDERS.map((provider) => provider.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});