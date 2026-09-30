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

# Next inlines NEXT_PUBLIC_* into the client bundle at BUILD time, so the value
# has to be here or it is not going to be anywhere: setting it later, in
# `docker run -e`, changes nothing because the string is already in the
# JavaScript. Verified by grepping the built chunk for this value.
#
#   docker build --build-arg NEXT_PUBLIC_IDENTITY_URL=https://identity.example.com .
#
# The default is the compose-stack address, which is what a local build wants.
ARG NEXT_PUBLIC_IDENTITY_URL=http://localhost:8080
ENV NEXT_PUBLIC_IDENTITY_URL=$NEXT_PUBLIC_IDENTITY_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner -----------------------------------------------------------------
# Non-root, standalone output: only .next/standalone, .next/static and public
# are carried forward, so no devDependencies or sources land in the image.
FROM node:22-slim AS runner
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
