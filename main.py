import sys
import logging
from nova.bot_client import bot
# Import the events and commands modules so their listeners and commands get registered.
import nova.events  
import nova.commands  
from nova.config import logger

if __name__ == "__main__":
    try:
        logger.info("Starting the bot...")
        bot.start()  # starts the bot using the token from config.py
    except Exception:
        logger.exception("Exception occurred during bot startup!")
        sys.exit(1)
