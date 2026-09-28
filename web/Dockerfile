# syntax=docker/dockerfile:1.7
#
# Sentinel Quiz web (Next.js standalone output).
# Base image pinned by digest (Node 22 LTS); Dependabot keeps it fresh.
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS base

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# ---------------------------------------------------------------------------
# deps: reproducible install from the committed lockfile (fails without it)
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM base AS builder

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . ./

RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ---------------------------------------------------------------------------
# runner: only the standalone server, non-root
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

RUN addgroup -S app \
    && adduser -S app -G app

COPY --from=builder /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
