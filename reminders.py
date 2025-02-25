import asyncio
import datetime
import pytz
import uuid
import logging
from supabase_helpers import get_reminder_data, set_reminder_data, delete_reminder_data, get_value
from logging_setup import logger
from bot_instance import bot

def calculate_remaining_time(scheduled_time):
    if not scheduled_time:
        return "Not set!"
    try:
        now = datetime.datetime.now(tz=pytz.UTC)
        scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
        remaining_time = scheduled_dt - now
        if remaining_time <= datetime.timedelta(seconds=0):
            return "⏰ Expired!"
        hours, remainder = divmod(int(remaining_time.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        time_str = f"{hours:02}:{minutes:02}:{seconds:02}"
        logger.debug(f"Remaining time calculated: {time_str}")
        return time_str
    except Exception as e:
        logger.exception(f"Error calculating remaining time: {e}")
        return "⚠️ Error calculating time!"

async def send_scheduled_message(initial_message: str, reminder_message: str, interval: int, key: str):
    try:
        from events import get_channel
        channel = await get_channel("reminder_channel")
        if not channel:
            logger.warning("No valid reminder channel found; cannot send scheduled message.")
            return
        if initial_message:
            logger.debug(f"Sending initial message for '{key}': {initial_message}")
            await channel.send(initial_message)
        logger.debug(f"Waiting {interval} seconds before sending reminder for '{key}'.")
        await asyncio.sleep(interval)
        logger.debug(f"Sending reminder message for '{key}': {reminder_message}")
        await channel.send(reminder_message)
        reminder_data = get_reminder_data(key)
        if reminder_data:
            delete_reminder_data(key)
            logger.debug(f"Reminder {reminder_data.get('reminder_id')} for '{key.title()}' has been cleaned up.")
    except Exception as e:
        logger.exception(f"Error in send_scheduled_message: {e}")

async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    try:
        from supabase_helpers import get_reminder_data, set_reminder_data
        existing_data = get_reminder_data(key)
        if existing_data and existing_data.get("scheduled_time"):
            logger.debug(f"{key.capitalize()} already has a timer set. Skipping new reminder.")
            return
        reminder_id = str(uuid.uuid4())
        set_reminder_data(
            key,
            True,
            (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
            reminder_id
        )
        from supabase_helpers import get_value
        role = get_value("role")
        if role:
            await send_scheduled_message(
                initial_message,
                f"🔔 <@&{role}> {reminder_message}",
                interval,
                key
            )
    except Exception as e:
        logger.exception(f"Error handling reminder for key '{key}': {e}")

async def reschedule_reminder(key: str, role):
    try:
        reminder_data = get_reminder_data(key)
        if not reminder_data:
            logger.debug(f"No reminder data found for {key.title()}.")
            return
        scheduled_time = reminder_data.get("scheduled_time")
        reminder_id = reminder_data.get("reminder_id")
        if scheduled_time and reminder_id:
            scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
            now = datetime.datetime.now(tz=pytz.UTC)
            if scheduled_dt <= now:
                logger.debug(f"Reminder {reminder_id} for {key.title()} has already expired. Removing it.")
                delete_reminder_data(key)
                return
            remaining_time = (scheduled_dt - now).total_seconds()
            logger.debug(f"Rescheduling reminder {reminder_id} for {key.title()} in {remaining_time} seconds.")
            asyncio.create_task(
                safe_task(
                    send_scheduled_message(
                        initial_message=None,
                        reminder_message=(f"🔔 <@&{role}> It's time to bump on {key.title()}!"
                                            if key in ["disboard", "dsme", "discadia"]
                                            else f"🔔 <@&{role}> It's time to boop on {key.title()}!"),
                        interval=remaining_time,
                        key=key
                    )
                )
            )
    except Exception as e:
        logger.exception(f"Error while attempting to reschedule a reminder: {e}")

async def safe_task(task):
    try:
        await task
    except Exception as e:
        logger.exception(f"Exception in scheduled task: {e}")

def initialize_reminders_table():
    default_keys = ["disboard", "discadia", "dsme", "unfocused"]
    for key in default_keys:
        if get_reminder_data(key) is None:
            set_reminder_data(key, False, None, None)
            logger.debug(f"Inserted default reminder_data for key: {key}")
