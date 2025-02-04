# Nova

![Logo](logo.png)

## Docker Compose
```
services:
  nova:
     image: ghcr.io/doubleangels/nova:latest
     container_name: nova
     restart: always
     environment:
       - DISCORD_BOT_TOKEN=
       - GOOGLE_API_KEY=
       - SEARCH_ENGINE_ID=
       - IMAGE_SEARCH_ENGINE_ID=
       - OMDB_API_KEY=
       - PIRATEWEATHER_API_KEY=
       - SUPABASE_URL=
       - SUPABASE_KEY=

networks:
  default:
    name: discord
```