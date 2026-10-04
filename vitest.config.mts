import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `.mts` (not `.ts`): package.json has no "type": "module", so a `.ts` config
// is loaded as CommonJS and trips Vite's native config loader warning.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json — tests and app code must
    // resolve modules the same way, or typecheck passes and vitest fails.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // `server/**/*.test.mjs` USED to be in here, because `server/adapter.mjs` was
    // plain JavaScript that Node ran directly — it could not live under `src/`
    // without becoming a module the bundler owns — and it carried real logic that
    // would otherwise have been untested. That adapter is deleted; the app
    // deploys to Cloudflare Workers and the Node target uses `nitro`, so there is
    // no hand-rolled server left to test and no `server/` directory. The glob is
    // removed rather than left matching nothing: a test glob that silently matches
    // no file is the same failure as a check that cannot fail, and the seventeen
    // tests it used to pick up are accounted for by name in `gate.yml`.
    //
    // Every test this repository has is therefore under `src/`, which is worth
    // stating plainly rather than leaving to be discovered: if you add a test
    // outside `src/`, it will not run, and `bin/prime` will not notice.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
