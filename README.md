# nova

<div align="center">
  <img src="logo.png" alt="Logo" width="250">
</div>
<br>

Nova is a custom, admin-level Discord bot designed to bring a range of advanced functionalities to the [Da Frens](https://dafrens.games) server. With integrations for Google APIs, OMDB, PirateWeather, MAL, and more, Nova offers a dynamic and customizable experience.

## Features

- **Multi-Platform Integration:** Connect with Google, OMDB, MAL, and other APIs for enriched data and interactivity.
- **Robust Commands:** A wide array of commands to fetch information, perform searches, simplify administrative duties, and display dynamic content.
- **Scalable & Reliable:** Containerized with Docker for streamlined deployment and auto-restart for high availability.

## Prerequisites

Before deploying Nova, ensure you have the following:

- A valid [Discord Bot Token](https://discord.com/developers/applications)
- Database configuration keys set using bot commands:
  - `fren_role` - Discord role ID to assign alongside custom roles
  - `perms_position_above_role` - Discord role ID that new roles should be positioned above
- API keys for:
  - Google (with Search Engine ID and Image Search Engine ID)
  - OMDB
  - PirateWeather
  - MAL (MyAnimeList) Client ID
  - Spotify (Client ID and Client Secret)
  - Reddit (Client ID, Client Secret)

## Docker Compose Setup

Deploy Nova using Docker Compose with the following configuration:

```yaml
services:
  nova:
    image: ghcr.io/doubleangels/nova:latest
    container_name: nova
    restart: always
    environment:
      - DISCORD_BOT_TOKEN=your_discord_bot_token_here
      - GOOGLE_API_KEY=your_google_api_key_here
      - IMAGE_SEARCH_ENGINE_ID=your_image_search_engine_id_here
      - LOG_LEVEL=your_desired_log_level_here
      - MAL_CLIENT_ID=your_mal_client_id_here
      - OMDB_API_KEY=your_omdb_api_key_here
      - PIRATEWEATHER_API_KEY=your_pirateweather_api_key_here
      - REDDIT_CLIENT_ID=your_reddit_client_id_here
      - REDDIT_CLIENT_SECRET=your_reddit_client_secret_here
      - REDDIT_PASSWORD=your_reddit_password_here
      - REDDIT_USERNAME=your_reddit_username_here
      - SEARCH_ENGINE_ID=your_search_engine_id_here
      - SPOTIFY_CLIENT_ID=your_spotify_client_id_here
      - SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
    # Security options
    security_opt:
      - no-new-privileges:true
    # Drop all capabilities, only add what's needed
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETGID
      - SETUID
    # Read-only root filesystem
    read_only: true
    volumes:
      - ./data:/app/data:rw,noexec,nosuid

networks:
  default:
    name: discord
```

## Environment Variables

Here is a table of all available environment variables:

| Variable                 | Description                                       | Required | Default | Example                          |
| ------------------------ | ------------------------------------------------- | :------: | :-----: | -------------------------------- |
| `BASE_EMBED_COLOR`       | Base embed color in hex format (e.g., CD41FF or #CD41FF) |    ❌    | Discord default | `CD41FF`, `#CD41FF`, `0xCD41FF` |
| `DISCORD_BOT_TOKEN`      | Authentication token for your Discord bot         |    ✅    |    -    | -                                |
| `GOOGLE_API_KEY`         | API key for Google services                       |    ✅    |    -    | -                                |
| `GUILD_NAME`             | Name of the guild/server                           |    ❌    | `Da Frens` | `My Server`                      |
| `IMAGE_SEARCH_ENGINE_ID` | Google Custom Search Engine ID for image searches |    ✅    |    -    | -                                |
| `LOG_LEVEL`              | Determines the verbosity of logs                  |    ❌    | `info`  | `error`, `warn`, `info`, `debug` |
| `MAL_CLIENT_ID`          | Client ID for MyAnimeList API                     |    ✅    |    -    | -                                |
| `OMDB_API_KEY`           | API key for Open Movie Database                   |    ✅    |    -    | -                                |
| `PIRATEWEATHER_API_KEY`  | API key for PirateWeather forecast service        |    ✅    |    -    | -                                |
| `REDDIT_CLIENT_ID`       | Client ID for Reddit API                          |    ✅    |    -    | -                                |
| `REDDIT_CLIENT_SECRET`   | Client Secret for Reddit API                      |    ✅    |    -    | -                                |
| `REDDIT_PASSWORD`        | Reddit password for API authentication            |    ✅    |    -    | -                                |
| `REDDIT_USERNAME`        | Reddit username for API authentication            |    ✅    |    -    | -                                |
| `SEARCH_ENGINE_ID`       | Google Custom Search Engine ID for web searches   |    ✅    |    -    | -                                |
| `SPOTIFY_CLIENT_ID`      | Client ID for Spotify API                         |    ✅    |    -    | -                                |
| `SPOTIFY_CLIENT_SECRET`  | Client Secret for Spotify API                     |    ✅    |    -    | -                                |

## Database Configuration

Nova uses Keyv (a key-value storage system) to store configuration values. The following keys can be set using bot commands or directly via the database API:

| Database Key                | Description                                               | Used By                         |
| --------------------------- | --------------------------------------------------------- | ------------------------------- |
| `fren_role`                 | Discord role ID to assign alongside custom roles          | `/giveperms` command            |
| `perms_position_above_role` | Discord role ID that new roles should be positioned above | `/giveperms` command            |

**Note:** The `/giveperms` command uses the `perms_position_above_role` database key for the position reference role.

### Managing Database Values

You can manage database values directly using the provided scripts. When running in Docker, use `docker exec` to run these scripts inside the container:

**Key Format:** `[namespace:][section:]key`

- **namespace**: `main` (default), `invites`
- **section**: `config`, `tags`, `invite_usage`, `invite_code_to_tag_map`, etc.

#### Reading/Listing Values

```bash
docker exec nova node list-values.js [<key>]
```

If no key is provided, lists all values in the database across all namespaces. If a key is provided, reads that specific value.

**Examples:**

```bash
# List all values in the database
docker exec nova node list-values.js

# Read a config value (defaults to main:config:)
docker exec nova node list-values.js reminder_channel
docker exec nova node list-values.js bot_status
docker exec nova node list-values.js spam_mode_enabled

# Explicit namespace and section
docker exec nova node list-values.js main:config:reminder_channel

# Read invite tag from invites namespace
docker exec nova node list-values.js invites:tags:disboard

# Read invite usage for a guild
docker exec nova node list-values.js main:invite_usage:123456789
```

#### Setting Values

```bash
docker exec nova node set-value.js <key> <value>
```

**Examples:**

```bash
# Set config values (defaults to main:config:)
docker exec nova node set-value.js reminder_channel "123456789012345678"
docker exec nova node set-value.js bot_status "Playing games"
docker exec nova node set-value.js bot_status_type "playing"
docker exec nova node set-value.js spam_mode_enabled true
docker exec nova node set-value.js mute_mode_kick_time_hours 4

# Explicit namespace and section
docker exec nova node set-value.js main:config:reminder_channel "123456789012345678"

# Set invite tag in invites namespace
docker exec nova node set-value.js invites:tags:disboard '{"code":"abc123","name":"Disboard"}'

# Set invite usage for a guild
docker exec nova node set-value.js main:invite_usage:123456789 '{"abc123":5}'
```

#### Deleting Values

```bash
docker exec nova node delete-value.js <key>
```

**Examples:**

```bash
# Delete config values (defaults to main:config:)
docker exec nova node delete-value.js reminder_channel
docker exec nova node delete-value.js spam_mode_enabled

# Explicit namespace and section
docker exec nova node delete-value.js main:config:reminder_channel

# Delete invite tag from invites namespace
docker exec nova node delete-value.js invites:tags:disboard

# Delete invite usage for a guild
docker exec nova node delete-value.js main:invite_usage:123456789
```

**Note:** The database file is stored in `./data/database.sqlite` on the host (mounted as a volume), so changes persist across container restarts.
