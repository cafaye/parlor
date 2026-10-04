# syntax=docker/dockerfile:1
# parlor — the cafaye app shell.
#
# Multi-stage node:slim build. Tests are NOT run in the image: `bin/prime`
# proves the checkout locally and CI gates the merge. The image only has to
# build and run.
#
# The base is the PINNED runtime, `node:22.22.2-slim`, not `node:22-slim`. The
# unpinned tag resolved to 22.23.3 and the image would then have run a different
# Node than the one `engines.node` and `bin/prime` verify. One pin, four
# mirrors, and the image is the fourth — see tests/validate-ci.sh.

FROM node:22.22.2-slim AS base
ENV NODE_ENV=production

# --- deps -------------------------------------------------------------------
# `npm ci` (not `npm install`) so the image installs the committed lockfile.
FROM base AS deps
WORKDIR /app
# `.npmrc` is copied, not assumed: it carries `engine-strict=true`, and without
# it in this build context the image happily installs on a Node the pin
# forbids — the exact "warned instead of failed" hole the repository has a test
# for on the host.
COPY package.json package-lock.json .npmrc ./
# `--include=dev` and not plain `npm ci`, because NODE_ENV=production is
# inherited from `base` and npm reads that as "production dependencies only".
# The builder stage below needs `typescript` and `@tailwindcss/postcss`; without
# them `npm run build` dies with `Cannot find module '@tailwindcss/postcss'`,
# which names a CSS plugin and not the reason. This was measured, not inferred
# — see CHANGELOG, "Known gaps", where the broken build was recorded first.
RUN npm ci --include=dev

# --- prod-deps --------------------------------------------------------------
# A production-only tree for the runner stage to copy, resolved from the SAME
# committed lockfile. It is a separate stage rather than a second `npm ci` in
# `deps`: `npm ci` DELETES node_modules before it installs, so running it twice in
# one stage would leave the build stage holding the pruned tree and fail with
# `Cannot find module 'vite'`.
FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# --- builder ----------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# NO BUILD ARGS, AND THAT IS THE BFF.
#
# This stage used to declare two:
#
#   ARG NEXT_PUBLIC_IDENTITY_URL=http://localhost:8080
#   ENV NEXT_PUBLIC_IDENTITY_URL=$NEXT_PUBLIC_IDENTITY_URL
#   ARG NEXT_PUBLIC_BILLING_URL=http://localhost:3000
#   ENV NEXT_PUBLIC_BILLING_URL=$NEXT_PUBLIC_BILLING_URL
#
# with a long argument for why they could not be anything else. The argument was
# right, and the reason it no longer applies is this file's history in one
# sentence: the previous framework text-substituted every `NEXT_PUBLIC_*` into the
# client bundle at BUILD time, so a value set at RUN time was not a later value,
# it was no value at all,
# and a build that omitted one shipped an app talking to `localhost` while
# exiting 0. That failure was silent, which is the part worth keeping.
#
# They are gone because the browser no longer needs to know where identity is.
# `src/app/v1/[...path]/route.ts` answers `/v1/*` on this app's own origin and
# forwards to identity from the server, where the address is an ordinary variable
# read at request time. So:
#
#   * `IDENTITY_URL` and `BILLING_URL` are declared in `config/deploy.yml` under
#     `env.clear` and arrive in the RUNNER stage's environment. No ARG, no ENV,
#     nothing at build time.
#   * ONE IMAGE SERVES EVERY ENVIRONMENT. The build is no longer
#     environment-specific, which is a real improvement and not only a
#     consequence: a wrong build arg used to produce a working image and a broken
#     app, and a missing variable now produces a container that refuses sign-in
#     and says so.
#   * The client bundle contains no service address at all.
#     `src/app/v1/[...path]/route.test.ts` asserts that against the BUILT chunks
#     in `dist/client/assets`, not against this file, because this file is not what
#     the browser downloads.
#
# If a `NEXT_PUBLIC_*` service address ever reappears here, the BFF has been
# bypassed and every claim above is void: a value the browser can read is a value
# the browser can change, and for a forwarder that is the difference between a
# fixed destination and an attacker's.

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `build:node`, not `build`, and the runner stage's header says why: this image
# ships a Node server and `npm run build` emits a Worker. The Cloudflare build
# still runs in `bin/prime` and in the `build` job in `.github/workflows/ci.yml`,
# so neither target is unbuilt by choosing the other here.
RUN npm run build:node

