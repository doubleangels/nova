"""
This is the __init__.py file for the nova package.
It re-exports key objects from submodules so that they can be easily imported from the package.
"""

from .config import (
    TOKEN,
    GOOGLE_API_KEY,
    SEARCH_ENGINE_ID,
    IMAGE_SEARCH_ENGINE_ID,
    OMDB_API_KEY,
    PIRATEWEATHER_API_KEY,
    MAL_CLIENT_ID,
    SUPABASE_URL,
    SUPABASE_KEY,
    logger,
)
from .bot_client import bot

__all__ = [
    "TOKEN",
    "GOOGLE_API_KEY",
    "SEARCH_ENGINE_ID",
    "IMAGE_SEARCH_ENGINE_ID",
    "OMDB_API_KEY",
    "PIRATEWEATHER_API_KEY",
    "MAL_CLIENT_ID",
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "logger",
    "bot",
]

