#!/bin/sh
set -e

# Ensure data directory exists and has correct permissions
# This script runs as root to fix permissions, then executes the command as the specified user

# Function to fix permissions (can be called multiple times)
fix_permissions() {
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
        fi
    else
        # Create the directory if it doesn't exist
        # 750 = rwxr-x--- (owner: read/write/execute, group: read/execute, others: no access)
        mkdir -p /app/data
        chown -R discordbot:nodejs /app/data
        chmod 750 /app/data
    fi
}

# Always fix permissions before executing
fix_permissions

# Retrieve secrets from Bitwarden
BASE_EMBED_COLOR=$(bws secret get bab2467f-507d-4355-8315-b3c300163de6 | jq '.value')
DISCORD_BOT_TOKEN=$(bws secret get c2808e34-8441-4040-b00e-b3c300165b81 | jq '.value')
GIVE_PERMS_FREN_ROLE_ID=$(bws secret get f2735345-3f62-4fe6-bd3d-b3c90141948b | jq '.value')
GIVE_PERMS_POSITION_ABOVE_ROLE_ID=$(bws secret get 241160f9-2770-4410-a30d-b3c90141b409 | jq '.value')
GOOGLE_API_KEY=$(bws secret get 8a9009ae-291f-490a-bde5-b3c300168d70 | jq '.value')
IMAGE_SEARCH_ENGINE_ID=$(bws secret get 61586532-a7cc-41bf-955e-b3c30016d6e3 | jq '.value')
LOG_LEVEL=$(bws secret get a7c48f07-b8e2-457a-b688-b3c30016eb1f | jq '.value')
MAL_CLIENT_ID=$(bws secret get 13aa0e17-aca1-451a-a0e6-b3c30017075e | jq '.value')
OMDB_API_KEY=$(bws secret get 203d91e2-6614-4b7e-b119-b3c3001736ff | jq '.value')
PIRATEWEATHER_API_KEY=$(bws secret get 456b3b1e-f0cf-439f-a763-b3c3001759c7 | jq '.value')
REDDIT_CLIENT_ID=$(bws secret get bbcf953c-172a-4af1-996c-b3c3001772f4 | jq '.value')
REDDIT_CLIENT_SECRET=$(bws secret get d500cd4f-0742-481b-8b99-b3c300178bfc | jq '.value')
REDDIT_PASSWORD=$(bws secret get f5ee370a-7b6c-409b-8bb6-b3c30017a8d8 | jq '.value')
REDDIT_USERNAME=$(bws secret get fc24c3dd-8c81-4ece-854f-b3c30017b82b | jq '.value')
SEARCH_ENGINE_ID=$(bws secret get f65a3b3b-134f-442e-b367-b3c30017da35 | jq '.value')
SERVER_INVITE_URL=$(bws secret get 2969f36e-d411-4642-9a53-b3c90141ebab | jq '.value')
SPOTIFY_CLIENT_ID=$(bws secret get 866eac1b-4b0f-403f-8b18-b3c30017f053 | jq '.value')
SPOTIFY_CLIENT_SECRET=$(bws secret get 81b6d889-fafb-4680-b0b8-b3c300180acd | jq '.value')

# Execute the main command (su-exec will switch to discordbot user)
exec "$@"
