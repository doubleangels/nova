<div align="center">
  <img src="logo.png" alt="Logo" width="200" style="border-radius: 20px; margin-bottom: 20px;">

  <h1>Nova Discord Bot</h1>
  <p><b>A multi-purpose Discord bot for Da Frens with search, moderation, invite tracking, and automated reminders.</b></p>

  [![DeepScan grade](https://deepscan.io/api/teams/29402/projects/31350/branches/1015182/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=29402&pid=31350&bid=1015182)
  [![Node.js](https://img.shields.io/badge/node.js-24.x-brightgreen.svg?style=flat-square&logo=nodedotjs)](https://nodejs.org/)
  [![Discord.js](https://img.shields.io/badge/discord.js-14.x-blue.svg?style=flat-square&logo=discord)](https://discord.js.org/)
  [![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?style=flat-square&logo=docker)](https://www.docker.com/)
  [![Doppler](https://img.shields.io/badge/doppler-secrets-000000.svg?style=flat-square&logo=doppler)](https://www.doppler.com/)
  [![Sentry](https://img.shields.io/badge/sentry-observability-362D59.svg?style=flat-square&logo=sentry)](https://sentry.io/)
</div>

<br>

Nova combines integrations for Google, OMDB, PirateWeather, MyAnimeList, Reddit, Wikipedia, and more with moderation tools, invite tracking, and role management.

## 🚀 Quick Start

### Prerequisites

- [Discord Bot Token](https://discord.com/developers/applications) — create an application and bot
- API keys for:
  - [Google API](https://console.cloud.google.com/) — Custom Search Engine ID and Image Search Engine ID
  - [OMDB API](http://www.omdbapi.com/apikey.aspx) — movie and TV information
  - [PirateWeather](https://pirateweather.net/) — weather forecasts
  - [MyAnimeList](https://myanimelist.net/apiconfig) — anime information (Client ID)
  - [Reddit](https://www.reddit.com/prefs/apps) — Client ID, Client Secret, username, and password
- [Doppler](https://www.doppler.com/) service token (recommended for production) or a local `.env` file
- **Docker deployment:** Docker and Docker Compose
- **Local development:** Node.js 24 and [pnpm](https://pnpm.io/) 10.x

### Docker Deployment

The repository includes a production-ready [docker-compose.yml](docker-compose.yml). It runs the published image with a read-only root filesystem, drops all capabilities except those needed for the entrypoint, injects secrets via Doppler, and persists the SQLite database under `./data`.

1. Set your Doppler service token:

```bash
export DOPPLER_TOKEN=dp.st.xxxx
```

2. Start the bot:

```bash
docker compose up -d
```

The container image is published to `ghcr.io/doubleangels/nova:latest`. Data is stored at `./data` on the host (mounted to `/app/data` in the container).

### Local Development

1. Clone the repository and install dependencies:

```bash
pnpm install
```

2. Configure environment variables — either create a `.env` file (loaded by `dotenv`) or run through Doppler:

```bash
# With Doppler (matches production)
pnpm start

# Or run Node directly if env vars are already set
node index.js
```

3. Slash commands are deployed automatically on startup when `deployCommandsOnStart` is enabled in [config.js](config.js). To deploy manually:

```bash
node deploy-commands.js
```

## ⚙️ Configuration

### Required Environment Variables

The bot exits on startup if any of these are missing (see [config.js](config.js)):

| Variable | Description |
| -------- | ----------- |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `BOT_STATUS` | Bot activity status text |
| `MEMBER_FREN_ROLE_ID` | Role ID for the Fren role |
| `CUSTOM_ROLE_POSITIONING_ANCHOR_ID` | Role ID that custom roles are positioned above |
| `GOOGLE_API_KEY` | Google API key for search and location features |
| `IMAGE_SEARCH_ENGINE_ID` | Google Custom Search Engine ID for image search |
| `MAL_CLIENT_ID` | MyAnimeList API client ID |
| `RETURNING_MEMBER_ROLE_ID` | Role ID for returning members |
| `PERMISSION_BENCHMARK_ROLE_ID` | Role ID used as a permission comparison benchmark |
| `NEW_MEMBER_ROLE_ID` | Role ID for the Noobies role |
| `OMDB_API_KEY` | OMDb API key |
| `PIRATEWEATHER_API_KEY` | PirateWeather API key |
| `REDDIT_CLIENT_ID` | Reddit API client ID |
| `REDDIT_CLIENT_SECRET` | Reddit API client secret |
| `REDDIT_PASSWORD` | Reddit account password |
| `REDDIT_USERNAME` | Reddit account username |
| `SEARCH_ENGINE_ID` | Google Custom Search Engine ID for web search |
| `SERVER_INVITE_URL` | Server invite URL used in kick messages |

### Optional Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `DOPPLER_TOKEN` | Doppler service token (Docker / `pnpm start`) | — |
| `BASE_EMBED_COLOR` | Default embed color (hex, e.g. `#CD41FF`) | `#999999` |
| `BOT_STATUS_TYPE` | Activity type (`playing`, `watching`, `listening`, etc.) | `watching` |
| `DISCORD_CLIENT_ID` | Application ID for slash command deploy | Bot application ID |
| `DEEPL_API_KEY` | DeepL API key for flag-emoji translation reactions | — |
| `GUILD_NAME` | Guild display name | `Da Frens` |
| `LOG_LEVEL` | Log verbosity (`error`, `warn`, `info`, `debug`) | `info` |
| `SENTRY_DSN` | Sentry DSN for error monitoring | — |
| `SENTRY_TRACES_SAMPLE_RATE` | Sentry performance trace sample rate | `0.1` (production) / `1.0` (dev) |
| `SENTRY_ENABLE_LOGS` | Enable Sentry log forwarding (`true` / `false`) | `false` |
| `NODE_ENV` | Runtime environment (`production`, `development`, etc.) | `production` |
| `NODE_OPTIONS` | Node.js runtime flags (e.g. memory limit) | — |

### Doppler vs `.env`

In production, secrets are injected at runtime by Doppler (`DOPPLER_TOKEN` in [docker-compose.yml](docker-compose.yml) or `doppler run --` via `pnpm start`). For local development you can use either Doppler or a `.env` file in the project root.

### Bot Settings

Behavior flags in [config.js](config.js) `settings`:

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `deployCommandsOnStart` | Deploy slash commands when the bot starts | `true` |
| `rescheduleReminderOnStart` | Reschedule Disboard/Reddit reminders on startup | `true` |
| `rescheduleAllMuteKicksOnStart` | Reschedule mute-mode kick timers on startup | `true` |
| `disabledCommands` | Command names to skip during deploy (e.g. `['promote']`) | `[]` |

## 🎯 Features

### Multi-Platform Integration

- **Google Services:** Web search, image search, location/timezone lookup, and Google Books
- **OMDB:** Movie and TV show information
- **PirateWeather:** Weather forecasts and current conditions
- **MyAnimeList:** Anime information
- **Reddit:** Server promotion (`/promote`) and weekly r/needafriend comments (`/needafriend`)
- **DeepL:** Flag-emoji translation reactions (optional)
- **Sentry:** Error monitoring across events and commands
- **Wikipedia:** Article summaries

### Administrative Tools

- **Invite Tracking:** Tag invite codes, receive join notifications (only tagged invites are tracked)
- **Permission Audit:** List members with admin, moderator, kick, or ban permissions
- **Role Management:** Create, assign, rename, recolor, and compare roles
- **Reminder System:** Automated Disboard bump and Reddit promotion reminders
- **Mute Mode:** Kick users who remain silent after joining
- **Troll Mode:** Kick new accounts below a minimum age threshold
- **Spam Mode:** Detect and warn on duplicate messages
- **No-Text Channels:** Restrict channels to GIFs and stickers only
- **Noobies Management:** Auto-assign the Noobies role to new members without the Fren role; remove it after 100 messages

### Information and Entertainment

- Search, media, weather, dictionary, and random-content commands (see Commands below)

## 🤖 Automatic Behaviors

These run without a slash command:

- **Flag-emoji translation:** React to a message with a supported country-flag emoji to translate its text via DeepL ([events/messageReactionAdd.js](events/messageReactionAdd.js)). Requires `DEEPL_API_KEY`.
- **Member join handling:** On join, the bot may assign returning-member or Noobies roles, schedule mute-mode kicks, and check tagged invites for notification ([events/guildMemberAdd.js](events/guildMemberAdd.js)).
- **Message moderation:** Spam-mode duplicate detection and no-text channel enforcement ([events/messageCreate.js](events/messageCreate.js)).
- **Reminders:** Disboard bumps (2-hour cycle), r/findaserver posts (24-hour cooldown), and r/needafriend comments (7-day cooldown) are scheduled automatically when configured via `/reminder setup`.
- **Former member tracking:** Users who leave are recorded so returning members can be identified on re-join.

## 🔧 Commands

### Administrative Commands

#### `/audit` (Administrator Only)

Audit which members hold moderator-level permissions. Results are paginated when large.

**Subcommands:**

- **`admin`**: Members with the Administrator permission
- **`moderator`**: Members with moderator permissions but not Administrator
- **`kick`**: Members who can kick others
- **`ban`**: Members who can ban others

Each subcommand accepts an optional `include-bots` boolean (default: false).

#### `/invite` (Administrator Only)

Manage invite codes with custom tags and track member joins. **Only tagged invites are tracked** and trigger notifications.

**Subcommands:**

- **`tag`**: Tag an existing invite code with a custom name
  - `code` (required): Invite code or full URL (`discord.gg/xxxxx`)
  - `name` (required): Custom tag name
- **`setup`**: Set the invite notification channel
  - `channel` (required): Text channel for notifications
- **`list`**: List all tagged invites with names and URLs
- **`create`**: Create a new invite and tag it automatically
  - `name` (required): Tag name
  - `channel` (optional): Target channel (defaults to first available text channel)
  - `max_uses` (optional): Max uses (0 = unlimited, max 100)
  - `max_age` (optional): Max age in seconds (0 = never expires, max 604800)
- **`remove`**: Remove a tagged invite (autocomplete on tag names)
  - `name` (required): Tag to remove

#### `/reminder` (Administrator Only)

Configure and manage server reminders for Disboard and Reddit promotions.

**Subcommands:**

- **`setup`**: Set the reminder channel and ping role
  - `channel` (required): Reminder text channel
  - `role` (required): Role to ping
- **`status`**: Show current configuration and next scheduled times (Disboard, r/findaserver, r/needafriend)

#### `/promote` (Administrator Only)

Post a server advertisement to r/findaserver. Enforces a 24-hour cooldown and schedules a reminder when the cooldown expires. Requires Reddit API credentials.

#### `/needafriend` (Administrator Only)

Comment the server advertisement on the current weekly r/needafriend thread. Enforces a 7-day cooldown. Requires Reddit API credentials.

#### `/giveperms` (Manage Roles)

Create and assign a custom role with automatic permission management. Positions the role above the anchor role and assigns the Fren role.

**Parameters:**

- `role` (required): New role name (max 100 characters)
- `color` (required): Hex color (`#RRGGBB` or `RRGGBB`)
- `user` (required): User to receive the role

#### `/giverole` (Manage Roles)

Assign an existing role to a user.

**Parameters:** `role` (required), `user` (required)

#### `/takerole` (Manage Roles)

Remove a role from a user.

**Parameters:** `role` (required), `user` (required), `reason` (optional)

#### `/changecolor` (Manage Roles)

Change a role's color.

**Parameters:** `role` (required), `color` (required, hex)

#### `/changerolename` (Manage Roles)

Rename a role.

**Parameters:** `role` (required), `name` (required, 1–100 characters)

#### `/changenickname` (Manage Nicknames)

Change a user's nickname.

**Parameters:** `user` (required), `nickname` (optional, 1–32 characters; omit to reset)

#### `/compareroles` (Administrator Only)

Compare two roles and show which permissions they share.

**Parameters:** `base-role` (required), `comparison-role` (required)

#### `/notext` (Manage Channels)

Configure a channel to allow only GIFs and stickers.

**Subcommands:**

- **`set`**: Enable no-text mode on a channel (`channel` required)
- **`remove`**: Disable no-text mode on a channel (`channel` required)

#### `/mutemode` (Administrator Only)

Kick users who do not send a message within a configured time after joining.

**Subcommands:**

- **`set`**: `enabled` (required), `time` (optional, 1–72 hours, default 2)
- **`status`**: Show current settings

Bot accounts are exempt.

#### `/spammode` (Administrator Only)

Detect duplicate messages and post warnings.

**Subcommands:**

- **`set`**: `enabled` (required), `threshold` (optional, 2–10, default 3), `window` (optional, 1–72 hours, default 4), `channel` (optional warning channel)
- **`status`**: Show current settings

Bot accounts are exempt.

#### `/trollmode` (Administrator Only)

Kick new members whose accounts are younger than a minimum age.

**Subcommands:**

- **`set`**: `enabled` (required), `age` (optional, 1–365 days, default 30)
- **`status`**: Show current settings

Bot accounts are exempt.

#### `/fix` (Administrator Only)

Repair stuck reminder timers in the database.

**Subcommands:**

- **`disboard`**: Reschedule Disboard bump for 2 hours from now
- **`reddit`**: Reschedule r/findaserver promotion for 24 hours from now
- **`needafriend`**: Reschedule r/needafriend comment for 7 days from now

Requires `/reminder setup` to have been run first.

### Information Commands

#### `/google`

Search the web via Google Custom Search API.

**Parameters:** `query` (required), `results` (optional, 1–10, default 5)

Paginated results with summaries and links.

#### `/googleimages`

Search for images via Google Custom Search API.

**Parameters:** `query` (required), `results` (optional, 1–10, default 5)

Paginated results with previews and source links.

#### `/imdb`

Search movies and TV shows via OMDb.

**Subcommands:** `movie` (`query` required), `tv` (`query` required)

Displays plot, year, rating, genre, director, actors, awards, and IMDb link.

#### `/anime`

Search anime on MyAnimeList.

**Parameters:** `query` (required)

Displays synopsis, genres, rating, release date, and MAL link.

#### `/weather`

Get weather for any location via PirateWeather.

**Parameters:** `place` (required), `privacy_mode` (optional, default on), `units` (optional, `metric` or `imperial`), `forecast_days` (optional, 1–7, default 3)

Displays current conditions, forecast, humidity, wind, UV, visibility, pressure, and more.

#### `/wikipedia`

Fetch a Wikipedia article summary.

**Parameters:** `query` (required)

#### `/dictionary`

Look up word definitions.

**Parameters:** `word` (required)

#### `/urban`

Look up slang definitions on Urban Dictionary.

**Parameters:** `query` (required)

#### `/youtube`

Search YouTube videos, channels, or playlists.

**Parameters:** `query` (required), `type` (optional: `video`, `channel`, `playlist`, default `video`)

#### `/book`

Search books via Google Books API.

**Subcommands:**

- **`search`**: `query` (required)
- **`isbn`**: `isbn` (required, 10 or 13 digits)

Paginated results with covers and metadata.

#### `/country`

Get country information from the REST Countries API.

**Parameters:** `name` (required)

#### `/joindate`

Show when a user joined the server.

**Parameters:** `user` (required)

#### `/newuser`

View a user's avatar, username, display name, account creation date, permissions compared to the benchmark role, and returning-member status.

**Parameters:** `user` (required)

### Utility Commands

#### `/coinflip`

Flip a coin (heads or tails).

#### `/cat`

Fetch a random cat image from The Cat API.

#### `/dog`

Fetch a random dog image from Dog CEO API.

**Parameters:** `breed` (optional)

#### `/timedifference`

Calculate the time difference between two locations (requires Google API key).

**Parameters:** `first-place` (required), `second-place` (required)

### Context Menu Commands

Right-click a message or user in Discord to use these:

#### `Quote` (Message)

Reply with an embed quoting the selected message's text (max 4096 characters).

#### `Mock` (Message)

Convert message text to alternating case (e.g. `lIkE tHiS`) and append a mocking emoji. Messages over 2000 characters cannot be converted.

#### `View Join Date` (User)

Show the selected user's server join date (ephemeral reply).

#### `View User Information` (User)

Show permissions, roles, and returning-member status for the selected user (ephemeral reply).

## 🗄️ Database Tools

Nova stores configuration and state in a SQLite Keyv database at `./data` (or `/app/data` in Docker). CLI scripts operate on the same database:

| Script | Command | Description |
| ------ | ------- | ----------- |
| Set value | `pnpm set-value <key> <value>` | Create or update a key |
| Remove value | `pnpm remove-value <key>` | Delete a key |
| List values | `pnpm list-values [<key>]` | List all keys or read one key |
| Prune database | `pnpm prune-db [--commit]` | Remove obsolete keys (dry-run by default) |

**Key format:** `[namespace:][section:]key`

- **Namespaces:** `main` (default), `invites`
- **Sections:** `config`, `tags`, `invite_usage`, `invite_code_to_tag_map`, `former_member`, etc.

**Examples:**

```bash
pnpm set-value reminder_channel "123456789012345678"
pnpm set-value main:config:reminder_channel "123456789012345678"
pnpm set-value invites:tags:disboard '{"code":"abc123","name":"Disboard"}'
pnpm list-values
pnpm list-values former_member:123456789
pnpm prune-db              # dry run — shows keys that would be deleted
pnpm prune-db --commit       # actually delete obsolete keys
```

## 🧪 Development and Testing

### Scripts

| Command | Description |
| ------- | ----------- |
| `pnpm start` | Run the bot via Doppler |
| `pnpm test` | Run Jest with 100% coverage threshold |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:debug` | Run tests with Node inspector |
| `pnpm update` | Check for and apply dependency updates |

Tests live under [tests/](tests/) with unit tests for commands, events, and utilities, plus integration tests for invite tracking, spam detection, reminders, and pagination.

Coverage is enforced at **100%** for statements, branches, functions, and lines ([jest.config.js](jest.config.js)).

### CI

On push/PR to `main`, [.github/workflows/build-docker.yml](.github/workflows/build-docker.yml) runs:

1. `pnpm install` and `pnpm test`
2. Dependency audit (`pnpm audit --audit-level=high`)
3. Trivy filesystem and container image scans
4. Docker image build (pushed to GHCR on merge to `main`)

## 📁 Project Layout

```
nova/
├── commands/          # Slash and context menu command modules
├── events/            # Discord event handlers (ready, messageCreate, guildMemberAdd, etc.)
├── utils/             # Shared utilities (database, reminders, spam/mute/troll modes, search pagination)
├── tests/             # Jest unit and integration tests
├── scripts/           # Maintenance scripts (e.g. audit-log-messages)
├── config.js          # Bot configuration and required env validation
├── index.js           # Bot entry point
├── deploy-commands.js # Manual slash command deployment
├── instrument.js      # Sentry initialization
├── set-value.js       # Database CLI — set a key
├── remove-value.js    # Database CLI — remove a key
├── list-values.js     # Database CLI — list/read keys
├── prune-db.js        # Database CLI — prune obsolete keys
├── Dockerfile         # Multi-stage production image (Node 24 Alpine + Doppler)
└── docker-compose.yml # Production compose file
```
