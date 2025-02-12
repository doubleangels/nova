import asyncio
import datetime
import pytz
import uuid
import logging
from .bot_client import bot
from . import database as db

logger = logging.getLogger("Nova")

def get_role():
    try:
        role = db.get_value("role")
        if not role:
            logger.warning("No role has been set up for reminders.")
            return None
        logger.debug(f"Retrieved reminder role: {role}")
        return role
    except Exception as e:
        logger.exception(f"Error while fetching the reminder role: {e}")
        return None

async def get_channel(channel_key):
    try:
        channel_id = db.get_value(channel_key)
        if not channel_id:
            logger.warning(f"No channel has been set for '{channel_key}'.")
            return None
        logger.debug(f"Retrieved reminder channel: {channel_id}")
        return bot.get_channel(channel_id)
    except Exception as e:
        logger.exception(f"Error while fetching the reminder channel: {e}")
        return None

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

async def safe_task(task):
    try:
        await task
    except Exception as e:
        logger.exception(f"Exception in scheduled task: {e}")

async def reschedule_reminder(key, role):
    try:
        reminder_data = db.get_reminder_data(key)
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
                db.delete_reminder_data(key)
                return
            remaining_time = scheduled_dt - now
            logger.debug(f"Rescheduling reminder {reminder_id} for {key.title()} in {remaining_time}.")
            asyncio.create_task(
                safe_task(
                    send_scheduled_message(
                        initial_message=None,
                        reminder_message=(
                            f"🔔 <@&{role}> It's time to bump on {key.title()}!"
                            if key in ["disboard", "dsme", "discadia"]
                            else f"🔔 <@&{role}> It's time to boop on {key.title()}!"
                        ),
                        interval=remaining_time.total_seconds(),
                        key=key
                    )
                )
            )
    except Exception as e:
        logger.exception(f"Error while attempting to reschedule a reminder: {e}")

async def send_scheduled_message(initial_message: str, reminder_message: str, interval: int, key: str):
    try:
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
        reminder_data = db.get_reminder_data(key)
        if reminder_data:
            db.delete_reminder_data(key)
            logger.debug(f"Reminder {reminder_data.get('reminder_id')} for '{key.title()}' has been cleaned up.")
    except Exception as e:
        logger.exception(f"Error in send_scheduled_message: {e}")

async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    try:
        existing_data = db.get_reminder_data(key)
        if existing_data and existing_data.get("scheduled_time"):
            logger.debug(f"{key.capitalize()} already has a timer set. Skipping new reminder.")
            return
        reminder_id = str(uuid.uuid4())
        scheduled_time = (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat()
        db.set_reminder_data(key, True, scheduled_time, reminder_id)
        role = get_role()
        if role:
            await send_scheduled_message(
                initial_message,
                f"🔔 <@&{role}> {reminder_message}",
                interval,
                key
            )
    except Exception as e:
        logger.exception(f"Error handling reminder for key '{key}': {e}")

# Specific bump/boop handlers

async def disboard():
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Disboard again!",
        interval=7200  # 2 hours
    )

async def dsme():
    await handle_reminder(
        key="dsme",
        initial_message="Thanks for voting for the server on DS.me! I'll remind you when it's time to vote again.",
        reminder_message="It's time to vote for the server on DS.me again!",
        interval=43200  # 12 hours
    )

async def unfocused():
    await handle_reminder(
        key="unfocused",
        initial_message="Thanks for booping the server on Unfocused! I'll remind you when it's time to boop again.",
        reminder_message="It's time to boop the server on Unfocused again!",
        interval=30600  # 6 hours
    )

async def discadia():
    await handle_reminder(
        key="discadia",
        initial_message="Thanks for bumping the server on Discadia! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Discadia again!",
        interval=43200  # 12 hours
    )
