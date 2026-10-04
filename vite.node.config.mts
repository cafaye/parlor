import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { copyFontFiles, sharedConfig } from "./vite.shared";

/**
 * THE NODE BUILD, and it exists because retiring the Node target was measured to
 * be worse than carrying a second build path.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND CONFIG AND NOT A MODE OF THE FIRST ONE
 * ---------------------------------------------------------------------------
 * `cloudflare()` and `nitro()` both take over the `ssr` environment: one
 * configures it to be bundled by workerd and written to `dist/server/`, the
 * other hands it to Nitro's own build and written to `.output/`. They are
 * alternative providers of the same environment, and the framework's deployment
 * guide shows each in its own `defineConfig`. So they are two configs and
 * `npm run build` / `npm run build:node`, rather than one config with a flag
 * whose combinations are four and whose tested combinations are two.
 *
 * `sharedConfig` and `copyFontFiles` are IMPORTED from `vite.shared.ts` rather
 * than restated, so the tsconfig-path resolution and the webfont copy cannot
 * drift between the two builds. That drift would be invisible in a rendered
 * string: every page would be unstyled and every route would still answer.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NODE TARGET IS KEPT AT ALL, GIVEN CLOUDFLARE IS THE DEPLOY STORY
 * ---------------------------------------------------------------------------
 * Because `e2e/docker-compose.yml` builds `parlor` from this repository's
 * `Dockerfile` with `context: .` and runs it as a container on the compose
 * network, and because that tier is the only thing in this repository that
 * proves the app works against a real `identity` and a real `billing`. Deleting
 * the Dockerfile would not be "removing a dead deploy target"; it would delete
 * the whole-stack end-to-end tier, and the next thing that broke in the BFF
 * would be found by nothing.
 *
 * The alternative was carrying `server/index.mjs` and `server/adapter.mjs`
 * forward instead of Nitro, which would have kept the count of build paths at
 * one and the hand-rolled Node-to-Web adapter alive. That is the thing this
 * packet exists to delete — an adapter is where a cookie gets joined with ", "
 * and where a `..` reaches the filesystem — and the framework's own answer for
 * Node is Nitro. So the Node target is kept, and the hand-rolled server is not.
 *
 * `nitro-nightly` rather than a pinned release is what the framework's guide
 * spells, and it is a real cost: a nightly can change under this lockfile. It
 * is called out in the packet report rather than left to be discovered.
 */
export default defineConfig({
  ...sharedConfig,
  // `.output/public`, not `dist/client`: see `copyFontFiles`' header. Nitro
  // serves from `.output/public` and populates it before `closeBundle` runs, so
  // the Cloudflare build's destination would leave this one serving a stylesheet
  // that names 118 files it does not have — measured, not anticipated.
  plugins: [tanstackStart(), nitro(), viteReact(), copyFontFiles(".output/public/assets/files")],
});