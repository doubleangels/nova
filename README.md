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
      - SETUID
    security_opt:
      - no-new-privileges:true
    read_only: true
    environment:
      # Base embed color in hex format (e.g., CD41FF or #CD41FF)
      - BASE_EMBED_COLOR=your_base_embed_color_here
      # Bot activity status text
      - BOT_STATUS=your_bot_status_here
      # Bot activity type (playing, watching, listening, streaming, competing)
      - BOT_STATUS_TYPE=watching
      # Authentication token for your Discord bot
      - DISCORD_BOT_TOKEN=your_discord_bot_token_here
      # Discord role ID to assign alongside custom roles
      - GIVE_PERMS_FREN_ROLE_ID=your_fren_role_id_here
      # Discord role ID that new roles should be positioned above
      - GIVE_PERMS_POSITION_ABOVE_ROLE_ID=your_position_above_role_id_here
      # API key for Google services
      - GOOGLE_API_KEY=your_google_api_key_here
      # Name of the guild/server
      - GUILD_NAME=your_guild_name_here
      # Google Custom Search Engine ID for image searches
      - IMAGE_SEARCH_ENGINE_ID=your_image_search_engine_id_here
      # Determines the verbosity of logs (error, warn, info, debug)
      - LOG_LEVEL=info
      # Client ID for MyAnimeList API
      - MAL_CLIENT_ID=your_mal_client_id_here
      # API key for Open Movie Database
      - OMDB_API_KEY=your_omdb_api_key_here
      # API key for PirateWeather forecast service
      - PIRATEWEATHER_API_KEY=your_pirateweather_api_key_here
      # Client ID for Reddit API
      - REDDIT_CLIENT_ID=your_reddit_client_id_here
      # Client Secret for Reddit API
      - REDDIT_CLIENT_SECRET=your_reddit_client_secret_here
      # Reddit password for API authentication
      - REDDIT_PASSWORD=your_reddit_password_here
      # Reddit username for API authentication
      - REDDIT_USERNAME=your_reddit_username_here
      # Google Custom Search Engine ID for web searches
      - SEARCH_ENGINE_ID=your_search_engine_id_here
      # Server invite URL for kick messages
      - SERVER_INVITE_URL=https://discord.gg/your-invite-code
      # Client ID for Spotify API
      - SPOTIFY_CLIENT_ID=your_spotify_client_id_here
      # Client Secret for Spotify API
      - SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
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

