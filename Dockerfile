# Use the official Node image based on Alpine Linux
FROM node:22-alpine AS base

# Set the working directory in the container
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies with production optimizations
RUN npm ci --only=production && npm cache clean --force

# Copy the rest of your application code
COPY --chown=discordbot:nodejs . .

# Switch to non-root user
USER discordbot

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Define the default command to run your application
CMD ["node", "start.js"]
