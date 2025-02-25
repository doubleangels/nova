import asyncio
import logging
from logging_setup import logger

async def safe_task(task):
    try:
        await task
    except Exception as e:
        logger.exception(f"Exception in safe_task: {e}")
