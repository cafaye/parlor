import { useRouter } from "@tanstack/react-router";

/**
 * This app's navigation vocabulary, and the one seam every screen goes through.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS RATHER THAN A DIRECT `useRouter()` AT EACH CALL SITE
 * ---------------------------------------------------------------------------
 * Two reasons, one of which is testable and one of which is not.
 *
 * The testable one: a screen's navigation is a dependency, and a test that
 * asserts "signing in lands you on the accounts list" needs to stub it. Six
 * render suites do exactly that, and before this file they stubbed
 * `next/navigation` — a module name that no longer exists. Mocking
 * `@tanstack/react-router` wholesale would not work: that module also exports
 * `Link`, so a mock that replaces it would replace the links every page renders
 * with the same test, which is not a stub of one thing.
 *
 * The untestable one, which is the real reason: this app's navigation calls are
 * not `router.navigate({ to: "/login" })` and they are not `router.push(x)`.
 * They are `push(path)`. Naming them here means the shape a screen depends on
 * is one small file rather than the whole router API, and a framework upgrade
 * has exactly one place to change.
 *
 * ---------------------------------------------------------------------------
 * WHAT `refresh` IS, AND WHY IT IS NOT `router.invalidate()`
 * ---------------------------------------------------------------------------
 * Under the previous framework `router.refresh()` re-fetched the current route
 * on the server. The equivalent here is `invalidate()`, which re-runs the
 * matches for the current location — which is the same thing, because no route
 * in this app has a `loader`, so the thing being "refreshed" is the component
 * tree. No call site passes arguments to `refresh`, and none needs to.
 */
export type Navigation = {
  /** Go to a path, client-side. Resolves when the new location is committed. */
  push: (path: string) => Promise<void>;
  /** Re-render the current location from the router rather than from memory. */
  refresh: () => Promise<void>;
};

export function useNavigation(): Navigation {
  const router = useRouter();

  return {
    push: (path) => router.navigate({ to: path }),
    refresh: async () => {
      await router.invalidate();
    },
  };
}