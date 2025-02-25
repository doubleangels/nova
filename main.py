import asyncio
import signal
import sys
import logging
import sentry_sdk
from bot_instance import bot
from logging_setup import logger
import events
# Import commands so that they register their slash commands.
from commands import admin, search, fun, general

async def shutdown(loop, signal_received=None):
    tasks = [t for t in asyncio.all_tasks(loop) if t is not asyncio.current_task(loop)]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    sentry_sdk.flush(timeout=2)
    loop.stop()

def handle_interrupt(signal_received, frame):
    loop = asyncio.get_event_loop()
    loop.create_task(shutdown(loop, signal_received))

if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_interrupt)
    signal.signal(signal.SIGTERM, handle_interrupt)
    try:
        logger.info("Starting the bot...")
        asyncio.run(bot.astart())
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received. Exiting.")
    finally:
        logging.shutdown()
        sys.exit(0)
