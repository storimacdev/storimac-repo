# Manual Cloud Run deploy path (Firebase App Hosting doesn't support custom
# Dockerfile builds — it's buildpacks-only — so this is for direct
# `gcloud run deploy` / `docker build` use, not App Hosting). Self-contained
# within web/ — build context is this directory:
#
#   docker build -t storimac-web .
#
# Runs on Cloud Run: listens on $PORT (Cloud Run sets this; defaults to 8080
# for local `docker run`).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# ANTHROPIC_API_KEY is not needed at build time (only /api/chat at request
# time), so no build secrets required here.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
