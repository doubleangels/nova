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
       - GEMINI_API_KEY=
     volumes:
       - ./nova:/db

networks:
  default:
    name: discord
```