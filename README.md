# Nova Discord Bot

<div align="center">
  <img src="logo.png" alt="Logo" width="250">
</div>
<br>

A feature-rich Discord bot designed to bring advanced functionalities to your Discord server. With integrations for Google APIs, OMDB, PirateWeather, MAL, Reddit, and more, Nova offers a dynamic and customizable experience with robust administrative tools.

## 🚀 Quick Start

### Prerequisites

- [Discord Bot Token](https://discord.com/developers/applications) - Create a new application and bot
- API keys for:
  - [Google API](https://console.cloud.google.com/) - With Search Engine ID and Image Search Engine ID
  - [OMDB API](http://www.omdbapi.com/apikey.aspx) - For movie information
  - [PirateWeather](https://pirateweather.net/) - For weather forecasts
  - [MyAnimeList](https://myanimelist.net/apiconfig) - Client ID for anime information
  - [Reddit](https://www.reddit.com/prefs/apps) - Client ID and Client Secret
  - [Sentry](https://sentry.io/) - DSN for error monitoring (optional but recommended)
- Docker and Docker Compose

### Web Dashboard Setup

Nova includes a built-in web dashboard for managing bot settings without touching Doppler or redeploying.

**1. Add a redirect URI in the [Discord Developer Portal](https://discord.com/developers/applications):**

Open your application → OAuth2 → Redirects and add:

```
http://ares.nilgiri-dab.ts.net:5015/auth/callback
http://localhost:5015/auth/callback
```

Use your own host/port if different, but this must exactly match `DASHBOARD_BASE_URL` + `/auth/callback`.
For local testing, the dashboard now auto-uses the current localhost host/port in OAuth redirects.

**2. Add the required Doppler variables** (see the Configuration section below).

**3. Access the dashboard** at `http://<DASHBOARD_BASE_URL>` and sign in with Discord. Only users with the Administrator permission in the server can log in.

### Docker Deployment

1. **Create a `docker-compose.yml` file:**

```yaml
services:
  nova:
    image: ghcr.io/doubleangels/nova:latest
    container_name: nova
    restart: unless-stopped
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETGID
    environment:
      - DOPPLER_TOKEN=
      - DASHBOARD_PORT=5015
      - DASHBOARD_BASE_URL=http://iris.nilgiri-dab.ts.net:5015
      - DASHBOARD_COOKIE_SECURE=false
    ports:
      - "5015:5015"
    volumes:
      - ./data:/app/data:rw,noexec,nosuid
    tmpfs:
      - /tmp
```

2. **Deploy the bot:**

```bash
docker-compose up -d
```

## ⚙️ Configuration

### Environment Variables

The following environment variables can be set in your `docker-compose.yml`:

| Variable        | Description                                         | Required | Default | Example |
| --------------- | --------------------------------------------------- | :------: | :-----: | ------- |
| `DOPPLER_TOKEN` | Doppler service token (injects secrets as env vars) |    ✅    |    -    | -       |

**Note:** Secrets and API keys are injected at runtime by [Doppler](https://www.doppler.com/). Pass `DOPPLER_TOKEN` when running the container so the bot receives the following (configure them in your Doppler project):

**Required (bot will not start without these):**

- `DISCORD_BOT_TOKEN`
- `GOOGLE_API_KEY`
- `IMAGE_SEARCH_ENGINE_ID`
- `MAL_CLIENT_ID`
- `OMDB_API_KEY`
- `PIRATEWEATHER_API_KEY`
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_PASSWORD`
- `REDDIT_USERNAME`
- `SEARCH_ENGINE_ID`

**Dashboard (required to enable the web dashboard):**

- `DISCORD_CLIENT_SECRET` — OAuth2 client secret from the Discord Developer Portal (same application as the bot)
- `DASHBOARD_SESSION_SECRET` — A long random string for signing session cookies

**Dashboard runtime (editable in Dashboard UI; requires restart to apply):**

- `DASHBOARD_PORT` — Port for the dashboard web server (default: `3001`)
- `DASHBOARD_BASE_URL` — Public URL of the dashboard for OAuth redirects (e.g. `http://ares.nilgiri-dab.ts.net:5015`)
- `DASHBOARD_COOKIE_SECURE` — Optional override (`true`/`false`) for session cookie `Secure` flag. Defaults to `true` only when `DASHBOARD_BASE_URL` starts with `https://`.

**Optional (managed via dashboard after first start, can also be seeded from Doppler):**

- `BASE_EMBED_COLOR` — Hex color for embed borders (e.g. `#CD41FF`); set once then editable in dashboard
- `BOT_STATUS` — Bot activity status text
- `BOT_STATUS_TYPE` — Activity type: `watching`, `playing`, `listening`, `streaming`, `competing`, `custom`
- `GIVE_PERMS_FREN_ROLE_ID` — Role ID for the Fren role
- `GIVE_PERMS_POSITION_ABOVE_ROLE_ID` — Role ID that new custom roles are positioned above
- `GUILD_NAME` — Display name used in embeds (default: `Da Frens`)
- `LOG_LEVEL` — Logging verbosity: `error`, `warn`, `info`, `debug` (default: `info`)
- `NEWUSER_BEEN_IN_SERVER_BEFORE_ROLE_ID` — Role ID for returning members
- `NEWUSER_PERMISSION_DIFF_ROLE_ID` — Reference role for /newuser permission comparison
- `NOOBIES_ROLE_ID` — Role ID auto-assigned to members with fewer than 100 messages
- `SENTRY_DSN` — Sentry project DSN for error monitoring
- `SERVER_INVITE_URL` — Invite URL included in kick DMs

Ensure your Doppler project contains these config values. Pass `DOPPLER_TOKEN` when running the container (e.g. via `doppler run -- docker compose up` or by setting `DOPPLER_TOKEN` in the service environment).

## 🏗️ Project Overview

Nova is split into two primary runtime surfaces:

- **Discord Bot Runtime** (`index.js`, `commands/`, `events/`, `utils/`): slash commands, moderation workflows, reminders, invite tracking, and external API integrations.
- **Dashboard Runtime** (`dashboard/`): authenticated web UI for server settings, maintenance operations, analytics, and direct data management.

### Core Architecture

- **Entry point:** `index.js` initializes the Discord client, loads all commands/events dynamically, and starts the dashboard when dashboard auth secrets are present.
- **Command layer:** files under `commands/` implement slash commands and command-specific validation/permission logic.
- **Event layer:** files under `events/` handle Discord events (`ready`, `interactionCreate`, `messageCreate`, member join/leave, invite lifecycle, reactions).
- **Data layer:** `utils/database.js` uses Keyv + SQLite persistence for bot settings, tracking keys, reminders, sessions, and analytics state.
- **Maintenance layer:** `utils/maintenanceService.js`, `utils/novaKeyvBackup.js`, and `utils/seedLastMessagesFromHistory.js` provide storage reporting, SQLite operations, backup validation/import, and backfill jobs.

## 🖥️ Dashboard Web UI

The dashboard is organized by functional sections in the left navigation:

- **Overview**
  - Status & Health
- **Configuration**
  - Bot Settings
  - Moderation
  - Reminders
  - Role Configuration
- **Social & Fun**
  - Social & Fun settings
- **Maintenance**
  - Deep Health
  - Keyv Storage Report
  - SQLite maintenance tools
  - Discord alignment / resync
  - Cache controls
  - Seed-last-message history backfill with stop control
  - Session hygiene tools
- **Tools**
  - DB Explorer
  - Invite Manager
  - Message Center
  - User Manager + inactivity prune workflow

### Dashboard API Surface

`dashboard/routes/api.js` currently provides endpoints for:

- settings read/write
- guild roles/channels fetches
- database raw operations
- database backup export + safe JSON import validation/apply
- health and deep-health metrics
- reminder status/fix endpoints
- invite listing/creation/revocation/tagging
- user summary + inactivity dry-run/execute
- maintenance jobs (seed history status/start/stop, cache clear, SQLite ops, cleanup, session purge, Discord resync)

## 🔒 Security Model

Current security behavior in the project:

- Dashboard OAuth requires Discord Administrator permission in the target guild.
- `DASHBOARD_SESSION_SECRET` is required outside development; no insecure production fallback.
- Session cookies are `HttpOnly` and `SameSite=Lax`; `Secure` follows HTTPS base URL (or explicit override).
- OAuth state uses cryptographically secure random generation.
- Session ID rotation occurs after successful OAuth login.
- CSRF/origin protections are enforced for mutating dashboard API requests.
- Logout uses CSRF-protected `POST` flow.
- High-risk posting commands (`/promote`, `/needafriend`) now enforce runtime administrator checks.
- High-risk dashboard render paths were hardened to reduce untrusted HTML injection risk.

## 🛠️ Maintenance & Data Safety

- JSON database import is validated before write using strict backup format checks.
- Storage report and deep health diagnostics are exposed in dashboard maintenance.
- SQLite maintenance supports analyze/optimize/vacuum operations.
- Session cleanup supports both expired-session cleanup and full session invalidation.
- Seed-last-message backfill is cancelable from the dashboard and designed for large history scans.

## 🎯 Features

### Multi-Platform Integration

- **Google Services**: Web search and image search capabilities
- **OMDB**: Movie and TV show information
- **PirateWeather**: Weather forecasts and conditions
- **MyAnimeList**: Anime and manga information
- **Reddit**: Server promotion and content sharing across multiple subreddits
- **Sentry**: Automatic error monitoring and alerting across all bot events and commands
- **Wikipedia**: Article summaries and information

### Administrative Tools

- **Invite Tracking**: Monitor and tag invite codes with custom names, receive notifications when members join via tagged invites (only tagged invites are tracked)
- **Role Management**: Assign custom roles with automatic permission management
- **Reminder System**: Automated reminders for Disboard bumps and Reddit promotions (r/findaserver and r/needafriend)
- **Mute Mode**: Automatically kick inactive users
- **Troll Mode**: Kick new accounts that don't meet age requirements
- **Spam Mode**: Enhanced spam detection and moderation
- **Noobies Management**: Automatically assigned to new members without the primary role and automatically removed once they participate by sending 100 messages.
- **Dashboard Operations**: Live health telemetry, config editing, invite management, DB explorer, user activity tooling, and maintenance actions from web UI.

### Information & Entertainment

- **Search Commands**: Google web search and image search
- **Media Information**: Movies (IMDB/OMDB), anime (MAL), books
- **Weather**: Current conditions and forecasts
- **Dictionary & Urban Dictionary**: Word definitions and slang
- **Random Content**: Cat and dog images, coin flips, country information
- **YouTube**: Video information and links

## 🔧 Commands

The bot currently ships with command families for administration, moderation, information lookup, and utility fun commands.

### Command Families

- **Administration & Moderation**
  - `/invite`, `/reminder`, `/fix`
  - `/giveperms`, `/giverole`, `/takerole`, `/changerolename`, `/changecolor`, `/changenickname`
  - `/notext`, `/newuser`, `/audit`, `/compareroles`
  - Reddit posting/admin flows: `/promote`, `/needafriend`
- **Information & Search**
  - `/google`, `/googleimages`, `/youtube`, `/wikipedia`
  - `/imdb`, `/anime`, `/book`, `/dictionary`, `/urban`, `/country`, `/weather`, `/timedifference`
- **Utility & Fun**
  - `/coinflip`, `/cat`, `/dog`
  - Message utilities/context actions including quote/mock helpers

### Notes

- Command options and autocomplete are available directly in Discord slash command UI.
- Some commands require specific Discord permissions (for example Administrator or role-management capabilities).
- Commands depending on external APIs require the corresponding environment variables listed in the configuration section.
