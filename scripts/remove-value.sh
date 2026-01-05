#!/bin/sh
# Wrapper script to run remove-value.js as the correct user

# Check if running as root
if [ "$(id -u)" = "0" ]; then
    # Check if gosu is available
    if command -v gosu >/dev/null 2>&1; then
        exec gosu discordbot node /app/remove-value.js "$@"
    else
        echo "Error: Running as root but gosu is not available."
        echo "Please run: gosu discordbot node remove-value.js"
        exit 1
    fi
else
    # Not root, run directly
    exec node /app/remove-value.js "$@"
fi