| Variable                            | Description                                               | Required |        Default         | Example                                                      |
| ----------------------------------- | --------------------------------------------------------- | :------: | :--------------------: | ------------------------------------------------------------ |
| `BASE_EMBED_COLOR`                  | Base embed color in hex format (e.g., CD41FF or #CD41FF)  |    ❌    |    Discord default     | `CD41FF`, `#CD41FF`, `0xCD41FF`                              |
| `BOT_STATUS`                        | Bot activity status text                                  |    ❌    | `for ways to help! ❤️` | `Playing games`                                              |
| `BOT_STATUS_TYPE`                   | Bot activity type                                         |    ❌    |       `watching`       | `playing`, `watching`, `listening`, `streaming`, `competing` |
| `DISCORD_BOT_TOKEN`                 | Authentication token for your Discord bot                 |    ✅    |           -            | -                                                            |
| `GIVE_PERMS_FREN_ROLE_ID`           | Discord role ID to assign alongside custom roles          |    ❌    |           -            | `123456789012345678`                                         |
| `GIVE_PERMS_POSITION_ABOVE_ROLE_ID` | Discord role ID that new roles should be positioned above |    ❌    |           -            | `123456789012345678`                                         |
| `GOOGLE_API_KEY`                    | API key for Google services                               |    ✅    |           -            | -                                                            |
| `GUILD_NAME`                        | Name of the guild/server                                  |    ❌    |       `Da Frens`       | `My Server`                                                  |
| `IMAGE_SEARCH_ENGINE_ID`            | Google Custom Search Engine ID for image searches         |    ✅    |           -            | -                                                            |
| `LOG_LEVEL`                         | Determines the verbosity of logs                          |    ❌    |         `info`         | `error`, `warn`, `info`, `debug`                             |
| `MAL_CLIENT_ID`                     | Client ID for MyAnimeList API                             |    ✅    |           -            | -                                                            |
| `OMDB_API_KEY`                      | API key for Open Movie Database                           |    ✅    |           -            | -                                                            |
| `PIRATEWEATHER_API_KEY`             | API key for PirateWeather forecast service                |    ✅    |           -            | -                                                            |
| `REDDIT_CLIENT_ID`                  | Client ID for Reddit API                                  |    ✅    |           -            | -                                                            |
| `REDDIT_CLIENT_SECRET`              | Client Secret for Reddit API                              |    ✅    |           -            | -                                                            |
| `REDDIT_PASSWORD`                   | Reddit password for API authentication                    |    ✅    |           -            | -                                                            |
| `REDDIT_USERNAME`                   | Reddit username for API authentication                    |    ✅    |           -            | -                                                            |
| `SEARCH_ENGINE_ID`                  | Google Custom Search Engine ID for web searches           |    ✅    |           -            | -                                                            |
| `SERVER_INVITE_URL`                 | Server invite URL for kick messages                       |    ❌    |           -            | `https://discord.gg/xxxxx`                                   |
| `SPOTIFY_CLIENT_ID`                 | Client ID for Spotify API                                 |    ✅    |           -            | -                                                            |
| `SPOTIFY_CLIENT_SECRET`             | Client Secret for Spotify API                             |    ✅    |           -            | -                                                            |

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

- **Invite Tracking**: Monitor and tag invite codes with custom names, receive notifications when members join via specific invites
- **Role Management**: Assign custom roles with automatic permission management
- **Reminder System**: Automated reminders for Disboard, Discadia, and Reddit promotions
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

### `/invite`

Manage invite codes with custom tags and track member joins.

- **`tag`**: Tag an existing invite code with a custom name
- **`setup`**: Set up the channel for invite notifications
- **`list`**: List all tagged invite codes
- **`create`**: Create a new Discord invite and tag it
- **`delete`**: Delete a tagged invite code

### `/reminder`

Configure and manage server reminders for Disboard, Discadia, and Reddit promotions.

- **`setup`**: Set up the reminder channel and role
- **`status`**: Check the current reminder configuration and status

### `/promote`

Post server advertisements to Reddit with automatic cooldown management.

### `/giveperms`

Assign custom roles to users with automatic permission management.

### `/giverole` and `/takerole`

Assign or remove roles from users.

### `/changecolor` and `/changenickname`

Modify bot appearance and nickname.

### Information Commands

- **`/google`**: Search the web using Google
- **`/googleimages`**: Search for images using Google
- **`/imdb`**: Get movie information from OMDB
- **`/anime`**: Get anime information from MyAnimeList
- **`/spotify`**: Get music track information from Spotify
- **`/weather`**: Get weather information from PirateWeather
- **`/wikipedia`**: Get Wikipedia article summaries
- **`/dictionary`**: Get word definitions
- **`/urban`**: Get Urban Dictionary definitions
- **`/youtube`**: Get YouTube video information
- **`/book`**: Get book information
- **`/country`**: Get country information

### Utility Commands

- **`/coinflip`**: Flip a coin
- **`/cat`**: Get a random cat image
- **`/dog`**: Get a random dog image
- **`/timedifference`**: Calculate time differences
- **`/mock`**: Mock text (spongebob case)
- **`/notext`**: Remove text from an image

### Administrative Commands

- **`/mutemode`**: Enable or disable mute mode
- **`/spammode`**: Enable or disable spam mode
- **`/trollmode`**: Enable or disable troll mode
- **`/fix`**: Fix various bot data issues
