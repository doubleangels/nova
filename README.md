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
      - BOT_STATUS=your_bot_status_here
      - BOT_STATUS_TYPE=watching
      - DISCORD_BOT_TOKEN=your_discord_bot_token_here
      - GIVE_PERMS_FREN_ROLE_ID=your_fren_role_id_here
      - GIVE_PERMS_POSITION_ABOVE_ROLE_ID=your_position_above_role_id_here
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
      - SERVER_INVITE_URL=https://discord.gg/your-invite-code
      - SPOTIFY_CLIENT_ID=your_spotify_client_id_here
      - SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
    volumes:
      - ./data:/app/data:rw,noexec,nosuid
    tmpfs:
      - /tmp

networks:
  default:
    name: discord
```

## Environment Variables

Here is a table of all available environment variables:

| Variable                            | Description                                               | Required |        Default         | Example                                                      |
| ----------------------------------- | --------------------------------------------------------- | :------: | :--------------------: | ------------------------------------------------------------ |
| `BASE_EMBED_COLOR`                  | Base embed color in hex format (e.g., CD41FF or #CD41FF)  |    ❌    |    Discord default     | `CD41FF`, `#CD41FF`, `0xCD41FF`                              |
| `BOT_STATUS`                        | Bot activity status text                                  |    ❌    | `for ways to help! ❤️` | `Playing games`                                              |
| `BOT_STATUS_TYPE`                   | Bot activity type                                         |    ❌    |       `watching`       | `playing`, `watching`, `listening`, `streaming`, `competing` |
| `DISCORD_BOT_TOKEN`                 | Authentication token for your Discord bot                 |    ✅    |           -            | -                                                            |
| `GOOGLE_API_KEY`                    | API key for Google services                               |    ✅    |           -            | -                                                            |
| `GIVE_PERMS_FREN_ROLE_ID`           | Discord role ID to assign alongside custom roles          |    ❌    |           -            | `123456789012345678`                                         |
| `GIVE_PERMS_POSITION_ABOVE_ROLE_ID` | Discord role ID that new roles should be positioned above |    ❌    |           -            | `123456789012345678`                                         |
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
