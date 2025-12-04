#!/bin/sh
set -e

# Ensure data directory exists and has correct permissions
# This script runs as root to fix permissions, then executes the command as the specified user

if [ -d /app/data ]; then
    # Fix ownership and permissions for the data directory
    chown -R discordbot:nodejs /app/data 2>/dev/null || true
    chmod 755 /app/data 2>/dev/null || true
    # Ensure the database.json file (if it exists) has correct permissions
    if [ -f /app/data/database.json ]; then
        chown discordbot:nodejs /app/data/database.json 2>/dev/null || true
        chmod 644 /app/data/database.json 2>/dev/null || true
    fi
else
    # Create the directory if it doesn't exist
    mkdir -p /app/data
    chown -R discordbot:nodejs /app/data
    chmod 755 /app/data
fi

# Execute the main command (su-exec will switch to discordbot user)
exec "$@"
