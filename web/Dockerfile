# Build context must be the REPO ROOT, not web/ — this Dockerfile needs both
# web/ and system-prompts/ (see scripts/sync-system-prompts.mjs). Build from
# the repo root with:
#
#   docker build -f web/Dockerfile -t storimac-web .
#
# Runs on Cloud Run: listens on $PORT (Cloud Run sets this; defaults to 8080
# for local `docker run`).

FROM node:20-alpine AS deps
WORKDIR /repo/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /repo
COPY system-prompts/ ./system-prompts/
COPY web/ ./web/
COPY --from=deps /repo/web/node_modules ./web/node_modules
WORKDIR /repo/web
# ANTHROPIC_API_KEY is not needed at build time (only /api/chat at request
# time), so no build secrets required here.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /repo/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /repo/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/web/.next/static ./.next/static

USER nextjs
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
