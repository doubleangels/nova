# syntax=docker/dockerfile:1.4
# Dockerfile for Nova Bot
# Multi-stage build for smaller image and security. Alpine base for Doppler CLI (apk) and minimal footprint.

FROM node:24-alpine AS base

ENV NODE_ENV=production

WORKDIR /app

# Runtime deps: dumb-init, su-exec (drop root for node), procps (healthcheck pgrep)
RUN apk add --no-cache dumb-init su-exec procps && \
    addgroup -g 1001 nodejs && \
    adduser -u 1001 -G nodejs -s /bin/sh -D discordbot

# Copy package files for dependency installation (better caching)
COPY package*.json ./

# Build stage for native modules
FROM base AS builder

RUN --mount=type=cache,target=/root/.npm \
    apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del python3 make g++

# Final runtime stage
FROM base AS runtime

# Install Doppler CLI for runtime secrets (apk repo)
# Doppler config/cache dir; use /tmp so it works when root FS is read-only (compose tmpfs: /tmp)
ENV DOPPLER_CONFIG_DIR=/tmp
RUN apk add --no-cache ca-certificates wget && \
    wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler && \
    apk del wget

# Copy node_modules from builder stage (before app files for better caching)
COPY --from=builder --chown=discordbot:nodejs /app/node_modules ./node_modules

# Copy entrypoint script first (fixes /app/data permissions, then runs CMD)
COPY --chown=discordbot:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh

# Copy application files (this layer changes most frequently).
# Use a .dockerignore to exclude node_modules, .git, and other unneeded files from the build context.
COPY --chown=discordbot:nodejs . .

# Set permissions and create data directory in a single layer
RUN chmod +x /app/docker-entrypoint.sh && \
    mkdir -p /app/data && \
    chown -R discordbot:nodejs /app && \
    chmod 750 /app/data && \
    chmod +x /app/scripts/*.sh 2>/dev/null || true

# Create volume mount point for database persistence
VOLUME ["/app/data"]

# Add health check - verify the bot process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD pgrep -f "node.*index.js" > /dev/null || exit 1

# Entrypoint fixes data-dir permissions, then runs Doppler (inject secrets) + app. Pass DOPPLER_TOKEN when running.
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

CMD ["doppler", "run", "--", "su-exec", "discordbot", "node", "index.js"]
