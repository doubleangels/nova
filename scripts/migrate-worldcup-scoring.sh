#!/bin/sh
# Run the World Cup scoring migration inside the Nova container.
# Uses Doppler for secrets and the mounted /app/data SQLite database.
#
# Dry run (default):
#   docker compose stop nova
#   docker compose run --rm --no-deps nova /app/scripts/migrate-worldcup-scoring.sh
#   docker compose start nova
#
# Apply changes:
#   docker compose stop nova
#   docker compose run --rm --no-deps nova /app/scripts/migrate-worldcup-scoring.sh --commit --force
#   docker compose start nova

set -e

export DATA_DIR="${DATA_DIR:-/app/data}"

cd /app
exec doppler run -- su-exec discordbot node scripts/migrate-worldcup-scoring.js "$@"
