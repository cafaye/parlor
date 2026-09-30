# syntax=docker/dockerfile:1
# parlor — the cafaye app shell.
#
# Multi-stage node:slim build. Tests are NOT run in the image: `bin/prime`
# proves the checkout locally and CI gates the merge. The image only has to
# build and run.

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# --- deps -------------------------------------------------------------------
# `npm ci` (not `npm install`) so the image installs the committed lockfile.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ----------------------------------------------------------------
FROM base AS builder
WORKDIR /app
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

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
