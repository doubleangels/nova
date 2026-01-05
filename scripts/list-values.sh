#!/bin/sh
# Wrapper script to run list-values.js as the correct user

# Check if running as root
if [ "$(id -u)" = "0" ]; then
    # Check if gosu is available
    if command -v gosu >/dev/null 2>&1; then
        exec gosu discordbot node /app/list-values.js "$@"
    else
        echo "Error: Running as root but gosu is not available."
        echo "Please run: gosu discordbot node list-values.js"
        exit 1
    fi
else
    # Not root, run directly
    exec node /app/list-values.js "$@"
fi

