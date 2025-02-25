import os

DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
SEARCH_ENGINE_ID = os.getenv("SEARCH_ENGINE_ID")
IMAGE_SEARCH_ENGINE_ID = os.getenv("IMAGE_SEARCH_ENGINE_ID")
OMDB_API_KEY = os.getenv("OMDB_API_KEY")
PIRATEWEATHER_API_KEY = os.getenv("PIRATEWEATHER_API_KEY")
MAL_CLIENT_ID = os.getenv("MAL_CLIENT_ID")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

required_env_vars = {
    "DISCORD_BOT_TOKEN": DISCORD_BOT_TOKEN,
    "GOOGLE_API_KEY": GOOGLE_API_KEY,
    "SEARCH_ENGINE_ID": SEARCH_ENGINE_ID,
    "IMAGE_SEARCH_ENGINE_ID": IMAGE_SEARCH_ENGINE_ID,
    "OMDB_API_KEY": OMDB_API_KEY,
    "PIRATEWEATHER_API_KEY": PIRATEWEATHER_API_KEY,
    "MAL_CLIENT_ID": MAL_CLIENT_ID,
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_KEY": SUPABASE_KEY,
}

missing_vars = [key for key, value in required_env_vars.items() if not value]
if missing_vars:
    for var in missing_vars:
        print(f"Error: {var} not set in environment variables.")
    exit(1)
