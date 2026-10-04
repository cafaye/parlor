import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The build. Vite, because TanStack Start is a Vite framework rather than a
 * bundler configuration — the previous `next.config.ts` was three lines and its
 * whole job was `output: "standalone"`, which the `Dockerfile` then copied.
 * The artifact that replaced it is `.output/`, produced by `npm run build`
 * below, and the Dockerfile copies that.
 *
 * ORDER IS LOAD-BEARING: `tanstackStart()` must come before `viteReact()`.
 * The Start plugin owns the route generator and the server-function transform,
 * and both have to see a module graph the React plugin has not already claimed.
 * Reversed, route generation fails inside the React plugin's transform with an
 * error that names neither plugin.
 */
export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
});