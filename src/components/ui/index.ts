/**
 * Layout primitives barrel — intentionally empty.
 *
 * Phase 1 owns only the theme (`src/styles/tokens.css`), the app shell in
 * `src/app/layout.tsx`, and the two health surfaces. The first primitives
 * (Button, Card, Field, Dialog…) land in Phase 2 together with shadcn/ui,
 * which installs its primitives into this directory so there is one import
 * path for the whole product.
 *
 * Convention for Phase 2: one component per file, named export, no default
 * export, and re-export it from here.
 */
export {};
