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
#
# BOTH ARGs, AND NOT ONE. `NEXT_PUBLIC_BILLING_URL` was missing until the deploy
# packet, and the way it was missing is the argument for the check that now holds
# this file to config/deploy.yml: `docker build --build-arg` for a name this
# Dockerfile does not declare is a WARNING, not an error. So a caller could pass
# `--build-arg NEXT_PUBLIC_BILLING_URL=https://billing.example.com`, read the
# successful exit code, and ship an image whose billing client is the compiled-in
# default — `http://localhost:3000`, which is this app's own port, so the billing
# screens would have asked parlor to talk to itself. Nothing about that build
# looks wrong.
#
# The defaults below are the code's own (`DEFAULT_IDENTITY_URL` in
# `src/lib/identity.ts`, `DEFAULT_BILLING_URL` in `src/lib/billing.ts`), written
# out so the file says what an unparameterised build produces.
#
# WHY THESE CANNOT BE ENV VARS INSTEAD, because Kamal's `env.clear` looks like the
# natural home for them and is not: Next substitutes `NEXT_PUBLIC_*` at build
# time, so a run-time value is not a later value, it is no value at all. They
# arrive as `builder.args` in `config/deploy.yml`; `tests/validate-ci.sh` fails
# the gate when the names here and the names there stop being the same two.
ARG NEXT_PUBLIC_IDENTITY_URL=http://localhost:8080
ENV NEXT_PUBLIC_IDENTITY_URL=$NEXT_PUBLIC_IDENTITY_URL
ARG NEXT_PUBLIC_BILLING_URL=http://localhost:3000
ENV NEXT_PUBLIC_BILLING_URL=$NEXT_PUBLIC_BILLING_URL

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
