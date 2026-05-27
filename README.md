<div align="center">
  <img src="https://raw.githubusercontent.com/doubleangels/nova/main/logo.png" alt="Logo" width="200" style="border-radius: 20px; margin-bottom: 20px;">

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

## Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Commands reference](#commands-reference)
- [Observability](#observability)
- [Development](#development)
- [CI and Docker](#ci-and-docker)
- [Project layout](#project-layout)

---

## Features

- **Search and media** — Google web/image search, YouTube, Wikipedia, books, movies (OMDB), anime (MAL), weather (PirateWeather), dictionary, Urban Dictionary, countries, and more.
- **Invite tracking** — Tag invite codes with custom names; get notifications when members join via tagged invites only.
- **Permission audit** — List members with administrator, moderator, kick, or ban capabilities.
- **Role management** — Create, assign, rename, recolor, and compare roles with automatic Fren-role assignment.
- **Moderation modes** — Mute mode (inactive kick), troll mode (account age), spam mode (duplicate detection), and no-text channels (GIFs/stickers only).
- **Reminders** — Automated Disboard bumps, r/findaserver promotions, and r/needafriend weekly comments.
- **Member onboarding** — Noobies role for new members; returning-member tracking on re-join.
- **Translation** — React with a supported flag emoji to translate messages via DeepL (optional).
- **Production observability** — Sentry errors and traces via Pino logging.
- **Secure secrets** — Doppler injects environment variables at runtime in Docker; local dev uses the Doppler CLI or `.env`.
- **Persistent state** — SQLite Keyv store with CLI tools for inspection and maintenance.

---

## Quick Start

### Prerequisites

- [Discord Developer Portal](https://discord.com/developers/applications) — bot token and application (client) ID
- API keys: [Google](https://console.cloud.google.com/), [OMDB](http://www.omdbapi.com/apikey.aspx), [PirateWeather](https://pirateweather.net/), [MyAnimeList](https://myanimelist.net/apiconfig), [Reddit](https://www.reddit.com/prefs/apps)
- Optional: [DeepL](https://www.deepl.com/) for flag-emoji translation
- [Doppler](https://www.doppler.com/) for secrets (recommended)
- Docker and Docker Compose for production deployment

### Required secrets (Doppler)

Configure these in your Doppler project (or `.env` for local development). The bot exits on startup if any required variable is missing (see [`config.js`](config.js)).

| Secret | Purpose |
| :--- | :--- |
| `DISCORD_BOT_TOKEN` | Bot token |
| `BOT_STATUS` | Bot activity status text |
| `MEMBER_FREN_ROLE_ID` | Fren role ID |
| `CUSTOM_ROLE_POSITIONING_ANCHOR_ID` | Anchor role for custom role positioning |
| `GOOGLE_API_KEY` | Google APIs (search, location, books) |
| `IMAGE_SEARCH_ENGINE_ID` | Google CSE for image search |
| `SEARCH_ENGINE_ID` | Google CSE for web search |
| `MAL_CLIENT_ID` | MyAnimeList client ID |
| `RETURNING_MEMBER_ROLE_ID` | Returning member role |
| `PERMISSION_BENCHMARK_ROLE_ID` | Permission comparison benchmark role |
| `NEW_MEMBER_ROLE_ID` | Noobies role |
| `OMDB_API_KEY` | Movie/TV data |
| `PIRATEWEATHER_API_KEY` | Weather forecasts |
| `REDDIT_CLIENT_ID` | Reddit API |
| `REDDIT_CLIENT_SECRET` | Reddit API |
| `REDDIT_USERNAME` | Reddit account |
| `REDDIT_PASSWORD` | Reddit account |
| `SERVER_INVITE_URL` | Invite URL in kick messages |

Generate a Doppler service token for the config you deploy (e.g. `prd`).

### Deploy with Docker Compose

The repository includes [`docker-compose.yml`](docker-compose.yml):

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
      - SETUID
    read_only: true
    environment:
      - DOPPLER_TOKEN=${DOPPLER_TOKEN}
      - NODE_OPTIONS=--max-old-space-size=192
    volumes:
      - ./data:/app/data:rw,noexec,nosuid
    tmpfs:
      - /tmp
```

```bash
export DOPPLER_TOKEN="dp.st.config.your_token_here"
docker compose up -d
```

The production image is built from the multi-stage [`Dockerfile`](Dockerfile). The entrypoint runs `doppler run -- node index.js` as an unprivileged user. Set `DOPPLER_TOKEN` at runtime; secrets are not baked into the image. SQLite data persists under `./data` on the host.

---

## Configuration

Set variables in Doppler (or `.env` for local experiments).

### Discord and bot

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DISCORD_BOT_TOKEN` | Bot token | *required* |
| `DISCORD_CLIENT_ID` | Application ID (slash command deploy) | Bot application ID |
| `BOT_STATUS` | Activity status text | *required* |
| `BOT_STATUS_TYPE` | Activity type (`playing`, `watching`, etc.) | `watching` |
| `BASE_EMBED_COLOR` | Default embed color (hex) | `#999999` |
| `GUILD_NAME` | Guild display name | `Da Frens` |
| `LOG_LEVEL` | Pino log level | `info` |
| `DISABLED_COMMANDS` | Slash command names to skip during deploy | `[]` |

### Integrations (optional)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DEEPL_API_KEY` | Flag-emoji translation via DeepL | *unset* |
| `SENTRY_DSN` | Sentry error monitoring | *unset* |
| `FOOTBALL_DATA_API_KEY` | [football-data.org](https://www.football-data.org/) API token for World Cup fixtures | *unset* |
| `WORLD_CUP_MOCK_API` | Use simulated fixtures instead of the API (`true` / `1` / `yes`) | *unset* |
| `WORLD_CUP_PARTICIPANT_ROLE_ID` | Role assigned when users run `/worldcup register` | *unset* |
| `WORLD_CUP_CHANNEL_ID` | Channel for pre-match prompts and post-match announcements | *unset* |
| `WORLD_CUP_COMPETITION_CODE` | football-data.org competition code (World Cup = `WC`) | `WC` |
| `WORLD_CUP_SEASON` | Season year | `2026` |
| `WORLD_CUP_REMINDER_HOURS` | Hours before kickoff to post prediction prompts | `24` |
| `WORLD_CUP_POLL_INTERVAL_MS` | How often to poll fixtures (ms) | `900000` (15 min) |

### Bot settings (`config.js`)

| Setting | Description | Default |
| :--- | :--- | :--- |
| `deployCommandsOnStart` | Deploy slash commands on startup | `true` |
| `rescheduleReminderOnStart` | Reschedule Disboard/Reddit reminders on startup | `true` |
| `rescheduleAllMuteKicksOnStart` | Reschedule mute-mode kick timers on startup | `true` |

---

## Usage

### Automatic behaviors

These run without a slash command:

- **Flag-emoji translation** — React with a supported country-flag emoji to translate message text (requires `DEEPL_API_KEY`).
- **Member join** — Assign returning-member or Noobies roles, schedule mute-mode kicks, and check tagged invites for notifications.
- **Message moderation** — Spam-mode duplicate detection and no-text channel enforcement.
- **Reminders** — Disboard bumps (2 h), r/findaserver posts (24 h), r/needafriend comments (7 d) when configured via `/reminder setup`.
- **Former members** — Users who leave are recorded for returning-member detection on re-join.
- **World Cup predictions** — When `FOOTBALL_DATA_API_KEY` and `WORLD_CUP_CHANNEL_ID` are set, registered users get channel posts and DMs before each match with a button to submit score + winner/draw predictions via modal; results and points are announced after full-time.

### World Cup predictions

1. Set `FOOTBALL_DATA_API_KEY`, `WORLD_CUP_PARTICIPANT_ROLE_ID`, and `WORLD_CUP_CHANNEL_ID` in Doppler (or set `WORLD_CUP_MOCK_API=true` with the channel/role IDs to test without an API key).
2. Users run `/worldcup register` to join and receive the participant role.
3. Before each match (default 24 h ahead), the bot posts in the World Cup channel and DMs registered users with a **Submit prediction** button.
4. Users enter home goals, away goals, and `home` / `draw` / `away` in the modal (both score and outcome required).
5. After full-time, the bot scores predictions and posts results plus who earned points. Use `/worldcup leaderboard` anytime.

**Scoring:** exact score = 3 pts; correct outcome from your predicted score = 1 pt; correct separate winner/draw pick = 1 pt (max 4 per match).

### Slash commands (overview)

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/audit` | List members with admin, moderator, kick, or ban permissions | Administrator |
| `/invite` | Tag, create, list, and remove tracked invites | Administrator |
| `/reminder` | Configure Disboard and Reddit reminder channel/role | Administrator |
| `/promote` | Post server ad to r/findaserver (24 h cooldown) | Administrator |
| `/needafriend` | Comment on weekly r/needafriend thread (7 d cooldown) | Administrator |
| `/giveperms` | Create and assign a custom role + Fren role | Manage Roles |
| `/giverole` | Assign an existing role | Manage Roles |
| `/takerole` | Remove a role from a user | Manage Roles |
| `/changecolor` | Change a role color | Manage Roles |
| `/changerolename` | Rename a role | Manage Roles |
| `/changenickname` | Change a user's nickname | Manage Nicknames |
| `/compareroles` | Compare permissions between two roles | Administrator |
| `/notext` | Restrict a channel to GIFs and stickers | Manage Channels |
| `/mutemode` | Kick inactive new members after a time limit | Administrator |
| `/spammode` | Detect duplicate messages and warn | Administrator |
| `/trollmode` | Kick accounts below minimum age | Administrator |
| `/fix` | Repair stuck reminder timers | Administrator |
| `/google` | Web search (paginated) | Everyone |
| `/googleimages` | Image search (paginated) | Everyone |
| `/imdb` | Movie/TV lookup (OMDb) | Everyone |
| `/anime` | Anime lookup (MAL) | Everyone |
| `/weather` | Weather and forecast (PirateWeather) | Everyone |
| `/wikipedia` | Wikipedia summary | Everyone |
| `/dictionary` | Word definitions | Everyone |
| `/urban` | Urban Dictionary | Everyone |
| `/youtube` | YouTube search | Everyone |
| `/book` | Google Books search / ISBN | Everyone |
| `/country` | Country information | Everyone |
| `/joindate` | Server join date for a user | Everyone |
| `/newuser` | Profile and account creation info | Everyone |
| `/worldcup` | World Cup 2026 predictions (register, leaderboard, matches) | Everyone |
| `/coinflip` | Flip a coin | Everyone |
| `/cat` | Random cat image | Everyone |
| `/dog` | Random dog image (optional breed) | Everyone |
| `/timedifference` | Time difference between two places | Everyone |

Slash commands deploy automatically on startup when `deployCommandsOnStart` is enabled. To deploy manually:

```bash
node deploy-commands.js
```

### Context menu commands

| Command | Target | Description |
| :--- | :--- | :--- |
| `Quote` | Message | Embed quote of selected message text |
| `Mock` | Message | Alternating-case mock text |
| `View Join Date` | User | Ephemeral server join date |
| `View User Information` | User | Permissions, roles, returning-member status |

---

## Commands reference

Detailed parameters for administrative, information, and utility commands.

### Administrative

#### `/audit`

Subcommands: `admin`, `moderator`, `kick`, `ban` — each accepts optional `include-bots` (default: false). Results are paginated when large.

#### `/invite`

Only **tagged** invites are tracked and trigger join notifications.

- **`tag`** — `code` (required), `name` (required)
- **`setup`** — `channel` (required)
- **`list`** — list all tagged invites
- **`create`** — `name` (required), `channel`, `max_uses`, `max_age` (optional)
- **`remove`** — `name` (required, autocomplete)

#### `/reminder`

- **`setup`** — `channel` (required), `role` (required)
- **`status`** — next scheduled Disboard, r/findaserver, and r/needafriend times

#### `/promote` / `/needafriend`

Require Reddit API credentials. `/promote` posts to r/findaserver (24 h cooldown). `/needafriend` comments on the weekly thread (7 d cooldown).

#### `/giveperms`

`role` (required), `color` (required, hex), `user` (required). Requires `CUSTOM_ROLE_POSITIONING_ANCHOR_ID` and `MEMBER_FREN_ROLE_ID`.

#### `/giverole` / `/takerole` / `/changecolor` / `/changerolename` / `/changenickname`

Standard role and nickname management. `/changenickname` accepts optional `nickname` (omit to reset).

#### `/compareroles`

`base-role` (required), `comparison-role` (required).

#### `/notext`

- **`set`** / **`remove`** — `channel` (required)

#### `/mutemode` / `/spammode` / `/trollmode`

Each has **`set`** and **`status`** subcommands. Bot accounts are exempt from mute/spam/troll tracking.

- **Mute:** `enabled`, `time` (1–72 h, default 2)
- **Spam:** `enabled`, `threshold` (2–10), `window` (1–72 h), `channel`
- **Troll:** `enabled`, `age` (1–365 days, default 30)

#### `/fix`

`disboard`, `reddit`, or `needafriend` — reschedules the corresponding reminder from now. Requires `/reminder setup` first.

### Information and utility

| Command | Key parameters | Notes |
| :--- | :--- | :--- |
| `/google` | `query`, `results` (1–10) | Paginated |
| `/googleimages` | `query`, `results` (1–10) | Paginated |
| `/imdb` | `movie` / `tv` + `query` | Plot, ratings, cast |
| `/anime` | `query` | MAL synopsis and link |
| `/weather` | `place`, `privacy_mode`, `units`, `forecast_days` | PirateWeather |
| `/wikipedia` | `query` | First result summary |
| `/dictionary` | `word` | Definitions |
| `/urban` | `query` | Slang definitions |
| `/youtube` | `query`, `type` (`video`, `channel`, `playlist`) | Paginated |
| `/book` | `search` + `query`, or `isbn` | Paginated |
| `/country` | `name` | REST Countries API |
| `/joindate` | `user` | Server join date |
| `/newuser` | `user` | Profile, permissions vs benchmark, returning status |
| `/coinflip` | — | Heads or tails |
| `/cat` | — | Random cat image |
| `/dog` | `breed` (optional) | Dog CEO API |
| `/timedifference` | `first-place`, `second-place` | Requires Google API key |

### Context menu

- **`Quote`** — max 4096 characters of quoted text
- **`Mock`** — alternating case; messages over 2000 characters cannot be converted
- **`View Join Date`** / **`View User Information`** — ephemeral replies

---

## Observability

Set `SENTRY_DSN` in Doppler to enable Sentry. [`instrument.js`](instrument.js) loads **before** other application modules.

### Sentry environment variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SENTRY_DSN` | *unset* | Enable reporting |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` (production) / `1.0` (dev) | Performance traces (`0.0`–`1.0`) |
| `SENTRY_ENABLE_LOGS` | `false` | Forward Pino logs to Sentry |
| `NODE_ENV` | `production` | Sentry environment tag; local variable capture enabled only when not `production` |

### Errors

`captureError(error, tags)` from `instrument.js` calls `captureException` with optional tags. Used across commands, events, and bootstrap code.

### Graceful shutdown

`closeSentry()` calls `Sentry.close(2000)` on process shutdown (see `index.js` signal handlers) to flush pending events.

### Static analysis

The project is monitored on [DeepScan](https://deepscan.io/dashboard#view=project&tid=29402&pid=31350&bid=1015182) (badge above).

---

## Development

### Prerequisites

- **Node.js 24.x** (matches CI and the Docker image)
- **pnpm 10.6** via [Corepack](https://nodejs.org/api/corepack.html)
- Optional: [Doppler CLI](https://docs.doppler.com/docs/cli) for local secrets

### Install and run

```bash
corepack enable
pnpm install --frozen-lockfile
```

With Doppler:

```bash
pnpm start               # doppler run -- node index.js
node deploy-commands.js    # register slash commands manually
```

Or set environment variables in `.env` and run `node index.js`.

### Testing

```bash
pnpm test           # full Jest suite with 100% coverage gate (CI runs this)
pnpm test:watch     # watch mode
pnpm test:debug     # Node inspector
```

- Tests live under [`tests/`](tests/) with setup in [`tests/setup.js`](tests/setup.js).
- Coverage thresholds (lines, branches, functions, statements) are **100%** in [`jest.config.js`](jest.config.js).
- On Windows, run test commands directly in PowerShell without piping output; piping can cause Jest to hang.

### Database CLI

| Script | Command | Description |
| :--- | :--- | :--- |
| Set value | `pnpm set-value <key> <value>` | Create or update a key |
| Remove value | `pnpm remove-value <key>` | Delete a key |
| List values | `pnpm list-values [<key>]` | List all keys or read one |
| Prune | `pnpm prune-db [--commit]` | Remove obsolete keys (dry-run by default) |

**Key format:** `[namespace:][section:]key` — namespaces: `main` (default), `invites`; sections include `config`, `tags`, `invite_usage`, `invite_code_to_tag_map`, `former_member`.

```bash
pnpm set-value main:config:reminder_channel "123456789012345678"
pnpm list-values
pnpm prune-db --commit
```

### Maintainer scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| Log audit | `node scripts/audit-log-messages.js` | Enforce log message style |

---

## CI and Docker

### GitHub Actions

| Workflow | Branch | Actions |
| :--- | :--- | :--- |
| [`build-docker.yml`](.github/workflows/build-docker.yml) | `main` | `pnpm test`, `pnpm audit`, Trivy FS + image scan, build and push `ghcr.io/doubleangels/nova` |
| [`build-dev-docker.yml`](.github/workflows/build-dev-docker.yml) | `dev` | Same pipeline for the dev branch image |

Images are published to **GitHub Container Registry** as `ghcr.io/doubleangels/nova:latest` on the default branch.

### Docker image contents

[`.dockerignore`](.dockerignore) excludes from the build context:

- `tests/`, `jest.config.js`, `coverage/`, `*.lcov`, `.nyc_output/`
- Documentation, CI configs, and dev tooling

The runtime stage contains application code and production dependencies only (`pnpm install --prod --frozen-lockfile` in the builder). The image runs as user `discordbot` (UID 1001), includes `dumb-init` and the Doppler CLI, mounts `/app/data` for SQLite, and exposes a health check on the Node process.

---

## Project layout

| Path | Purpose |
| :--- | :--- |
| `index.js` | Discord client bootstrap, command/event loading, shutdown |
| `config.js` | Environment-driven configuration and required-env validation |
| `instrument.js` | Sentry initialization and `captureError` |
| `logger.js` | Pino logging |
| `deploy-commands.js` | Slash command registration |
| `commands/` | Slash and context menu command modules |
| `events/` | Discord event handlers (`ready`, `messageCreate`, `guildMemberAdd`, etc.) |
| `utils/` | Database, reminders, moderation modes, search pagination, APIs |
| `tests/` | Jest suite (not shipped in Docker images) |
| `scripts/audit-log-messages.js` | Log message style audit (maintainer) |
| `set-value.js` / `remove-value.js` / `list-values.js` / `prune-db.js` | Database CLI tools |
| `Dockerfile` | Multi-stage production image (Node 24 Alpine) |
| `docker-compose.yml` | Production compose stack |

<br>

<p align="center">Built with Node.js 24 and Discord.js 14</p>
