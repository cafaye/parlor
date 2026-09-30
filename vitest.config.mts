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
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
