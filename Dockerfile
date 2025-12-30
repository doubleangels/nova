FROM node:24-alpine AS base

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache dumb-init su-exec

# Create user and group in a single layer
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001

# Copy package files for dependency installation
COPY package*.json ./

# Build stage for native modules
FROM base AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache --virtual .build-deps \
    python3 \
    py3-setuptools \
    make \
    g++ \
    build-base

# Install dependencies with BuildKit cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefer-offline && \
    npm cache clean --force

# Remove build dependencies to reduce image size
RUN apk del .build-deps

# Final runtime stage
FROM base AS runtime

# Copy node_modules from builder stage
COPY --from=builder --chown=discordbot:nodejs /app/node_modules ./node_modules

# Copy application files
COPY --chown=discordbot:nodejs . .

# Copy and set up entrypoint script (as root so it can fix permissions)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Ensure WORKDIR ownership is correct
RUN chown -R discordbot:nodejs /app

# Create data directory for database persistence
# 750 = rwxr-x--- (owner: read/write/execute, group: read/execute, others: no access)
RUN mkdir -p /app/data && chown -R discordbot:nodejs /app/data && chmod 750 /app/data

# Create volume mount point for database persistence
VOLUME ["/app/data"]

# Document expected environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV DISCORD_BOT_TOKEN=
ENV BASE_EMBED_COLOR=

# Entrypoint runs as root to fix permissions, then switches to discordbot user
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

CMD ["su-exec", "discordbot", "node", "index.js"]
