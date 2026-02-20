#!/bin/sh
# Fixes /app/data permissions at startup, then exec's CMD (e.g. doppler run -- gosu discordbot node index.js).

set -e

# Ensure data directory exists and has correct permissions
fix_permissions() {
    if [ -d /app/data ]; then
        chown -R discordbot:nodejs /app/data 2>/dev/null || true
        chmod 750 /app/data 2>/dev/null || true
        if [ -f /app/data/database.sqlite ]; then
            chown discordbot:nodejs /app/data/database.sqlite 2>/dev/null || true
            chmod 600 /app/data/database.sqlite 2>/dev/null || true
        fi
    else
        mkdir -p /app/data
        chown -R discordbot:nodejs /app/data
        chmod 750 /app/data
    fi
}

fix_permissions
exec "$@"

