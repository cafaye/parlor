import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { copyFontFiles, sharedConfig } from "./vite.shared";

/**
 * THE CLOUDFLARE BUILD. This is the default `npm run build`, the one `bin/prime`
 * runs and the one `wrangler deploy` consumes. It emits a Worker.
 *
 * `cloudflare()` FIRST, and the order is not a preference — it is what the
 * framework's own deployment guide spells and what the plugin pair requires:
 * `cloudflare()` installs the `ssr` environment's build hook (and the
 * workerd-backed dev runtime) BEFORE `tanstackStart()` decides what to build
 * into it, so a reversed array is a `tanstackStart()` that has already
 * configured an environment nothing is going to run in. The shape is read out of
 * `node_modules/@tanstack/start-client-core/skills/start-core/deployment/SKILL.md`
 * rather than guessed.
 *
 * It replaces nothing this tree had: `server/index.mjs` and
 * `server/adapter.mjs` existed only to bind the built fetch handler to a Node
 * socket, and Cloudflare supplies the server. Same routes, same BFF, same
 * health endpoints — this changes where the server runs, not what it does.
 *
 * WHAT IS DELIBERATELY NOT HERE, because a static build would be a security
 * regression rather than a simplification. `src/app/v1/[...path]/route.ts`
 * reads `process.env.IDENTITY_URL` / `BILLING_URL` on the server and rebuilds
 * the upstream path from an allow-list of twenty-six routes. No server means the
 * browser calls `identity` and `billing` directly with the address baked into the
 * client bundle, and that file's own header says why that is the trap: "a value
 * the browser can read is a value the browser can change, and for a forwarder
 * that is the difference between a fixed destination and an attacker's." So: no
 * `prerender`, no `ssr: false`, no SPA mode, no `defaultSsr`.
 *
 * The Node/Docker build is `vite.node.config.mts`, not a flag on this file — see
 * that file's header for why it is a second config rather than a mode. What the
 * two share (the tsconfig-path resolution, the postcss/Tailwind pair and the
 * webfont copy) is imported from `vite.shared.ts` rather than restated, because
 * each of those three fails in a way no rendered string shows.
 */
export default defineConfig({
  ...sharedConfig,
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tanstackStart(), viteReact(), copyFontFiles()],
});