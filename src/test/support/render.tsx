import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { Providers } from "@/app/providers";
import type { IdentityClient } from "@/lib/identity";
import { createTokenStore, type TokenStore } from "@/lib/token-store";

/**
 * Renders a tree inside the same provider stack the app mounts in `layout.tsx`,
 * with a scripted identity client. `Providers` is given the stub instead of
 * building a real one, so a render test has no way to open a socket.
 *
 * The token store defaults to the real `localStorage` one, deliberately: a test
 * that writes a token and then reads it back through a different store proves
 * nothing about persistence. `src/test/setup.ts` clears it between tests.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { identity: IdentityClient; tokens?: TokenStore } & Omit<RenderOptions, "wrapper">,
): RenderResult {
  const { identity, tokens, ...renderOptions } = options;
  const store = tokens ?? createTokenStore();

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Providers identity={identity} tokens={store}>
      {children}
    </Providers>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
