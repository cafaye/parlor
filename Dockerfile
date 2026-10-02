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
ENV NEXT_TELEMETRY_DISABLED=1
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
# them `next build` dies with `Cannot find module '@tailwindcss/postcss'`,
# which names a CSS plugin and not the reason. This was measured, not inferred
# — see CHANGELOG, "Known gaps", where the broken build was recorded first.
RUN npm ci --include=dev

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
# sentence: `next build` text-substitutes every `NEXT_PUBLIC_*` into the client
# bundle, so a value set at RUN time is not a later value, it is no value at all,
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
#     in `.next/static`, not against this file, because this file is not what the
#     browser downloads.
#
# If a `NEXT_PUBLIC_*` service address ever reappears here, the BFF has been
# bypassed and every claim above is void: a value the browser can read is a value
# the browser can change, and for a forwarder that is the difference between a
# fixed destination and an attacker's.

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner -----------------------------------------------------------------
# Non-root, standalone output: only .next/standalone, .next/static and public
# are carried forward, so no devDependencies or sources land in the image.
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

# There is no `public/` in this repository, and `COPY` of a path that is not
# there is a build failure — which is how the runner stage used to die after a
# perfectly good build. If a `public/` is ever added, copy it here, and drop
# this comment with it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
