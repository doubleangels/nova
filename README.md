# nova

<div align="center">
  <img src="logo.png" alt="Logo" width="250">
</div>
<br>

Nova is a custom, admin-level Discord bot designed to bring a range of advanced functionalities to the [Da Frens](https://dafrens.games) server. With integrations for Google APIs, OMDB, PirateWeather, MAL, Supabase, and more, Nova offers a dynamic and customizable experience.

## Features

- **Multi-Platform Integration:** Connect with Google, OMDB, MAL, NewsAPI, and other APIs for enriched data and interactivity.
- **Robust Commands:** A wide array of commands to fetch information, perform searches, simplify administrative duties, and display dynamic content.
  - `/news` — Get the latest news headlines about a topic, with interactive pagination.
- **Scalable & Reliable:** Containerized with Docker for streamlined deployment and auto-restart for high availability.

## Prerequisites

Before deploying Nova, ensure you have the following:

- A valid [Discord Bot Token](https://discord.com/developers/applications)
- A [Neon](https://neon.tech) connection string
- API keys for:
  - Google (with Search Engine ID and Image Search Engine ID)
  - OMDB
  - PirateWeather
  - MAL (MyAnimeList) Client ID
  - Spotify (Client ID and Client Secret)
  - NewsAPI (for /news command)
  - Twitch (Client ID and Client Secret)

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
      - NEON_CONNECTION_STRING=your_neon_connection_string_here
      - GOOGLE_API_KEY=your_google_api_key_here
      - SEARCH_ENGINE_ID=your_search_engine_id_here
      - IMAGE_SEARCH_ENGINE_ID=your_image_search_engine_id_here
      - OMDB_API_KEY=your_omdb_api_key_here
      - PIRATEWEATHER_API_KEY=your_pirateweather_api_key_here
      - MAL_CLIENT_ID=your_mal_client_id_here
      - SPOTIFY_CLIENT_ID=your_spotify_client_id_here
      - SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
      - NEWS_API_KEY=your_newsapi_key_here
      - TWITCH_CLIENT_ID=your_twitch_client_id_here
      - TWITCH_CLIENT_SECRET=your_twitch_client_secret_here
      - GIVE_PERMS_POSITION_ABOVE_ROLE_ID=your_position_above_role_id_here
      - GIVE_PERMS_FREN_ROLE_ID=your_fren_role_id_here
      - LOG_LEVEL=your_desired_log_level_here

networks:
  default:
    name: discord
```

## Environment Variables

Here is a table of all available environment variables:

| Variable                            | Description                                               | Required | Default | Example                                                                          |
| ----------------------------------- | --------------------------------------------------------- | :------: | :-----: | -------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`                 | Authentication token for your Discord bot                 |    ✅    |    -    | -                                                                                |
| `NEON_CONNECTION_STRING`            | Connection string for Neon PostgreSQL database            |    ✅    |    -    | `postgresql://user:password@your-neon-url-123456.us-east-2.aws.neon.tech/neondb` |
| `GOOGLE_API_KEY`                    | API key for Google services                               |    ✅    |    -    | -                                                                                |
| `SEARCH_ENGINE_ID`                  | Google Custom Search Engine ID for web searches           |    ✅    |    -    | -                                                                                |
| `IMAGE_SEARCH_ENGINE_ID`            | Google Custom Search Engine ID for image searches         |    ✅    |    -    | -                                                                                |
| `OMDB_API_KEY`                      | API key for Open Movie Database                           |    ✅    |    -    | -                                                                                |
| `PIRATEWEATHER_API_KEY`             | API key for PirateWeather forecast service                |    ✅    |    -    | -                                                                                |
| `NEWS_API_KEY`                      | API key for NewsAPI (for /news command)                   |    ✅    |    -    | -                                                                                |
| `MAL_CLIENT_ID`                     | Client ID for MyAnimeList API                             |    ✅    |    -    | -                                                                                |
| `TWITCH_CLIENT_ID`                  | Client ID for Twitch API                                  |    ✅    |    -    | -                                                                                |
| `TWITCH_CLIENT_SECRET`              | Client Secret for Twitch API                              |    ✅    |    -    | -                                                                                |
| `SPOTIFY_CLIENT_ID`                 | Client ID for Spotify API                                 |    ✅    |    -    | -                                                                                |
| `SPOTIFY_CLIENT_SECRET`             | Client Secret for Spotify API                             |    ✅    |    -    | -                                                                                |
| `GIVE_PERMS_POSITION_ABOVE_ROLE_ID` | Discord role ID that new roles should be positioned above |    ✅    |    -    | -                                                                                |
| `GIVE_PERMS_FREN_ROLE_ID`           | Discord role ID to assign alongside custom roles          |    ✅    |    -    | -                                                                                |
| `LOG_LEVEL`                         | Determines the verbosity of logs                          |    ❌    | `info`  | `error`, `warn`, `info`, `debug`                                                 |
