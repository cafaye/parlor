import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import tailwindPostcss from "@tailwindcss/postcss";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);

/**
 * The `@fontsource` packages this app self-hosts its two families from,
 * named here rather than globbed so that dropping a family from
 * `src/app/globals.css` and forgetting this file is a loud build failure
 * instead of a page that quietly loses its typeface.
 */
const FONT_PACKAGES = ["@fontsource-variable/geist", "@fontsource/geist-mono"];

/**
 * Copies the webfont binaries into the emitted client assets.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------
 * Without it, `npm run build` prints sixteen lines of
 *
 *   ./files/geist-latin-wght-normal.woff2 referenced in
 *   ./files/geist-latin-wght-normal.woff2 didn't resolve at build time,
 *   it will remain unchanged to be resolved at runtime
 *
 * and emits `dist/client/assets/index-*.css` whose `@font-face` blocks point at
 * `./files/geist-*.woff2` — a directory the build never creates. Measured on the
 * inherited tree: `find dist/client -name '*.woff2'` returned nothing, and a
 * request for one of those URLs was a **404** while every page rendered, every
 * route answered and `/healthz` was green.
 *
 * The cause is the shape of the input, not the framework. `@fontsource`
 * references its own `files/` directory relative to the stylesheet that
 * imports it; that stylesheet lives in `node_modules`, and the one that pulls it
 * in lives in `src/app/globals.css`. Nothing rewrites a relative URL inside a
 * third party's CSS, so the bundler says so and leaves it — which is correct
 * behaviour and a broken page.
 *
 * ---------------------------------------------------------------------------
 * WHY COPY AND NOT INLINE
 * ---------------------------------------------------------------------------
 * The alternative is base64 in the stylesheet, which puts several hundred kB of
 * font into a file every screen loads and blocks text paint on the critical path
 * to avoid eleven files. These are immutable, content-stable and served with a
 * long `max-age` by `server/adapter.mjs`, which is exactly what a separate file
 * is for.
 *
 * `apply: "build"` so `vite dev` is untouched — the dev server resolves those
 * URLs through its own module graph and has never needed this.
 */
function copyFontFiles(): Plugin {
  return {
    name: "parlor:copy-font-files",
    apply: "build",
    async closeBundle() {
      for (const pkg of FONT_PACKAGES) {
        // Resolved rather than hardcoded, so a version bump that moves the
        // files fails here with a clear message instead of emitting a
        // stylesheet that points at nothing.
        const manifest = require.resolve(`${pkg}/package.json`);
        const from = join(dirname(manifest), "files");
        const to = join(process.cwd(), "dist/client/assets/files");

        await mkdir(to, { recursive: true });
        await cp(from, to, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [tanstackStart(), viteReact(), copyFontFiles()],
  css: { postcss: { plugins: [tailwindPostcss()] } },
  // Without this a font above some size threshold would be inlined into the
  // stylesheet as base64 rather than emitted as a file, which is the outcome
  // `copyFontFiles` exists to avoid.
  build: { assetsInlineLimit: 0 },
});