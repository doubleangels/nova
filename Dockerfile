FROM node:24-alpine AS base

WORKDIR /app

RUN apk add --no-cache dumb-init su-exec

RUN npm install -g npm@latest

RUN node --version && npm --version

RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=discordbot:nodejs . .

# Copy and set up entrypoint script (as root so it can fix permissions)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create data directory for database persistence
RUN mkdir -p /app/data && chown -R discordbot:nodejs /app/data && chmod 755 /app/data

# Create volume mount point for database persistence
VOLUME ["/app/data"]

# Entrypoint runs as root to fix permissions, then switches to discordbot user
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

CMD ["su-exec", "discordbot", "node", "index.js"]
