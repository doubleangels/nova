# Nova Discord Bot

<div align="center">
  <img src="logo.png" alt="Logo" width="250">
</div>
<br>

A feature-rich Discord bot designed to bring advanced functionalities to your Discord server. With integrations for Google APIs, OMDB, PirateWeather, MAL, Spotify, Reddit, and more, Nova offers a dynamic and customizable experience with robust administrative tools.

## 🚀 Quick Start

### Prerequisites

- [Discord Bot Token](https://discord.com/developers/applications) - Create a new application and bot
- API keys for:
  - [Google API](https://console.cloud.google.com/) - With Search Engine ID and Image Search Engine ID
  - [OMDB API](http://www.omdbapi.com/apikey.aspx) - For movie information
  - [PirateWeather](https://pirateweather.net/) - For weather forecasts
  - [MyAnimeList](https://myanimelist.net/apiconfig) - Client ID for anime information
  - [Spotify](https://developer.spotify.com/) - Client ID and Client Secret
  - [Reddit](https://www.reddit.com/prefs/apps) - Client ID and Client Secret
- Docker and Docker Compose

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
      - DOPPLER_TOKEN=${DOPPLER_TOKEN}
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

| Variable        | Description                                      | Required | Default | Example |
| --------------- | ------------------------------------------------ | :------: | :-----: | ------- |
| `DOPPLER_TOKEN` | Doppler service token (injects secrets as env vars) |    ✅    |    -    | -       |

**Note:** Secrets and API keys are injected at runtime by [Doppler](https://www.doppler.com/). Pass `DOPPLER_TOKEN` when running the container so the bot receives the following (configure them in your Doppler project):
- `BASE_EMBED_COLOR`
- `BOT_STATUS`
- `BOT_STATUS_TYPE`
- `DISCORD_BOT_TOKEN`
- `GIVE_PERMS_FREN_ROLE_ID`
- `GIVE_PERMS_POSITION_ABOVE_ROLE_ID`
- `NEWUSER_BEEN_IN_SERVER_BEFORE_ROLE_ID`
- `NEWUSER_PERMISSION_DIFF_ROLE_ID`
- `GOOGLE_API_KEY`
- `GUILD_NAME`
- `IMAGE_SEARCH_ENGINE_ID`
- `LOG_LEVEL`
- `MAL_CLIENT_ID`
- `OMDB_API_KEY`
- `PIRATEWEATHER_API_KEY`
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_PASSWORD`
- `REDDIT_USERNAME`
- `SEARCH_ENGINE_ID`
- `SERVER_INVITE_URL`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Ensure your Doppler project contains these config values. Pass `DOPPLER_TOKEN` when running the container (e.g. via `doppler run -- docker compose up` or by setting `DOPPLER_TOKEN` in the service environment).

## 🎯 Features

### Multi-Platform Integration

- **Google Services**: Web search and image search capabilities
- **OMDB**: Movie and TV show information
- **PirateWeather**: Weather forecasts and conditions
- **MyAnimeList**: Anime and manga information
- **Spotify**: Music track information and search
- **Reddit**: Server promotion and content sharing
- **Wikipedia**: Article summaries and information

### Administrative Tools

- **Invite Tracking**: Monitor and tag invite codes with custom names, receive notifications when members join via tagged invites (only tagged invites are tracked)
- **Role Management**: Assign custom roles with automatic permission management
- **Reminder System**: Automated reminders for Disboard and Reddit promotions
- **Mute Mode**: Automatically kick inactive users
- **Troll Mode**: Kick new accounts that don't meet age requirements
- **Spam Mode**: Enhanced spam detection and moderation

### Information & Entertainment

- **Search Commands**: Google web search and image search
- **Media Information**: Movies (IMDB/OMDB), anime (MAL), music (Spotify), books
- **Weather**: Current conditions and forecasts
- **Dictionary & Urban Dictionary**: Word definitions and slang
- **Random Content**: Cat and dog images, coin flips, country information
- **YouTube**: Video information and links

## 🔧 Commands

### Administrative Commands

#### `/invite` (Administrator Only)

Manage invite codes with custom tags and track member joins. Receive notifications when members join via tagged invites. **Note:** Only tagged invites are tracked and will trigger notifications.

**Subcommands:**

- **`tag`**: Tag an existing invite code with a custom name
  - `code` (required): The invite code (can be just the code or full URL like `discord.gg/xxxxx`)
  - `name` (required): The custom name/tag to associate with this invite code
- **`setup`**: Set up the channel for invite notifications
  - `channel` (required): The text channel where invite notifications will be sent
- **`list`**: List all tagged invite codes with their associated names and URLs
- **`create`**: Create a new Discord invite and automatically tag it
  - `name` (required): The name/tag for this invite
  - `channel` (optional): The channel to create the invite for (defaults to first available text channel)
  - `max_uses` (optional): Maximum number of uses (0 = unlimited, max: 100)
  - `max_age` (optional): Maximum age in seconds (0 = never expires, max: 604800)
- **`remove`**: Remove a tagged invite code (with autocomplete for tag names)
  - `name` (required): The name/tag of the invite to remove

#### `/reminder` (Administrator Only)

Configure and manage server reminders for Disboard and Reddit promotions.

**Subcommands:**

- **`setup`**: Set up the reminder channel and role
  - `channel` (required): The text channel where reminders will be sent
  - `role` (required): The role to ping when reminders are sent
- **`status`**: Check the current reminder configuration and status
  - Shows next scheduled bump time for Disboard
  - Shows next scheduled promotion time for Reddit

#### `/promote` (Administrator Only)

Post server advertisements to Reddit (r/findaserver) with automatic cooldown management. The bot enforces a 24-hour cooldown between promotions.

**Requirements:** Reddit API credentials must be configured.

#### `/giveperms` (Manage Roles Permission)

Create and assign custom roles to users with automatic permission management. Creates a new role with the specified name and color, positions it above a reference role, and assigns it along with a "fren" role.

**Parameters:**

- `role` (required): The name for the new role (max 100 characters)
- `color` (required): The color in hex format (e.g., `#RRGGBB` or `RRGGBB`)
- `user` (required): The user to receive the permissions

**Requirements:**

- `GIVE_PERMS_POSITION_ABOVE_ROLE_ID` must be configured in Doppler (or env)
- `GIVE_PERMS_FREN_ROLE_ID` must be configured in Doppler (or env)
- `NEWUSER_BEEN_IN_SERVER_BEFORE_ROLE_ID` and `NEWUSER_PERMISSION_DIFF_ROLE_ID` (for `/newuser`) must be configured in Doppler (or env)

#### `/giverole` (Manage Roles Permission)

Assign an existing role to a user.

**Parameters:**

- `role` (required): The role to assign
- `user` (required): The user to give the role to

#### `/takerole` (Manage Roles Permission)

Remove a role from a user.

**Parameters:**

- `role` (required): The role to remove
- `user` (required): The user to remove the role from
- `reason` (optional): Reason for removing the role

#### `/changecolor` (Manage Roles Permission)

Change the color of a role.

**Parameters:**

- `role` (required): The role to change the color of
- `color` (required): The new color in hex format (e.g., `#RRGGBB` or `RRGGBB`)

#### `/changenickname` (Manage Nicknames Permission)

Change a user's nickname in the server.

**Parameters:**

- `user` (required): The user whose nickname to change
- `nickname` (optional): The new nickname (1-32 characters). If omitted, resets the nickname.

#### `/notext` (Manage Channels Permission)

Configure a channel to only allow GIFs and stickers, preventing text messages.

**Subcommands:**

- **`set`**: Set a channel to only allow GIFs and stickers
  - `channel` (required): The text channel to configure
- **`remove`**: Remove no-text configuration from a channel
  - `channel` (required): The text channel to remove the configuration from

#### `/mutemode` (Administrator Only)

Toggle automatic kicking of users who don't send a message within a time limit.

**Subcommands:**

- **`set`**: Configure mute mode settings
  - `enabled` (required): Enable or disable mute mode
  - `time` (optional): Hours a user must be silent before being kicked (1-72, default: 2)
- **`status`**: Check the current mute mode status and settings

**Note:** Bot accounts are exempt from mute mode tracking.

#### `/spammode` (Administrator Only)

Manage server-wide spam detection settings. Automatically deletes duplicate messages and posts warnings.

**Subcommands:**

- **`set`**: Configure spam mode settings
  - `enabled` (required): Enable or disable spam mode
  - `threshold` (optional): Minimum number of duplicate messages to trigger spam mode (2-10, default: 3)
  - `window` (optional): Hours to track duplicate messages (1-72, default: 4)
  - `channel` (optional): Channel to send spam warnings to
- **`status`**: Check the current spam mode status and settings

**Note:** Bot accounts are exempt from spam mode tracking.

#### `/trollmode` (Administrator Only)

Manage automatic kicking of new members based on account age requirements.

**Subcommands:**

- **`set`**: Configure troll mode settings
  - `enabled` (required): Enable or disable troll mode
  - `age` (optional): Minimum account age in days required to join (1-365, default: 30)
- **`status`**: Check the current troll mode status and settings

**Note:** Bot accounts are exempt from troll mode tracking.

#### `/fix` (Administrator Only)

Fix reminder data in the database for various reminder types.

**Subcommands:**

- **`disboard`**: Fix Disboard bump reminder data (reschedules for 2 hours from now)
- **`reddit`**: Fix Reddit promotion reminder data (reschedules for 24 hours from now)

**Note:** Reminder configuration must be set up using `/reminder setup` before using this command.

### Information Commands

#### `/google`

Search the web using Google Custom Search API.

**Parameters:**

- `query` (required): The search query
- `results` (optional): Number of results to return (1-10, default: 5)

**Features:** Paginated results with summaries and links.

#### `/googleimages`

Search for images using Google Custom Search API.

**Parameters:**

- `query` (required): The image search query
- `results` (optional): Number of results to return (1-10, default: 5)

**Features:** Paginated results with image previews and source links.

#### `/imdb`

Search for movies and TV shows using IMDb data via OMDb API.

**Subcommands:**

- **`movie`**: Search for a movie
  - `title` (required): The movie title to search for
- **`tv`**: Search for a TV show
  - `title` (required): The TV show title to search for

**Information displayed:** Plot, year, rating, genre, director, actors, awards, and IMDb link.

#### `/anime`

Search for anime information from MyAnimeList.

**Parameters:**

- `title` (required): The anime title to search for

**Information displayed:** Synopsis, genres, MAL rating, release date, and link to MyAnimeList page.

#### `/spotify`

Search for music content on Spotify. Supports songs, albums, artists, playlists, and podcasts.

**Subcommands:**

- **`song`**: Search for a song
  - `query` (required): The song to search for
- **`album`**: Search for an album
  - `query` (required): The album to search for
- **`artist`**: Search for an artist
  - `query` (required): The artist to search for
- **`playlist`**: Search for a playlist
  - `query` (required): The playlist to search for
- **`podcast`**: Search for a podcast
  - `query` (required): The podcast to search for

**Features:** Paginated results with detailed information including links, images, and metadata.

#### `/weather`

Get weather information for any location using PirateWeather API.

**Parameters:**

- `place` (required): The location name (e.g., "New York", "Tokyo", "London")
- `units` (optional): Unit system - `metric` (°C, m/s) or `imperial` (°F, mph), default: `metric`
- `forecast_days` (optional): Number of days for forecast (1-7, default: 3)

**Information displayed:** Current conditions, temperature, humidity, wind speed, UV index, visibility, pressure, dew point, cloud cover, precipitation, and multi-day forecast.

#### `/wikipedia`

Fetch and display Wikipedia article summaries.

**Parameters:**

- `query` (required): The search query

**Features:** Searches Wikipedia and displays the first result with a summary and link to the full article.

#### `/dictionary`

Get word definitions from a free dictionary API.

**Parameters:**

- `word` (required): The word to look up

**Information displayed:** Definition, phonetic pronunciation, and part of speech.

#### `/urban`

Get definitions from Urban Dictionary.

**Parameters:**

- `term` (required): The term to search for

**Information displayed:** Definition, example usage, author, and thumbs up/down counts.

#### `/youtube`

Search for YouTube content including videos, channels, and playlists.

**Parameters:**

- `query` (required): The search query
- `type` (optional): Content type - `video`, `channel`, or `playlist` (default: `video`)

**Features:** Paginated results with rich embeds showing thumbnails, statistics, and links.

#### `/book`

Search for books using Google Books API.

**Subcommands:**

- **`search`**: Search for books by title, author, or general query
  - `query` (required): The search query (title, author, etc.)
- **`isbn`**: Search for a book by ISBN
  - `isbn` (required): The ISBN (10 or 13 digits)

**Information displayed:** Title, authors, description, publication date, page count, language, publisher, rating, categories, ISBN numbers, and links to preview/info pages.

**Features:** Paginated results with book covers and detailed metadata.

#### `/country`

Get information about any country using the REST Countries API.

**Parameters:**

- `name` (required): The country name (e.g., "France", "Japan", "Brazil")

**Information displayed:** Official name, flag, region, subregion, capital, population, currencies, area, and Google Maps link.

### Utility Commands

#### `/coinflip`

Flip a coin and get a random result of heads or tails.

#### `/cat`

Fetch and display a random cat image from The Cat API.

#### `/dog`

Fetch and display a random dog image from Dog CEO API.

#### `/timedifference`

Calculate the time difference between two locations.

**Parameters:**

- `place1` (required): The first location (e.g., "Tokyo", "London", "New York")
- `place2` (required): The second location

**Information displayed:** Time zones for both locations, UTC offsets, and the time difference between them.

**Requirements:** Google API key must be configured.

#### `/mock` (Context Menu Command)

Convert a message to mocking text format (alternating case by word). Right-click on a message and select "Mock" from the context menu.

**Note:** Works on messages with text content. Messages longer than 2000 characters cannot be converted.