# --- runner -----------------------------------------------------------------
# Non-root: only the build output and `node_modules` are carried forward, so no
# devDependencies and no sources land in the image.
#
# WHY THIS IMAGE STILL EXISTS, GIVEN CLOUDFLARE IS THE DEPLOY STORY. It is
# written down here rather than left as an unexplained artifact. Two reasons,
# and the first one is load-bearing:
#
#   1. `e2e/docker-compose.yml` builds `parlor` from this file with
#      `context: .` and runs it as a container on the compose network. That tier
#      is the only thing in this repository that proves the app works against a
#      real `identity` and a real `billing`, and deleting this Dockerfile would
#      not have been "removing a dead deploy target" — it would have deleted the
#      whole-stack end-to-end tier along with the e2e workflow's required job.
#   2. A Node target is a genuine capability, and the framework's own answer for
#      it is `nitro`, which is what `npm run build:node` runs. The alternative
#      was carrying `server/index.mjs` and `server/adapter.mjs` forward, which
#      keeps the hand-rolled Node-to-Web adapter this packet exists to delete.
#
# THE BUILD IS `npm run build:node`, NOT `npm run build`, and that distinction is
# the whole difference between the two targets:
#
#   npm run build        ->  vite.config.mts      ->  dist/server/index.mjs
#                            `cloudflare()` plugin      a WORKER, consumed by
#                            `wrangler deploy`          `wrangler.jsonc`
#
#   npm run build:node   ->  vite.node.config.mts ->  .output/
#                            `nitro()` plugin           a Node server, run by
#                                                       `node .output/server/index.mjs`
#
# Building the Cloudflare output and shipping it as a Node container would produce
# an image that exits 0 and answers nothing, because `dist/server/index.mjs`
# default-exports a fetch handler and does not listen. So the builder below runs
# the Node build, and `.output/` is what this image ships.
#
# PINNED, LIKE THE BUILDER STAGE, AND IT WAS NOT. This line said `node:22-slim`
# while the stage above said `node:22.22.2-slim`, so the image built on the pin
# and RAN on whatever `22-slim` resolved to that week — measured while writing
# the deploy config: `docker manifest inspect node:22-slim` resolves a moving
# multi-arch index, and the file's own header claims "One pin, four mirrors, and
# the image is the fourth". For a service with no database, the runtime it
# executes on is most of what it is, and a deploy config cannot fix an image that
# boots a different Node than the one `npm test` and `bin/prime` verified. The
# header's claim is now a check rather than a comment — `tests/validate-ci.sh`
# fails the gate on an unpinned `FROM node:` anywhere in this file.
FROM node:22.22.2-slim AS runner
WORKDIR /app
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# The production dependency tree, from `prod-deps` — NOT from `builder`, whose
# tree still carries `vite`, `typescript` and the whole build toolchain. Nitro's
# output imports its runtime dependencies by name (`srvx`, `h3-v2`,
# `@tanstack/react-router`), so this directory is not optional decoration and
# copying the builder's would work only by shipping every devDependency.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
#
# `.output/` AND NOTHING ELSE, and the second thing inside it is the reason this
# COPY is not simply `COPY .output .output` with a comment. Nitro bundles the
# webfonts into `.output/public/assets/files/` and the emitted stylesheet names
# them with a relative `./files/…` URL, so an image carrying `.output/server`
# without `.output/public` is a container whose every page is unstyled — which
# passes the HEALTHCHECK below, because liveness is not legibility. Copying the
# whole directory is deliberate: `dist/client/assets/files/` is no longer where
# the Node target's fonts land, and a COPY that had to enumerate them would be
# one more place the two builds could disagree.
COPY --from=builder --chown=nextjs:nodejs /app/.output ./.output

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node .output/server/index.mjs`, and not `node dist/server/server.mjs`: the
# Cloudflare build's output default-exports `{ fetch(request) }` and does not
# listen. That is the same class of failure the previous CMD guarded against —
# a container that starts, prints nothing and exits 0 — so it is guarded by
# naming the file that actually listens.
CMD ["node", ".output/server/index.mjs"]
