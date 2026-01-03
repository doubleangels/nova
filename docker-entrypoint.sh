#!/bin/sh
set -e

# Ensure data directory exists and has correct permissions
# This script runs as root to fix permissions, then executes the command as the specified user

if [ -d /app/data ]; then
    # Fix ownership and permissions for the data directory
    # 750 = rwxr-x--- (owner: read/write/execute, group: read/execute, others: no access)
    chown -R discordbot:nodejs /app/data 2>/dev/null || true
    chmod 750 /app/data 2>/dev/null || true
    
    # Ensure the database.sqlite file (if it exists) has correct permissions
    # 600 = rw------- (owner: read/write, group: no access, others: no access)
    if [ -f /app/data/database.sqlite ]; then
        chown discordbot:nodejs /app/data/database.sqlite 2>/dev/null || true
        chmod 600 /app/data/database.sqlite 2>/dev/null || true
        # Log database file info for debugging
        echo "Database file found: /app/data/database.sqlite"
        ls -lh /app/data/database.sqlite 2>/dev/null || true
    else
        echo "Database file not found: /app/data/database.sqlite (will be created on first use)"
    fi
else
    # Create the directory if it doesn't exist
    # 750 = rwxr-x--- (owner: read/write/execute, group: read/execute, others: no access)
    mkdir -p /app/data
    chown -R discordbot:nodejs /app/data
    chmod 750 /app/data
    echo "Created data directory: /app/data"
fi

# Execute the main command (su-exec will switch to discordbot user)
exec "$@"
