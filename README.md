# nova

![Logo](logo.png)

Nova is a powerful Discord bot designed to bring a range of advanced functionalities to your server. With integrations for Google APIs, OMDB, PirateWeather, MAL, Supabase, and more, Nova offers a dynamic and customizable experience for your community.

## Features

- **Multi-Platform Integration:** Connect with Google, OMDB, MAL, and other APIs for enriched data and interactivity.
- **Robust Commands:** A wide array of commands to fetch information, perform searches, and display dynamic content.
- **Scalable & Reliable:** Containerized with Docker for streamlined deployment and auto-restart for high availability.

## Prerequisites

Before deploying Nova, ensure you have the following:

- A valid [Discord Bot Token](https://discord.com/developers/applications)
- API keys for:
  - Google (with Search Engine ID and Image Search Engine ID)
  - OMDB
  - PirateWeather
  - MAL (MyAnimeList) Client ID
  - [Neon](https://neon.tech) connection string

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
      - SEARCH_ENGINE_ID=your_search_engine_id_here
      - IMAGE_SEARCH_ENGINE_ID=your_image_search_engine_id_here
      - OMDB_API_KEY=your_omdb_api_key_here
      - PIRATEWEATHER_API_KEY=your_pirateweather_api_key_here
      - MAL_CLIENT_ID=your_mal_client_id_here
      - NEON_CONNECTION_STRING=

networks:
  default:
    name: discord
```
