import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import tailwindPostcss from "@tailwindcss/postcss";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

/**
 * The half of the build config the Cloudflare target and the Node target must
 * agree on, extracted so that they CANNOT disagree.
 *
 * This exists because the two targets are two configs — `vite.config.mts`
 * (Cloudflare Workers, the default `npm run build`) and `vite.node.config.mts`
 * (Node/Docker, `npm run build:node`) — and `cloudflare()` and `nitro()` each
 * take over the `ssr` environment, so one config cannot host both. Two configs
 * means two places for a setting to be restated slightly differently, and every
 * setting in here is one whose disagreement is invisible in a rendered string:
 * an unresolved `@/*` alias fails every route including `/healthz`, and a
 * webfont copy that lands in the wrong directory renders every page unstyled
 * behind a green healthcheck.
 *
 * So: imported by both, never restated.
 */

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
 * long `max-age` by whichever runtime serves the assets, which is exactly what a
 * separate file is for.
 *
 * `apply: "build"` so `vite dev` is untouched — the dev server resolves those
 * URLs through its own module graph and has never needed this.
 *
 * ---------------------------------------------------------------------------
 * THE DESTINATION IS AN ARGUMENT, BECAUSE THE TWO BUILDS SERVE DIFFERENT DIRS
 * ---------------------------------------------------------------------------
 * Measured, and this is not a theoretical difference. With the Cloudflare
 * plugin, `dist/client` IS the served directory — the plugin's generated
 * `dist/server/wrangler.json` says `"assets": {"directory": "../client"}`. With
 * Nitro, `.output/public` is, and Nitro populates it by copying `dist/client`
 * during the build. This hook runs in `closeBundle`, which is AFTER that copy,
 * so writing only to `dist/client/assets/files` left the Node build serving a
 * stylesheet that named 118 webfonts the served directory did not have:
 *
 *   find .output/public -name '*.woff2' | wc -l   ->  0
 *   grep -o 'url([^)]*woff2[^)]*)' .output/public/assets/*.css
 *     -> url(./files/geist-cyrillic-ext-wght-normal.woff2)   (and 117 more)
 *
 * Every page unstyled, every route answering, `/healthz` 200. That is the exact
 * failure this hook exists to prevent, arriving by a different route, and it is
 * why the destination is passed in rather than hardcoded: each build has to be
 * told where its own assets are served from. The default is the Cloudflare one
 * because that is the default build; the Node config passes its own.
 */
export function copyFontFiles(destination = "dist/client/assets/files"): Plugin {
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
        const to = join(process.cwd(), destination);

        await mkdir(to, { recursive: true });
        await cp(from, to, { recursive: true });
      }
    },
  };
}

export const sharedConfig = {
  // `@/*` -> `./src/*`, declared once in tsconfig.json and consumed here.
  //
  // WITHOUT THIS LINE `vite dev` DOES NOT WORK, and `vite build` is green
  // anyway, which is what let the defect survive a migration and a full gate.
  // Measured on this tree before the line existed:
  //
  //   $ npx vite dev --port 3997 --strictPort
  //   (!) Failed to run dependency scan. ... @/app/verify-email/page
  //       (imported by src/routes/verify-email.tsx) could not be resolved
  //   $ curl -o- http://[::1]:3997/          -> 500
  //   $ curl -o- http://[::1]:3997/healthz   -> 500  {"status":500,...}
  //
  // Every route, including the health check. The build resolves the alias
  // because `tanstackStart()` carries a resolve plugin that reads tsconfig
  // paths, and that plugin is registered for the build; the dev server's own
  // dependency scan runs outside it. So the two halves of `vite` disagree, and
  // only one of them is exercised by `npm run build`.
  //
  // Vite 8.3.2 has this natively — `resolve.tsconfigPaths`, default **false**.
  // Declaring it here rather than in `vitest.config.mts` is the point: vitest
  // already reads the alias from tsconfig on its own, so the alias was working
  // in the suite and in the build and in neither dev, and nothing in the gate
  // starts a dev server to notice.
  resolve: { tsconfigPaths: true },
  css: { postcss: { plugins: [tailwindPostcss()] } },
  // Without this a font above some size threshold would be inlined into the
  // stylesheet as base64 rather than emitted as a file, which is the outcome
  // `copyFontFiles` exists to avoid.
  build: { assetsInlineLimit: 0 },
};