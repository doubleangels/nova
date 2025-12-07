FROM node:24-alpine AS base

WORKDIR /app

RUN apk add --no-cache dumb-init su-exec

RUN npm install -g npm@latest

RUN node --version && npm --version

RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001

COPY package*.json ./

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache --virtual .build-deps \
    python3 \
    py3-setuptools \
    make \
    g++ \
    build-base

RUN npm ci --omit=dev && npm cache clean --force

# Remove build dependencies to reduce image size
RUN apk del .build-deps

COPY --chown=discordbot:nodejs . .

# Copy and set up entrypoint script (as root so it can fix permissions)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create data directory for database persistence
# 750 = rwxr-x--- (owner: read/write/execute, group: read/execute, others: no access)
RUN mkdir -p /app/data && chown -R discordbot:nodejs /app/data && chmod 750 /app/data

# Create volume mount point for database persistence
VOLUME ["/app/data"]

# Entrypoint runs as root to fix permissions, then switches to discordbot user
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

CMD ["su-exec", "discordbot", "node", "index.js"]
