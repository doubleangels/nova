# Dockerfile for Nova Bot
# Multi-stage build for optimized image size and security

# Use specific Node.js version for reproducibility
FROM node:24.1.0-alpine AS base

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

# Install dependencies for Bitwarden Secrets Manager
RUN apk add --no-cache \
  ca-certificates \
  curl \
  jq \
  unzip

# Download bws (using musl for Alpine Linux)
# Support both amd64 and arm64 architectures
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      BWS_ARCH="x86_64-unknown-linux-musl"; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
      BWS_ARCH="aarch64-unknown-linux-musl"; \
    else \
      echo "Unsupported architecture: $TARGETARCH" && exit 1; \
    fi && \
    curl -LO https://github.com/bitwarden/sdk/releases/download/bws-v1.0.0/bws-${BWS_ARCH}-1.0.0.zip && \
    unzip bws-${BWS_ARCH}-1.0.0.zip -d /tmp && \
    mv /tmp/bws /usr/local/bin/bws && \
    rm -f bws-${BWS_ARCH}-1.0.0.zip && \
    chmod +x /usr/local/bin/bws && \
    bws --version

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

# Add health check (adjust based on your application)
# This is a simple check - you may want to add a proper health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Entrypoint runs as root to fix permissions, then switches to discordbot user
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

CMD ["su-exec", "discordbot", "node", "index.js"]