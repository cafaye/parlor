import { RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { Providers } from "@/app/providers";
import type { BillingClient } from "@/lib/billing";
import type { BoxClient } from "@/lib/box";
import type { IdentityClient } from "@/lib/identity";
import type { OperatorClient } from "@/lib/operator";
import { createTokenStore, type TokenStore } from "@/lib/token-store";
import { getRouter } from "@/router";

/**
 * A router for a test, on a memory history.
 *
 * ---------------------------------------------------------------------------
 * WHY A REAL ROUTER AND NOT A STUB, WHEN THIS REPOSITORY STUBS EVERYTHING ELSE
 * ---------------------------------------------------------------------------
 * Because the router is not a dependency of a screen — it is the thing that
 * renders one. `@/lib/navigation` is stubbed (`push`, `refresh`), and the
 * identity and billing clients are stubbed, which is the house rule: a render
 * test has no way to open a socket or reach the network.
 *
 * The router is different, and stubbing it would have cost more than it bought.
 * `TextLink` and `CardLink` are the app's own two link primitives and they wrap
 * the framework's `Link`, which reads the router out of React context and
 * throws `Cannot read properties of null (reading 'isServer')` with no
 * provider above it. There is no seam to stub there without either mocking
 * `@tanstack/react-router` wholesale — which also replaces the `Link` every
 * page renders, so the stub stops being a stub of one thing — or threading a
 * second navigation context through thirty call sites.
 *
 * A real router on a memory history costs nothing: no socket, no `window.history`,
 * no globals shared between tests, and the links render real `<a href>`s, so a
 * test asserting `getByRole("link", { name: "Sign in" })` asserts on the same
 * element a person would click.
 *
 * It is also the honest seam for assertions about *where* a test ended up —
 * see the `router` on the returned object below.
 */
export function createTestRouter(initialPath = "/") {
  return getRouter({ history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

export type RenderWithRouterResult = RenderResult & {
  /**
   * The router this render mounted, for asserting where it ended up.
   *
   * `router.state.location.pathname` is the real answer to "signing in lands
   * you on the accounts list". It is an addition to the `RenderResult` the
   * house already returns, not a replacement: `src/lib/navigation` remains the
   * seam a test stubs when it only cares that a push was *requested*.
   */
  router: ReturnType<typeof createTestRouter>;
};

/**
 * Renders a tree inside the router the app mounts in `src/routes/__root.tsx`.
 *
 * For the many tests that exercise a primitive with no provider stack at all —
 * a link's focus ring, the landing page's own links — where reaching for
 * `renderWithProviders` and scripting an identity client would be noise.
 */
export function renderWithRouter(
  ui: ReactElement,
  options: { path?: string } & Omit<RenderOptions, "wrapper"> = {},
): RenderWithRouterResult {
  const { path, ...renderOptions } = options;
  const router = createTestRouter(path);

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  );

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), router };
}

/**
 * Renders a tree inside the same provider stack the app mounts in
 * `src/routes/__root.tsx`, with a scripted identity client and a real router.
 * `Providers` is given the stub instead of building a real one, so a render
 * test has no way to open a socket.
 *
 * The token store defaults to the real `localStorage` one, deliberately: a test
 * that writes a token and then reads it back through a different store proves
 * nothing about persistence. `src/test/setup.ts` clears it between tests.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: {
    identity: IdentityClient;
    billing?: BillingClient;
    box?: BoxClient;
    operator?: OperatorClient;
    tokens?: TokenStore;
    path?: string;
  } & Omit<RenderOptions, "wrapper">,
): RenderWithRouterResult {
  const { identity, billing, box, operator, tokens, path, ...renderOptions } = options;
  const store = tokens ?? createTokenStore();

  // The router is ABOVE `Providers`, which is the order `__root.tsx` mounts
  // them in. It is the same nesting rather than a convenient one: a screen that
  // reaches for the router from inside the provider stack has to find it there,
  // so that is where the harness puts it.
  const router = createTestRouter(path);

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <RouterContextProvider router={router}>
      <Providers identity={identity} billing={billing} box={box} operator={operator} tokens={store}>
        {children}
      </Providers>
    </RouterContextProvider>
  );

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), router };
}
