import asyncio
import datetime
import io
import json
import logging
import os
import signal
import sys
import time
import uuid

import aiohttp
import interactions
import numpy as np
import pytz
import sentry_sdk
from PIL import Image
from sentry_sdk.integrations.logging import LoggingIntegration
from supabase import Client, create_client

# -------------------------
# Sentry Setup with Logging Integration
# -------------------------
sentry_logging = LoggingIntegration(
    level=logging.DEBUG,        # Capture info and above as breadcrumbs
    event_level=logging.ERROR   # Send errors as events
)
sentry_sdk.init(
    dsn="https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
    integrations=[sentry_logging],
    traces_sample_rate=1.0,
    profiles_sample_rate=1.0,
)

# -------------------------
# Logger Configuration (Console Only)
# -------------------------
# Set log level from environment variable, defaulting to DEBUG if not set.
LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG").upper()

logger = logging.getLogger("Nova")
logger.setLevel(LOG_LEVEL)

# Format for log messages includes timestamp, logger name, level, filename, and line number.
log_format = "%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"
formatter = logging.Formatter(log_format)

# Configure console handler to output logs to stdout.
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(LOG_LEVEL)
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# -------------------------
# Environment Variable Check
# -------------------------
required_env_vars = {
    "DISCORD_BOT_TOKEN": os.getenv("DISCORD_BOT_TOKEN"),
    "GOOGLE_API_KEY": os.getenv("GOOGLE_API_KEY"),
    "SEARCH_ENGINE_ID": os.getenv("SEARCH_ENGINE_ID"),
    "IMAGE_SEARCH_ENGINE_ID": os.getenv("IMAGE_SEARCH_ENGINE_ID"),
    "OMDB_API_KEY": os.getenv("OMDB_API_KEY"),
    "PIRATEWEATHER_API_KEY": os.getenv("PIRATEWEATHER_API_KEY"),
    "MAL_CLIENT_ID": os.getenv("MAL_CLIENT_ID"),
    "SUPABASE_URL": os.getenv("SUPABASE_URL"),
    "SUPABASE_KEY": os.getenv("SUPABASE_KEY"),
}

# Exit if any required environment variable is missing.
missing_vars = [key for key, value in required_env_vars.items() if not value]
if missing_vars:
    for var in missing_vars:
        logger.error(f"{var} not found in environment variables.")
    sys.exit(1)

# Assign environment variable values to constants.
TOKEN = required_env_vars["DISCORD_BOT_TOKEN"]
GOOGLE_API_KEY = required_env_vars["GOOGLE_API_KEY"]
SEARCH_ENGINE_ID = required_env_vars["SEARCH_ENGINE_ID"]
IMAGE_SEARCH_ENGINE_ID = required_env_vars["IMAGE_SEARCH_ENGINE_ID"]
OMDB_API_KEY = required_env_vars["OMDB_API_KEY"]
PIRATEWEATHER_API_KEY = required_env_vars["PIRATEWEATHER_API_KEY"]
MAL_CLIENT_ID = required_env_vars["MAL_CLIENT_ID"]
SUPABASE_URL = required_env_vars["SUPABASE_URL"]
SUPABASE_KEY = required_env_vars["SUPABASE_KEY"]

# -------------------------
# Supabase Client
# -------------------------
# Create a Supabase client instance to interact with the database.
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------
# "config" Table Helpers
# -------------------------
def get_value(key: str):
    """
    Retrieve a JSON value from the 'config' table in Supabase for the provided key.
    
    :param key: The key to look up.
    :return: The parsed JSON value, or None if not found or on error.
    """
    try:
        response = supabase.table("config").select("value").eq("id", key).maybe_single().execute()
        if response is None:
            logger.warning(f"Supabase query for key '{key}' returned None.")
            return None
        if response.data and isinstance(response.data, dict) and "value" in response.data:
            return json.loads(response.data["value"])
        logger.warning(f"Key '{key}' not found in Supabase or data missing.")
        return None
    except Exception:
        logger.exception(f"Error getting key '{key}' in Supabase.")
        return None

def set_value(key: str, value):
    """
    Insert or update a JSON value in the 'config' table in Supabase.
    
    :param key: The key to set.
    :param value: The value to serialize and store.
    """
    try:
        serialized = json.dumps(value)
        existing = get_value(key)
        if existing is None:
            supabase.table("config").insert({"id": key, "value": serialized}).execute()
            logger.debug(f"Inserted new config entry for key '{key}'.")
        else:
            supabase.table("config").update({"value": serialized}).eq("id", key).execute()
            logger.debug(f"Updated config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting key '{key}' in Supabase.")

def delete_value(key: str):
    """
    Delete a key/value pair from the 'config' table in Supabase.
    
    :param key: The key to delete.
    """
    try:
        supabase.table("config").delete().eq("id", key).execute()
        logger.debug(f"Deleted config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting key '{key}' in Supabase.")

# -------------------------
# "reminders" Table Helpers
# -------------------------
def get_reminder_data(key: str):
    """
    Retrieve reminder data from the 'reminders' table in Supabase for the given key.
    
    :param key: The reminder key (e.g., "disboard").
    :return: A dictionary with reminder data or None if not found.
    """
    try:
        response = supabase.table("reminders").select("state", "scheduled_time", "reminder_id").eq("key", key).maybe_single().execute()
        if response and response.data:
            return {
                "state": response.data.get("state", False),
                "scheduled_time": response.data.get("scheduled_time"),
                "reminder_id": response.data.get("reminder_id")
            }
        return None
    except Exception:
        logger.exception(f"Error getting reminder data for key '{key}'.")
        return None

def set_reminder_data(key: str, state: bool, scheduled_time: datetime, reminder_id: str):
    """
    Insert or update reminder data in the 'reminders' table.
    
    :param key: The reminder key.
    :param state: Whether the reminder is active.
    :param scheduled_time: The ISO-formatted scheduled time.
    :param reminder_id: The unique reminder identifier.
    """
    try:
        existing = get_reminder_data(key)
        data = {
            "key": key,
            "state": state,
            "scheduled_time": scheduled_time,
            "reminder_id": reminder_id
        }

        if existing is None:
            supabase.table("reminders").insert(data).execute()
            logger.debug(f"Inserted new reminder entry for key '{key}'.")
        else:
            supabase.table("reminders").update(data).eq("key", key).execute()
            logger.debug(f"Updated reminder entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting reminder data for key '{key}'.")

def delete_reminder_data(key: str):
    """
    Delete reminder data for the given key from the 'reminders' table.
    
    :param key: The reminder key to delete.
    """
    try:
        supabase.table("reminders").delete().eq("key", key).execute()
        logger.debug(f"Deleted reminder data for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting reminder data for key '{key}'.")

def initialize_reminders_table():
    """
    Ensure that default reminder keys exist in the 'reminders' table.
    """
    default_keys = ["disboard", "discadia", "dsme", "unfocused"]
    for key in default_keys:
        existing = get_reminder_data(key)
        if existing is None:
            set_reminder_data(key, False, None, None)
            logger.debug(f"Inserted default reminder_data for key: {key}")

# ----------------------
# "tracked_members" Table Helpers
# ----------------------
def track_new_member(member_id: int, username: str, join_time: str):
    """
    Insert or update a tracked member in the 'tracked_members' table.
    
    :param member_id: The Discord user ID.
    :param username: The user's name.
    :param join_time: The time the user joined (ISO format).
    """
    try:
        response = supabase.table("tracked_members").upsert({
            "member_id": member_id,
            "join_time": join_time,
            "username": username
        }).execute()

        if response:
            logger.debug(f"Tracked new member: {username} at {join_time}.")
        else:
            logger.warning(f"Failed to track {username} - No response from Supabase.")
    except Exception as e:
        logger.exception(f"Error tracking new member {username}: {e}")

def get_tracked_member(member_id: int):
    """
    Retrieve tracked member data from the 'tracked_members' table.
    
    :param member_id: The Discord user ID.
    :return: The tracked member data or None if not found.
    """
    try:
        response = supabase.table("tracked_members").select("*").eq("member_id", member_id).maybe_single().execute()
        if response and response.data:
            return response.data
        return None
    except Exception:
        logger.exception(f"Error retrieving tracked data for a member.")
        return None

def remove_tracked_member(member_id: int):
    """
    Remove a tracked member from the 'tracked_members' table.
    
    :param member_id: The Discord user ID.
    """
    try:
        response = supabase.table("tracked_members").delete().eq("member_id", member_id).execute()
        resp_dict = response.dict()
        if resp_dict.get("error"):
            logger.error(f"Failed to remove tracked member.")
        elif not resp_dict.get("data"):
            logger.debug(f"No tracked member found. Nothing to remove.")
        else:
            logger.debug(f"Removed tracked member.")
    except Exception as e:
        logger.exception(f"Error removing tracked member: {e}")

def get_all_tracked_members():
    """
    Retrieve all tracked members from the 'tracked_members' table.
    
    :return: A list of tracked member records.
    """
    try:
        response = supabase.table("tracked_members").select("member_id", "username", "join_time").execute()
        if response and response.data:
            return response.data
        return []
    except Exception:
        logger.exception("Error retrieving all tracked members from Supabase.")
        return []

# -------------------------
# Discord Bot Setup
# -------------------------
bot = interactions.Client(
    intents=(
        interactions.Intents.DEFAULT
        | interactions.Intents.MESSAGE_CONTENT
        | interactions.Intents.GUILD_MEMBERS
    )
)

# Dictionary mapping known bot IDs to their names.
bot_ids = {
    "302050872383242240": "Disboard",
    "1222548162741538938": "Discadia",
    "493224033067003023": "DS.me",
    "835255643157168168": "Unfocused",
}

logger.info("Starting the bot...")

def handle_interrupt(signal_num, frame):
    """
    Gracefully shutdown the bot on interrupt signals.
    """
    logger.info("Gracefully shutting down.")
    sys.exit(0)

# Bind the interrupt handlers.
signal.signal(signal.SIGINT, handle_interrupt)
signal.signal(signal.SIGTERM, handle_interrupt)

def get_role():
    """
    Retrieve the role ID stored in the 'role' key from Supabase.
    This function may be expanded to resolve the role name.
    
    :return: The role identifier, or None if not set.
    """
    try:
        role = get_value("role")
        if not role:
            logger.warning("No role has been set up for reminders.")
            return None
        logger.debug(f"Retrieved reminder role: {role}")
        return role
    except Exception as e:
        logger.exception(f"Error while fetching the reminder role: {e}")
        return None

async def get_channel(channel_key):
    """
    Fetch the channel object from the stored channel ID in Supabase.
    
    :param channel_key: The key in Supabase storing the channel ID.
    :return: The channel object if found, otherwise None.
    """
    try:
        channel_id = get_value(channel_key)
        if not channel_id:
            logger.warning(f"No channel has been set for '{channel_key}'.")
            return None
        channel_obj = bot.get_channel(channel_id)
        if channel_obj:
            logger.debug(f"Retrieved reminder channel: {channel_obj.name}")
        else:
            logger.debug("Channel not found.")
        return channel_obj
    except Exception as e:
        logger.exception(f"Error while fetching the reminder channel: {e}")
        return None

def calculate_remaining_time(scheduled_time):
    """
    Calculate the remaining time until the scheduled reminder.
    
    :param scheduled_time: The ISO-formatted scheduled time.
    :return: A string representing the remaining time in HH:MM:SS format.
    """
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
    """
    Run a given asynchronous task safely, logging exceptions.
    
    :param task: The coroutine to execute.
    """
    try:
        await task
    except Exception as e:
        logger.exception(f"Exception in scheduled task: {e}")

async def reschedule_reminder(key, role):
    """
    Reschedule a reminder if its scheduled time is still in the future.
    
    :param key: The reminder key.
    :param role: The role to ping.
    """
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

async def get_coordinates(city: str):
    """
    Get latitude and longitude for a given city using Google Geocoding API.
    
    :param city: The city name.
    :return: Tuple of (lat, lon) if found, else (None, None).
    """
    try:
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {"address": city, "key": GOOGLE_API_KEY}
        async with aiohttp.ClientSession() as session:
            async with session.get(geocode_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Google Geocoding API response: {json.dumps(data, indent=2)}")
                    if data.get("results"):
                        location = data["results"][0]["geometry"]["location"]
                        lat, lon = location["lat"], location["lng"]
                        logger.debug(f"Retrieved coordinates for {city}: ({lat}, {lon})")
                        return lat, lon
                    else:
                        logger.warning(f"No results found for city: {city}")
                else:
                    logger.error(f"Google Geocoding API error: Status {response.status}")
    except Exception as e:
        logger.exception(f"Error fetching city coordinates: {e}")
    return None, None

# -------------------------
# Specific Bump/Boop Handlers
# -------------------------
async def disboard():
    """
    Trigger Disboard bump reminder logic.
    """
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Disboard again!",
        interval=7200  # 2 hours
    )

async def dsme():
    """
    Trigger DS.me vote reminder logic.
    """
    await handle_reminder(
        key="dsme",
        initial_message="Thanks for voting for the server on DS.me! I'll remind you when it's time to vote again.",
        reminder_message="It's time to vote for the server on DS.me again!",
        interval=43200  # 12 hours
    )

async def unfocused():
    """
    Trigger Unfocused boop reminder logic.
    """
    await handle_reminder(
        key="unfocused",
        initial_message="Thanks for booping the server on Unfocused! I'll remind you when it's time to boop again.",
        reminder_message="It's time to boop the server on Unfocused again!",
        interval=30600  # 6 hours 50 minutes approx.
    )

async def discadia():
    """
    Trigger Discadia bump reminder logic.
    """
    await handle_reminder(
        key="discadia",
        initial_message="Thanks for bumping the server on Discadia! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Discadia again!",
        interval=43200  # 12 hours
    )

# -------------------------
# Reminder Scheduling
# -------------------------
async def send_scheduled_message(initial_message: str, reminder_message: str, interval: int, key: str):
    """
    Send an initial message (if provided), wait for the specified interval,
    then send a reminder message and clean up the reminder data.
    
    :param initial_message: Message to send immediately.
    :param reminder_message: Reminder message to send after delay.
    :param interval: Delay in seconds before sending the reminder.
    :param key: The reminder key.
    """
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

        # Clean up the reminder from the database.
        reminder_data = get_reminder_data(key)
        if reminder_data:
            delete_reminder_data(key)
            logger.debug(f"Reminder {reminder_data['reminder_id']} for '{key.title()}' has been cleaned up.")

    except Exception as e:
        logger.exception(f"Error in send_scheduled_message: {e}")

async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    """
    Handle setting up a new reminder if one isn't already active.
    
    :param key: The reminder key.
    :param initial_message: The initial confirmation message.
    :param reminder_message: The message to send when the reminder triggers.
    :param interval: The delay in seconds before the reminder.
    """
    try:
        existing_data = get_reminder_data(key)
        if existing_data and existing_data.get("scheduled_time"):
            logger.debug(f"{key.capitalize()} already has a timer set. Skipping new reminder.")
            return
        
        # Generate a unique reminder ID.
        reminder_id = str(uuid.uuid4())
        set_reminder_data(
            key,
            True,
            (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
            reminder_id
        )
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

# -------------------------
# Mute Mode Kick Scheduling
# -------------------------
async def schedule_mute_kick(member_id: int, username: str, join_time: str, mute_kick_time: int, guild_id: int):
    """
    Schedule a mute mode kick for a user, calculating remaining time based on join_time.
    
    :param member_id: Discord user ID.
    :param username: The username.
    :param join_time: ISO formatted join time.
    :param mute_kick_time: Total time in hours allowed before kick.
    :param guild_id: The guild (server) ID.
    """
    try:
        now = datetime.datetime.now(datetime.UTC)
        join_time_dt = datetime.datetime.fromisoformat(join_time)
        
        # Calculate how many seconds have elapsed since the join time.
        elapsed_time = (now - join_time_dt).total_seconds()
        remaining_time = (mute_kick_time * 3600) - elapsed_time

        # If the remaining time is less than or equal to zero, kick immediately.
        if remaining_time <= 0:
            member = bot.get_member(guild_id, member_id)
            if not member:
                logger.info(f"Member {username} not found in the guild (possibly already left). Removing from tracking.")
                remove_tracked_member(member_id)
                return
            try:
                await member.kick(reason="User did not send a message in time.")
                remove_tracked_member(member_id)
                logger.info(f"Kicked {username} immediately due to bot restart.")
            except Exception as e:
                logger.warning(f"Failed to kick {username} immediately after bot restart: {e}")
            return

        async def delayed_kick():
            # Wait for the remaining time before kicking.
            await asyncio.sleep(remaining_time)
            if get_tracked_member(member_id):
                member = bot.get_member(guild_id, member_id)
                if not member:
                    logger.info(f"Member {username} not found during scheduled kick. Removing from tracking.")
                    remove_tracked_member(member_id)
                    return
                try:
                    await member.kick(reason="User did not send a message in time.")
                    remove_tracked_member(member_id)
                    logger.info(f"Kicked {username} after scheduled time.")
                except Exception as e:
                    logger.warning(f"Failed to kick {username} after scheduled time: {e}")

        asyncio.create_task(delayed_kick())
        logger.debug(f"Scheduled kick for {username} in {remaining_time:.2f} seconds.")

    except Exception as e:
        logger.exception(f"Error scheduling mute mode kick for {username}: {e}")
        
# -------------------------
# Event Listeners
# -------------------------
@interactions.listen()
async def on_ready():
    """
    Event handler triggered when the bot becomes ready.
    Sets presence, initializes reminders, and reschedules pending mute kicks.
    """
    try:
        logger.info("Bot is online! Setting up status and activity.")

        # Set the bot's presence and activity.
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING,
            ),
        )
        logger.debug("Bot presence and activity set.")

        # Initialize default reminders.
        initialize_reminders_table()
        logger.debug("Checking for active reminders.")

        role = get_role()
        if not role:
            logger.warning("No role set for reminders; skipping reminder reschedule.")
        else:
            # Reschedule all known reminders.
            for key in ["disboard", "dsme", "unfocused", "discadia"]:
                logger.debug(f"Attempting to reschedule {key} reminder.")
                await reschedule_reminder(key, role)
                logger.debug(f"Reminder {key} successfully rescheduled.")

        logger.info("Ensuring mute mode and troll mode settings exist...")

        # Set default settings if not present.
        if get_value("mute_mode") is None:
            set_value("mute_mode", False)
        if get_value("mute_mode_kick_time_hours") is None:
            set_value("mute_mode_kick_time_hours", 4)
        if get_value("troll_mode") is None:
            set_value("troll_mode", False)
        if get_value("troll_mode_account_age") is None:
            set_value("troll_mode_account_age", 30)

        mute_mode_enabled = str(get_value("mute_mode")).lower() == "true"
        mute_kick_time = int(get_value("mute_mode_kick_time_hours") or 4)

        if not mute_mode_enabled:
            logger.info("Mute mode is disabled. Skipping rescheduling.")
        else:
            logger.info("Rescheduling mute mode kicks...")

            tracked_users = get_all_tracked_members()
            now = datetime.datetime.now(datetime.UTC)

            for user in tracked_users:
                member_id = user["member_id"]
                username = user["username"]
                join_time = user["join_time"]  # Stored as ISO format
                await schedule_mute_kick(member_id, username, join_time, mute_kick_time, bot.guilds[0].id)

            logger.info("All pending mute mode kicks have been rescheduled.")

        logger.info("All reminders checked and settings verified. Bot is ready!")

    except Exception as e:
        logger.exception(f"An unexpected error occurred during on_ready: {e}")

@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    """
    Event handler triggered on new messages.
    Removes mute tracking for users who send messages and triggers reminders based on message content.
    """
    try:
        logger.debug(f"Message received from {event.message.author.username}")

        # Remove user from mute tracking if they send a message.
        if get_tracked_member(event.message.author.id):
            remove_tracked_member(event.message.author.id)
            logger.debug(f"User {event.message.author.username} sent a message and was removed from mute tracking.")

        # Check if the message is from a known bump bot.
        if str(event.message.author.id) in bot_ids:
            logger.debug(f"Detected message from **{bot_ids[str(event.message.author.id)]}**.")

        # Check for embeds in the message for bump confirmations.
        if event.message.embeds:
            embed = event.message.embeds[0]
            embed_description = embed.description or ""
            logger.debug(f"Embed detected: {embed_description}")
            if "Bump done" in embed_description:
                logger.debug("Triggering Disboard reminder.")
                await disboard()
            elif "Your vote streak for this server" in embed_description:
                logger.debug("Triggering DSME reminder.")
                await dsme()
        else:
            # For plain text messages, check for keywords.
            logger.debug(f"Checking message content: {event.message.content}")
            if "Your server has been booped" in event.message.content:
                logger.debug("Triggering Unfocused reminder.")
                await unfocused()
            elif "has been successfully bumped" in event.message.content:
                logger.debug("Triggering Discadia reminder.")
                await discadia()

    except Exception as e:
        logger.exception(f"Error processing on_message_create event: {e}")

@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    """
    Event handler triggered when a new member joins.
    Applies troll mode (kick if account is too new), mute mode (tracking for kick), and backup mode (welcome message and role assignment).
    """
    try:
        # Retrieve backup mode and troll mode settings.
        assign_role = get_value("backup_mode_enabled") == "true"
        role_id = int(get_value("backup_mode_id") or 0)
        channel_id = int(get_value("backup_mode_channel") or 0)
        kick_users = get_value("troll_mode") == "true"
        kick_users_age_limit = int(get_value("troll_mode_account_age") or 30)
        mute_mode_enabled = str(get_value("mute_mode")).lower() == "true"
        mute_kick_time = int(get_value("mute_mode_kick_time_hours") or 4)

        member = event.member
        guild = event.guild
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at

        logger.debug(f"New member joined: {member.username} in guild {guild.name} | Account Age: {account_age.days} days")

        # Skip mute tracking for bots.
        if member.bot:
            logger.debug(f"Skipping mute tracking for bot {member.username}")
            return

        # Troll mode: kick if account age is below threshold.
        if kick_users and account_age < datetime.timedelta(days=kick_users_age_limit):
            await member.kick(reason="Account is too new!")
            logger.debug(f"Kicked {member.username} for having an account younger than {kick_users_age_limit} days.")
            return

        # Mute mode: track new members for potential kick.
        if mute_mode_enabled:
            join_time = datetime.datetime.now(datetime.UTC).isoformat()
            logger.debug(f"Attempting to track {member.username} for mute mode.")
            try:
                track_new_member(member.id, member.username, join_time)
                logger.debug(f"Successfully tracked {member.username} for mute mode.")
                await schedule_mute_kick(member.id, member.username, join_time, mute_kick_time, guild.id)
            except Exception as e:
                logger.error(f"Failed to track {member.username}: {e}")

        # Backup mode: send welcome message and assign role.
        if not (assign_role and role_id and channel_id):
            logger.debug("Backup mode is not fully configured. Skipping role assignment and welcome message.")
            return

        channel = guild.get_channel(int(channel_id)) if channel_id else None
        if not channel:
            logger.warning(f"Channel with ID {channel_id} not found. Welcome message skipped.")
            return

        embed = interactions.Embed(
            title=f"🎉 Welcome {member.username}!",
            description=(
                "• **How old are you?**\n"
                "• Where are you from?\n"
                "• What do you do in your free time?\n"
                "• What is your address?\n"
                "• What do you do to earn your daily bread in the holy church of our lord and savior Cheesus Driftus?\n"
                "• What's your blood type?\n"
                "• What's your shoe size?\n"
                "• Can we donate your organs to ... \"charity\"?\n"
                "\n"
                "**Please tell us how old you are at least - this is an age restricted server! If you don't send at least one message, you might get automatically kicked.**\n"
            ),
            color=0xCD41FF,
        )
        await channel.send(embeds=[embed])
        logger.debug(f"Sent welcome message in {channel.name} for {member.username}.")

        role_obj = guild.get_role(int(role_id)) if role_id else None
        if role_obj:
            await member.add_role(role_obj)
            logger.debug(f"Assigned role '{role_obj.name}' to {member.username}.")
        else:
            logger.warning(f"Role with ID {role_id} not found in the guild. Role assignment skipped.")

    except Exception as e:
        logger.exception(f"Error during on_member_join event: {e}")

@interactions.listen()
async def on_member_remove(event: interactions.api.events.MemberRemove):
    """
    Event handler triggered when a member leaves the guild.
    Removes the member from the mute tracking database.
    """
    try:
        member = event.member
        guild = event.guild
        logger.debug(f"Member left: {member.username} from Guild {guild.name}. Removing from mute tracking.")
        remove_tracked_member(member.id)
        logger.debug(f"Successfully processed removal for {member.username}.")
    except Exception as e:
        logger.exception(f"Error during on_member_remove event: {e}")

# -------------------------
# Slash Commands
# -------------------------
@interactions.slash_command(name="reminder", description="Setup and check the status of bump and boop reminders.")
@interactions.slash_option(
    name="channel",
    description="Channel to send reminders in (leave empty to check status)",
    required=False,
    opt_type=interactions.OptionType.CHANNEL
)
@interactions.slash_option(
    name="role",
    description="Role to ping in reminders (leave empty to check status)",
    required=False,
    opt_type=interactions.OptionType.ROLE
)
async def reminder(ctx: interactions.ComponentContext, channel=None, role: interactions.Role = None):
    """
    Configure the reminder channel and role or check current reminder status.
    
    :param channel: The channel where reminders will be sent.
    :param role: The role to ping in reminders.
    """
    try:
        if channel and role:
            # Check if the user has administrator permissions.
            if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /reminder setup attempt by {ctx.author.username}")
                await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
                return

            logger.debug(f"⏰ Reminder setup requested by {ctx.author.username}. Channel: {channel.name}, Role: {role.id}")
            
            # Store channel and role settings.
            set_value("reminder_channel", channel.id)
            set_value("role", role.id)
            
            logger.debug("Reminder setup successfully completed.")
            await ctx.send(f"✅ **Reminder setup complete!**\n📢 Reminders will be sent in {channel.name}.\n🎭 The role to be pinged is <@&{role.id}>.")
            return
        
        logger.debug(f"Status check requested by {ctx.author.username}.")

        channel_id = get_value("reminder_channel")
        role_id = get_value("role")

        if channel_id:
            channel_obj = bot.get_channel(channel_id)
            channel_str = channel_obj.name if channel_obj else "Not set!"
        else:
            channel_str = "Not set!"

        role_str = f"<@&{role_id}>" if role_id else "Not set!"

        logger.debug(f"Reminder Channel: {channel_str}")
        logger.debug(f"Reminder Role: {role_str}")

        # Gather status for each reminder.
        reminders_info = []
        for reminder_key in ["disboard", "discadia", "dsme", "unfocused"]:
            data = get_reminder_data(reminder_key)
            time_str = calculate_remaining_time(data.get("scheduled_time")) if data else "Not set!"
            reminders_info.append(f"⏳ **{reminder_key.capitalize()}**: {time_str}")
            logger.debug(f"Reminder {reminder_key}: {time_str}")

        summary = (
            f"📌 **Reminder Status:**\n"
            f"📢 **Channel:** {channel_str}\n"
            f"🎭 **Role:** {role_str}\n\n"
            + "\n".join(reminders_info)
        )

        await ctx.send(summary)
    
    except Exception as e:
        logger.exception(f"Error in /reminder command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request. Please try again later.", ephemeral=True)

@interactions.slash_command(
    name="fix",
    description="Runs the logic to add service data to the database under the key name of 'fix'."
)
@interactions.slash_option(
    name="service",
    description="Service to generate fix for in the database",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def fix_command(ctx: interactions.ComponentContext, service: str):
    """
    Execute fix logic for a specified service, updating reminder data.
    
    :param service: The service name (e.g., disboard, dsme, unfocused, discadia).
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /fix attempt by {ctx.author.username}")
        return

    try:
        await ctx.defer()
        logger.debug(f"Received /fix command from {ctx.author.username} for service: {service}")

        service_delays = {
            "disboard": 7200,  # 2 hours
            "dsme": 43200,     # 12 hours
            "unfocused": 30600,  # ~6 hours 50 minutes
            "discadia": 43200   # 12 hours
        }

        if service not in service_delays:
            logger.warning(f"Invalid service name provided: {service}")
            await ctx.send("⚠️ Invalid service name provided. Please use one of: **disboard, dsme, unfocused, discadia**.", ephemeral=True)
            return

        seconds = service_delays[service]
        logger.debug(f"Service '{service}' selected with a delay of {seconds} seconds.")

        reminder_id = str(uuid.uuid4())

        reminder_data = {
            "state": True,
            "scheduled_time": (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=seconds)).isoformat(),
            "reminder_id": reminder_id
        }

        set_reminder_data(service, True, (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=seconds)).isoformat(), reminder_id)
        logger.debug(f"Fix logic applied: {reminder_data}")
        await ctx.send(f"✅ Fix logic successfully applied for **{service}**!")

    except Exception as e:
        logger.exception(f"Error in /fix command: {e}")
        await ctx.send("⚠️ An error occurred while applying fix logic. Please try again later.", ephemeral=True)

@interactions.slash_command(name="resetreminders", description="Reset all reminders in the database to default values.")
async def reset_reminders(ctx: interactions.ComponentContext):
    """
    Reset all reminders in the 'reminders' table to their default (inactive) state.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /resetreminders attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        logger.debug(f"Received /resetreminders command from {ctx.author.username}")
        await ctx.defer()

        reminder_keys = ["disboard", "dsme", "unfocused", "discadia"]
        for key in reminder_keys:
            set_reminder_data(key, False, None, None)
            logger.debug(f"Reset reminder data for key: {key}")

        logger.debug("All reminders successfully reset.")
        await ctx.send("✅ All reminders have been reset to default values.")
    except Exception as e:
        logger.exception(f"Error in /resetreminders command: {e}")
        await ctx.send("⚠️ An error occurred while resetting reminders. Please try again later.", ephemeral=True)

@interactions.slash_command(
    name="mutemode",
    description="Toggle auto-kicking of users who don't send a message within a time limit."
)
@interactions.slash_option(
    name="enabled",
    description="Enable or disable mute mode",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
@interactions.slash_option(
    name="time",
    description="Time limit in hours before a silent user is kicked (Default: 2)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def toggle_mute_mode(ctx: interactions.ComponentContext, enabled: bool, time: int = 2):
    """
    Toggle the mute mode setting and set the kick time threshold.
    
    :param enabled: True to enable mute mode, False to disable.
    :param time: Time in hours before a silent user is kicked.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /mutemode attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        logger.debug(f"Received /mutemode command from {ctx.author.username}")
        logger.debug(f"Mute mode toggle: {'Enabled' if enabled else 'Disabled'}, Kick Time: {time} hours")

        set_value("mute_mode", enabled)
        set_value("mute_mode_kick_time_hours", time)

        response_message = (
            f"🔇 Mute mode has been ✅ **enabled**. New users must send a message within **{time}** hours or be kicked."
            if enabled else "🔇 Mute mode has been ❌ **disabled**."
        )

        await ctx.send(response_message)
        logger.debug(f"Mute mode {'enabled' if enabled else 'disabled'} by {ctx.author.username}, kick time set to {time} hours.")

    except Exception as e:
        logger.exception(f"Error in /mutemode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling mute mode. Please try again later.", ephemeral=True)

@interactions.slash_command(name="testmessage", description="Send a test message to the reminder channel.")
async def test_reminders(ctx: interactions.ComponentContext):
    """
    Send a test reminder message to verify the reminder channel and role setup.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /testmessage attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        logger.debug(f"Test message requested by {ctx.author.username}.")

        role_id = get_value("role")
        if not role_id:
            logger.warning("No role has been set up for reminders.")
            await ctx.send("⚠️ No role has been set up for reminders.", ephemeral=True)
            return

        logger.debug("Test reminder message successfully sent.")
        await ctx.send(f"🔔 <@&{role_id}> This is a test reminder message!")

    except Exception as e:
        logger.exception(f"Error in /testmessage command: {e}")
        await ctx.send("⚠️ Could not send test message. Please try again later.", ephemeral=True)

@interactions.slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: interactions.ComponentContext):
    """
    A placeholder command for developer maintenance tasks.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /dev attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        logger.debug(f"Developer tag maintenance requested by {ctx.author.username}.")
        # Developer maintenance logic would go here.
        logger.debug("Developer tag maintenance completed.")
        await ctx.send("🛠️ Developer tag maintained!")
    except Exception as e:
        logger.exception(f"Error in /dev command: {e}")
        await ctx.send("⚠️ An error occurred while maintaining the developer tag. Please try again later.", ephemeral=True)

@interactions.slash_command(name="source", description="Get links for the bot's resources.")
async def source(ctx: interactions.ComponentContext):
    """
    Send an embed containing links to the bot's GitHub repository and Supabase dashboard.
    """
    try:
        logger.debug(f"Received /source command from {ctx.author.username}")

        embed = interactions.Embed(
            title="📜 **Bot Resources**",
            description="Here are the links for the bot's resources:",
            color=0x00ff00,
        )
        embed.add_field(name="🖥️ GitHub Repository", value="[🔗 Click Here](https://github.com/doubleangels/Nova)", inline=False)
        embed.add_field(
            name="🗄️ Supabase Database",
            value="[🔗 Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)",
            inline=False
        )

        logger.debug(f"Successfully sent bot resources embed to {ctx.author.username}.")
        await ctx.send(embeds=[embed])
    except Exception as e:
        logger.exception(f"Error in /source command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request.", ephemeral=True)

@interactions.slash_command(name="backupmode", description="Configure and toggle backup mode for new members.")
@interactions.slash_option(
    name="channel",
    description="Channel to send welcome messages for new members (leave empty to check status)",
    required=False,
    opt_type=interactions.OptionType.CHANNEL
)
@interactions.slash_option(
    name="role",
    description="Role to assign to new members (leave empty to check status)",
    required=False,
    opt_type=interactions.OptionType.ROLE
)
@interactions.slash_option(
    name="enabled",
    description="Enable (true) or Disable (false) auto-role assignment (leave empty to check status)",
    required=False,
    opt_type=interactions.OptionType.BOOLEAN
)
async def backup_mode(ctx: interactions.ComponentContext, channel=None, role: interactions.Role = None, enabled: bool = None):
    """
    Configure backup mode settings (channel, role, and toggle) or display current settings.
    
    :param channel: Channel for welcome messages.
    :param role: Role to assign to new members.
    :param enabled: Toggle auto-role assignment.
    """
    try:
        if channel or role or enabled is not None:
            if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /backupmode setup attempt by {ctx.author.username}")
                await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
                return
            
            logger.debug(f"Received /backupmode command from {ctx.author.username}")
            
            if channel:
                set_value("backup_mode_channel", channel.id)
                logger.debug(f"Backup mode channel set to {channel.name}")
            
            if role:
                set_value("backup_mode_id", role.id)
                logger.debug(f"Backup mode role set to {role.id}")
            
            if enabled is not None:
                set_value("backup_mode_enabled", enabled)
                logger.debug(f"Backup mode {'enabled' if enabled else 'disabled'}")
            
            await ctx.send(
                f"🔄 **Backup Mode Configured!**\n"
                f"📢 Welcome messages will be sent in {channel.name if channel else 'Not changed'}\n"
                f"🎭 New members will be assigned the role: {f'<@&{role.id}>' if role else 'Not changed'}\n"
                f"🔘 Auto-role assignment: {'✅ **Enabled**' if enabled else '❌ **Disabled**' if enabled is not None else 'Not changed'}"
            )
            return
        
        logger.debug(f"Backup mode status check requested by {ctx.author.username}")

        channel_id = get_value("backup_mode_channel")
        role_id = get_value("backup_mode_id")
        enabled_status = get_value("backup_mode_enabled")

        if channel_id:
            channel_obj = ctx.guild.get_channel(channel_id)
            channel_str = channel_obj.name if channel_obj else "Not set!"
        else:
            channel_str = "Not set!"
        role_str = f"<@&{role_id}>" if role_id else "Not set!"
        enabled_str = "✅ **Enabled**" if enabled_status else "❌ **Disabled**"

        summary = (
            f"📌 **Backup Mode Status:**\n"
            f"📢 **Channel:** {channel_str}\n"
            f"🎭 **Role:** {role_str}\n"
            f"🔘 **Auto-role assignment:** {enabled_str}"
        )

        await ctx.send(summary)
        logger.debug("Backup mode status check completed successfully.")
    
    except Exception as e:
        logger.exception(f"Error in /backupmode command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request. Please try again later.", ephemeral=True)

@interactions.slash_command(name="trollmode", description="Toggle kicking of accounts younger than a specified age.")
@interactions.slash_option(
    name="enabled",
    description="Enable or disable troll mode",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
@interactions.slash_option(
    name="age",
    description="Minimum account age in days (Default: 30)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def toggle_troll_mode(ctx: interactions.ComponentContext, enabled: bool, age: int = 30):
    """
    Toggle troll mode to kick new accounts below a specified age.
    
    :param enabled: True to enable troll mode.
    :param age: Minimum account age in days required.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /trollmode attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        logger.debug(f"Received /trollmode command from {ctx.author.username}")
        logger.debug(f"Troll mode toggle: {'Enabled' if enabled else 'Disabled'}, Minimum age: {age} days")

        set_value("troll_mode", enabled)
        set_value("troll_mode_account_age", age)

        response_message = (
            f"👹 Troll mode has been ✅ **enabled**. Minimum account age: **{age}** days."
            if enabled else "👹 Troll mode has been ❌ **disabled**."
        )

        logger.debug(f"Troll mode {'enabled' if enabled else 'disabled'} by {ctx.author.username}; account age threshold={age} days.")
        await ctx.send(response_message)

    except Exception as e:
        logger.exception(f"Error in /trollmode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling troll mode. Please try again later.", ephemeral=True)

# -------------------------
# Search / AI Commands
# -------------------------
@interactions.slash_command(name="google", description="Search Google and return the top results.")
@interactions.slash_option(
    name="query",
    description="What do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
@interactions.slash_option(
    name="results",
    description="How many results do you want? (1-10)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def google_search(ctx: interactions.ComponentContext, query: str, results: int = 1):
    """
    Search Google for text results using the Google Custom Search API.
    
    :param query: The search query.
    :param results: Number of results to return (1-10).
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /google command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}', requested results: {results}")

        formatted_query = query.title()
        results = max(1, min(results, 10))
        logger.debug(f"Formatted query: '{formatted_query}', adjusted results: {results}")

        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": SEARCH_ENGINE_ID,
            "q": query,
            "num": results
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received Google Search data: {json.dumps(data, indent=2)}")
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title Found")
                            link = item.get("link", "No Link Found")
                            snippet = item.get("snippet", "No Description Found")
                            logger.debug(f"Extracted Google Search Result - Title: {title}, Link: {link}")
                            embed = interactions.Embed(
                                title=f"🔍 **{title}**",
                                description=f"📜 **Summary:** {snippet}\n🔗 [Read More]({link})",
                                color=0x1A73E8
                            )
                            embed.set_footer(text="Powered by Google Search")
                            embeds.append(embed)
                        if embeds:
                            await ctx.send(embeds=embeds)
                        else:
                            logger.warning(f"No search results found for query: '{formatted_query}'.")
                            await ctx.send(f"❌ No search results found for '**{formatted_query}**'. Try refining your query!")
                    else:
                        logger.warning(f"No search results found for query: '{formatted_query}'.")
                        await ctx.send(f"❌ No search results found for '**{formatted_query}**'. Try refining your search!")
                else:
                    logger.warning(f"Google API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Google API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /google command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="googleimage", description="Search Google for images and return the top results.")
@interactions.slash_option(
    name="query",
    description="What images do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
@interactions.slash_option(
    name="results",
    description="How many results do you want? (1-10)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def google_image_search(ctx: interactions.ComponentContext, query: str, results: int = 1):
    """
    Search Google Images using the Google Custom Search API (Image mode).
    
    :param query: The image search query.
    :param results: Number of image results to return (1-10).
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /googleimage command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}', requested results: {results}")

        formatted_query = query.title()
        results = max(1, min(results, 10))
        logger.debug(f"Formatted query: '{formatted_query}', adjusted results: {results}")

        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": IMAGE_SEARCH_ENGINE_ID,
            "q": query,
            "searchType": "image",
            "num": results
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received Google Image data: {json.dumps(data, indent=2)}")
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title")
                            image_link = item.get("link", "")
                            page_link = item.get("image", {}).get("contextLink", image_link)
                            logger.debug(f"Extracted Image - Title: {title}, Image Link: {image_link}")
                            embed = interactions.Embed(
                                title=f"🖼️ **{title}**",
                                description=f"🔗 **[View Image]({image_link})**",
                                color=0x1A73E8
                            )
                            embed.set_image(url=image_link)
                            embed.set_footer(text="Powered by Google Image Search")
                            embeds.append(embed)
                        if embeds:
                            await ctx.send(embeds=embeds)
                        else:
                            logger.warning(f"No images found for query: '{formatted_query}'.")
                            await ctx.send(f"❌ No images found for '**{formatted_query}**'. Try refining your query!")
                    else:
                        logger.warning(f"No image results found for query: '{formatted_query}'.")
                        await ctx.send(f"❌ No image results found for '**{formatted_query}**'. Try refining your search!")
                else:
                    logger.warning(f"Google API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Google API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /googleimage command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="youtube", description="Search YouTube for videos and return the top result.")
@interactions.slash_option(
    name="query",
    description="What videos do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def youtube_video_search(ctx: interactions.ComponentContext, query: str):
    """
    Search YouTube for videos using the YouTube Data API.
    
    :param query: The search query.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /youtube command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}'")

        formatted_query = query.title()
        logger.debug(f"Formatted query: '{formatted_query}'")

        search_url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            "key": GOOGLE_API_KEY,
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": 1
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received YouTube data: {json.dumps(data, indent=2)}")
                    if "items" in data and data["items"]:
                        item = data["items"][0]
                        video_id = item["id"].get("videoId", "")
                        snippet = item["snippet"]
                        title = snippet.get("title", "No Title")
                        description = snippet.get("description", "No Description")
                        thumbnail = snippet.get("thumbnails", {}).get("high", {}).get("url", "")
                        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else "N/A"
                        logger.debug(f"Extracted YouTube Video - Title: {title}, Video ID: {video_id}")
                        embed = interactions.Embed(
                            title=f"🎬 **{title}**",
                            description=f"📜 **Description:** {description}",
                            url=video_url,
                            color=0xFF0000
                        )
                        embed.add_field(name="🔗 Watch on YouTube", value=f"[Click Here]({video_url})", inline=False)
                        if thumbnail:
                            embed.set_thumbnail(url=thumbnail)
                        embed.set_footer(text="Powered by YouTube Data API")
                        await ctx.send(embed=embed)
                    else:
                        logger.warning(f"No video results found for query: '{formatted_query}'.")
                        await ctx.send(f"❌ No video results found for '**{formatted_query}**'. Try another search!")
                else:
                    logger.warning(f"YouTube API error: {response.status}")
                    await ctx.send(f"⚠️ Error: YouTube API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /youtube command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="wikipedia", description="Search Wikipedia for articles and return the top result.")
@interactions.slash_option(
    name="query",
    description="What topic do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def wikipedia_search(ctx: interactions.ComponentContext, query: str):
    """
    Search Wikipedia for an article using the Wikipedia API.
    
    :param query: The topic to search for.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /wikipedia command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}'")

        formatted_query = query.title()
        logger.debug(f"Formatted query: '{formatted_query}'")

        search_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": query,
            "utf8": 1
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received Wikipedia data: {json.dumps(data, indent=2)}")
                    if data.get("query", {}).get("search"):
                        top_result = data["query"]["search"][0]
                        title = top_result.get("title", "No Title")
                        snippet = top_result.get("snippet", "No snippet available.")
                        snippet = snippet.replace("<span class=\"searchmatch\">", "**").replace("</span>", "**")
                        page_id = top_result.get("pageid")
                        wiki_url = f"https://en.wikipedia.org/?curid={page_id}"
                        logger.debug(f"Extracted Wikipedia Data - Title: {title}, Page ID: {page_id}")
                        embed = interactions.Embed(
                            title=f"📖 **{title}**",
                            description=f"📜 **Summary:** {snippet}",
                            url=wiki_url,
                            color=0xFFFFFF
                        )
                        embed.add_field(name="🔗 Wikipedia Link", value=f"[Click Here]({wiki_url})", inline=False)
                        embed.set_footer(text="Powered by Wikipedia API")
                        await ctx.send(embed=embed)
                    else:
                        logger.warning(f"No results found for query: '{formatted_query}'.")
                        await ctx.send(f"❌ No results found for '**{formatted_query}**'. Try refining your search!")
                else:
                    logger.warning(f"Wikipedia API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Wikipedia API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /wikipedia command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="imdb", description="Search for a movie or TV show on IMDB.")
@interactions.slash_option(
    name="title",
    description="Enter the movie or TV show title.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def imdb_search(ctx: interactions.ComponentContext, title: str):
    """
    Search for movie or TV show information using the OMDb API.
    
    :param title: The title to search for.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /imdb command from {ctx.author.username}")
        logger.debug(f"User input for title: '{title}'")

        formatted_title = title.title()
        logger.debug(f"Formatted title: '{formatted_title}'")

        search_url = "http://www.omdbapi.com/"
        params = {"t": title, "apikey": OMDB_API_KEY}
        logger.debug(f"Making API request to: {search_url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received IMDb data: {json.dumps(data, indent=2)}")
                    if data.get("Response") == "True":
                        title = data.get("Title", "Unknown")
                        year = data.get("Year", "Unknown")
                        genre = data.get("Genre", "Unknown")
                        imdb_rating = data.get("imdbRating", "N/A")
                        plot = data.get("Plot", "No plot available.")
                        poster = data.get("Poster", None)
                        imdb_id = data.get("imdbID", None)
                        imdb_link = f"https://www.imdb.com/title/{imdb_id}" if imdb_id else "N/A"
                        logger.debug(f"Extracted IMDb Data - Title: {title}, Year: {year}, Genre: {genre}, IMDb Rating: {imdb_rating}")
                        embed = interactions.Embed(
                            title=f"🎬 **{title} ({year})**",
                            description=f"📜 **Plot:** {plot}",
                            color=0xFFD700
                        )
                        embed.add_field(name="🎭 Genre", value=f"🎞 {genre}", inline=True)
                        embed.add_field(name="⭐ IMDB Rating", value=f"🌟 {imdb_rating}", inline=True)
                        embed.add_field(name="🔗 IMDB Link", value=f"[Click Here]({imdb_link})", inline=False)
                        if poster and poster != "N/A":
                            embed.set_thumbnail(url=poster)
                        embed.set_footer(text="Powered by OMDb API")
                        await ctx.send(embed=embed)
                    else:
                        logger.warning(f"No results found for title: '{formatted_title}'.")
                        await ctx.send(f"❌ No results found for '**{formatted_title}**'. Try another title!")
                else:
                    logger.warning(f"OMDb API error: {response.status}")
                    await ctx.send(f"⚠️ Error: OMDb API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /imdb command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="define", description="Get the definition and synonyms of a word.")
@interactions.slash_option(
    name="word",
    description="Enter the word you want to look up.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def dictionary_search(ctx: interactions.ComponentContext, word: str):
    """
    Search for the definition and synonyms of a word using the Free Dictionary API.
    
    :param word: The word to define.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /define command from {ctx.author.username}")
        logger.debug(f"User input for word: '{word}'")

        word = word.lower()
        logger.debug(f"Formatted word: '{word}'")

        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        logger.debug(f"Making API request to: {url}")

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received dictionary data: {json.dumps(data, indent=2)}")
                    if isinstance(data, list) and data:
                        entry = data[0]
                        meanings = entry.get("meanings", [])
                        if meanings:
                            definitions = meanings[0].get("definitions", [])
                            definition_text = definitions[0].get("definition", "No definition found.") if definitions else "No definition available."
                            synonyms = meanings[0].get("synonyms", [])
                            synonyms_text = ", ".join(synonyms[:5]) if synonyms else "No synonyms available."
                            logger.debug(f"Extracted definition: {definition_text}")
                            logger.debug(f"Extracted synonyms: {synonyms_text}")
                            embed = interactions.Embed(
                                title=f"📖 Definition of **{word.capitalize()}**",
                                description=f"📜 **Definition:** {definition_text}",
                                color=0xD3D3D3
                            )
                            embed.add_field(name="🟢 Synonyms", value=f"📌 {synonyms_text}", inline=False)
                            embed.set_footer(text="Powered by Free Dictionary API")
                            await ctx.send(embed=embed)
                        else:
                            logger.warning(f"No definitions found for '{word}'.")
                            await ctx.send(f"❌ No definition found for '**{word}**'.")
                    else:
                        logger.warning(f"API returned empty response for '{word}'.")
                        await ctx.send(f"❌ No definition found for '**{word}**'.")
                else:
                    logger.warning(f"Dictionary API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Dictionary API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /define command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="weather", description="Get the current weather for a place.")
@interactions.slash_option(
    name="place",
    description="Enter the place name.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def weather_search(ctx: interactions.ComponentContext, place: str):
    """
    Fetch the current weather and 3-day forecast using PirateWeather API.
    
    :param city: The city name.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received weather command from {ctx.author.username}")
        logger.debug(f"User input for city: '{place}'")

        lat, lon = await get_coordinates(place)
        if lat is None or lon is None:
            logger.warning(f"Failed to get coordinates for '{place}'.")
            await ctx.send(f"Could not find the location for '{place}'. Try another city.")
            return
        
        place = place.title()
        logger.debug(f"Formatted city name: '{place}' (Lat: {lat}, Lon: {lon})")

        url = f"https://api.pirateweather.net/forecast/{PIRATEWEATHER_API_KEY}/{lat},{lon}"
        params = {"units": "si"}
        logger.debug(f"Making API request to: {url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received weather data: {json.dumps(data, indent=2)}")
                    currently = data["currently"]
                    daily = data["daily"]["data"]
                    weather = currently.get("summary", "Unknown")
                    temp_c = currently.get("temperature", 0)
                    temp_f = round((temp_c * 9/5) + 32, 1)
                    feels_like_c = currently.get("apparentTemperature", 0)
                    feels_like_f = round((feels_like_c * 9/5) + 32, 1)
                    humidity = currently.get("humidity", 0) * 100
                    wind_speed = currently.get("windSpeed", 0)
                    uv_index = currently.get("uvIndex", "N/A")
                    visibility = currently.get("visibility", "N/A")
                    pressure = currently.get("pressure", "N/A")
                    dew_point_c = currently.get("dewPoint", "N/A")
                    dew_point_f = round((dew_point_c * 9/5) + 32, 1) if isinstance(dew_point_c, (int, float)) else "N/A"
                    cloud_cover = currently.get("cloudCover", 0) * 100
                    precip_intensity = currently.get("precipIntensity", 0)
                    precip_prob = currently.get("precipProbability", 0) * 100

                    forecast_text = ""
                    for i in range(3):
                        day = daily[i]
                        day_summary = day.get("summary", "No data")
                        high_c = day.get("temperatureHigh", "N/A")
                        high_f = round((high_c * 9/5) + 32, 1) if isinstance(high_c, (int, float)) else "N/A"
                        low_c = day.get("temperatureLow", "N/A")
                        low_f = round((low_c * 9/5) + 32, 1) if isinstance(low_c, (int, float)) else "N/A"
                        forecast_text += f"**Day {i+1}:** {day_summary}\n🌡 High: {high_c}°C / {high_f}°F, Low: {low_c}°C / {low_f}°F\n\n"

                    logger.debug(f"Extracted weather data for {place}: Temp {temp_c}°C, Feels Like {feels_like_c}°C, Humidity {humidity}%")
                    embed = interactions.Embed(
                        title=f"Weather in {place}",
                        description=f"**{weather}**",
                        color=0xFF6E42
                    )
                    embed.add_field(name="🌍 Location", value=f"📍 {place}\n📍 Lat: {lat}, Lon: {lon}", inline=False)
                    embed.add_field(name="🌡 Temperature", value=f"{temp_c}°C / {temp_f}°F", inline=True)
                    embed.add_field(name="🤔 Feels Like", value=f"{feels_like_c}°C / {feels_like_f}°F", inline=True)
                    embed.add_field(name="💧 Humidity", value=f"{humidity}%", inline=True)
                    embed.add_field(name="💨 Wind Speed", value=f"{wind_speed} m/s", inline=True)
                    embed.add_field(name="🌞 UV Index", value=f"{uv_index}", inline=True)
                    embed.add_field(name="👀 Visibility", value=f"{visibility} km", inline=True)
                    embed.add_field(name="🛰 Pressure", value=f"{pressure} hPa", inline=True)
                    embed.add_field(name="🌫 Dew Point", value=f"{dew_point_c}°C / {dew_point_f}°F", inline=True)
                    embed.add_field(name="☁ Cloud Cover", value=f"{cloud_cover}%", inline=True)
                    embed.add_field(name="🌧 Precipitation", value=f"{precip_intensity} mm/hr", inline=True)
                    embed.add_field(name="🌧 Precip. Probability", value=f"{precip_prob}%", inline=True)
                    embed.add_field(name="📅 3-Day Forecast", value=forecast_text, inline=False)
                    embed.set_footer(text="Powered by PirateWeather")
                    await ctx.send(embed=embed)
                else:
                    logger.warning(f"PirateWeather API error: {response.status}")
                    await ctx.send(f"Error: PirateWeather API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /weather command: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="urban", description="Search Urban Dictionary for definitions.")
@interactions.slash_option(
    name="query",
    description="What term do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def urban_dictionary_search(ctx: interactions.ComponentContext, query: str):
    """
    Search Urban Dictionary for a term and return the top definition.
    
    :param query: The search term.
    """
    try:
        logger.debug(f"User '{ctx.author.username}' searched for '{query}' on Urban Dictionary.")
        await ctx.defer()
        search_url = "https://api.urbandictionary.com/v0/define"
        params = {"term": query}
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("list"):
                        top_result = data["list"][0]
                        word = top_result.get("word", "No Word")
                        definition = top_result.get("definition", "No Definition Available.").replace("\r\n", "\n")
                        example = top_result.get("example", "").replace("\r\n", "\n") or "No example available."
                        thumbs_up = top_result.get("thumbs_up", 0)
                        thumbs_down = top_result.get("thumbs_down", 0)
                        logger.debug(f"Found definition for '{word}': {definition} ({thumbs_up}/{thumbs_down})")
                        embed = interactions.Embed(
                            title=f"📖 Definition: {word}",
                            description=definition,
                            color=0x1D2439
                        )
                        embed.add_field(name="📝 Example", value=example, inline=False)
                        embed.add_field(name="👍 Thumbs Up", value=str(thumbs_up), inline=True)
                        embed.add_field(name="👎 Thumbs Down", value=str(thumbs_down), inline=True)
                        embed.set_footer(text="🔍 Powered by Urban Dictionary")
                        await ctx.send(embed=embed)
                    else:
                        logger.debug(f"No definitions found for '{query}'.")
                        await ctx.send("⚠️ No definitions found for your query. Try refining it.")
                else:
                    logger.warning(f"Urban Dictionary API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Urban Dictionary API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /urban command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="mal", description="Search for an anime on MyAnimeList.")
@interactions.slash_option(
    name="title",
    description="Enter the anime title.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def mal_search(ctx: interactions.ComponentContext, title: str):
    """
    Search for an anime using the MyAnimeList API.
    
    :param title: The anime title to search for.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /mal command from {ctx.author.username}")
        logger.debug(f"User input for title: '{title}'")
        formatted_title = title.title()
        logger.debug(f"Formatted title: '{formatted_title}'")
        search_url = f"https://api.myanimelist.net/v2/anime?q={title}&limit=1"
        headers = {"X-MAL-CLIENT-ID": MAL_CLIENT_ID}
        logger.debug(f"Making API request to: {search_url} with headers {headers}")
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, headers=headers) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received MAL data: {data}")
                    if "data" in data and data["data"]:
                        anime = data["data"][0]["node"]
                        anime_id = anime.get("id", None)
                        title = anime.get("title", "Unknown")
                        image_url = anime.get("main_picture", {}).get("medium", None)
                        mal_link = f"https://myanimelist.net/anime/{anime_id}" if anime_id else "N/A"
                        details_url = f"https://api.myanimelist.net/v2/anime/{anime_id}?fields=id,title,synopsis,mean,genres,start_date"
                        async with session.get(details_url, headers=headers) as details_response:
                            if details_response.status == 200:
                                details_data = await details_response.json()
                                synopsis = details_data.get("synopsis", "No synopsis available.")
                                rating = details_data.get("mean", "N/A")
                                genres = ", ".join([g["name"] for g in details_data.get("genres", [])]) or "Unknown"
                                release_date = details_data.get("start_date", "Unknown")
                                logger.debug(f"Extracted MAL Data - Title: {title}, Rating: {rating}, Genres: {genres}")
                                embed = interactions.Embed(
                                    title=f"📺 **{title}**",
                                    description=f"📜 **Synopsis:** {synopsis}",
                                    color=0x2E51A2
                                )
                                embed.add_field(name="🎭 Genre", value=f"🎞 {genres}", inline=True)
                                embed.add_field(name="⭐ MAL Rating", value=f"🌟 {rating}", inline=True)
                                embed.add_field(name="📅 Release Date", value=f"📆 {release_date}", inline=True)
                                embed.add_field(name="🔗 MAL Link", value=f"[Click Here]({mal_link})", inline=False)
                                if image_url:
                                    embed.set_thumbnail(url=image_url)
                                embed.set_footer(text="Powered by MyAnimeList API")
                                await ctx.send(embed=embed)
                            else:
                                logger.warning(f"Error fetching extra details from MAL: {details_response.status}")
                                await ctx.send("⚠️ Error fetching additional anime details. Please try again later.")
                    else:
                        logger.warning(f"No results found for title: '{formatted_title}'.")
                        await ctx.send(f"❌ No anime found for '**{formatted_title}**'. Try another title!")
                else:
                    logger.warning(f"MyAnimeList API error: {response.status}")
                    await ctx.send(f"⚠️ Error: MAL API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /mal command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="cat", description="Get a random cat picture!")
async def cat_image(ctx: interactions.ComponentContext):
    """
    Fetch and send a random cat image using the Cataas API.
    """
    try:
        await ctx.defer()
        # Append a timestamp to avoid caching issues.
        cat_api_url = f"https://cataas.com/cat?timestamp={int(time.time())}"
        logger.debug(f"Fetching cat image from {cat_api_url}")
        async with aiohttp.ClientSession() as session:
            async with session.get(cat_api_url) as response:
                if response.status == 200:
                    image_bytes = await response.read()
                    file_obj = io.BytesIO(image_bytes)
                    file_obj.seek(0)
                    filename = "cat.jpg"
                    file = interactions.File(file_name=filename, file=file_obj)
                    embed = interactions.Embed(
                        title="Random Cat Picture",
                        description="😺 Here's a cat for you!",
                        color=0xD3D3D3
                    )
                    embed.set_image(url=f"attachment://{filename}")
                    embed.set_footer(text="Powered by Cataas API")
                    await ctx.send(embeds=[embed], files=[file])
                else:
                    logger.warning(f"Cataas API error: {response.status}")
                    await ctx.send("😿 Couldn't fetch a cat picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /cat command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="dog", description="Get a random dog picture!")
async def dog_image(ctx: interactions.ComponentContext):
    """
    Fetch and send a random dog image using the Dog CEO API.
    """
    try:
        await ctx.defer()
        dog_api_url = "https://dog.ceo/api/breeds/image/random"
        logger.debug(f"Fetching random dog image data from {dog_api_url}")
        async with aiohttp.ClientSession() as session:
            async with session.get(dog_api_url) as response:
                if response.status == 200:
                    data = await response.json()
                    image_url = data.get("message", None)
                    if image_url:
                        image_url_with_timestamp = f"{image_url}?timestamp={int(time.time())}"
                        logger.debug(f"Fetching dog image from {image_url_with_timestamp}")
                        async with session.get(image_url_with_timestamp) as image_response:
                            if image_response.status == 200:
                                image_bytes = await image_response.read()
                                file_obj = io.BytesIO(image_bytes)
                                file_obj.seek(0)
                                filename = "dog.jpg"
                                file = interactions.File(file_name=filename, file=file_obj)
                                embed = interactions.Embed(
                                    title="Random Dog Picture",
                                    description="🐶 Here's a doggo for you!",
                                    color=0xD3D3D3
                                )
                                embed.set_image(url=f"attachment://{filename}")
                                embed.set_footer(text="Powered by Dog CEO API")
                                await ctx.send(embeds=[embed], files=[file])
                            else:
                                logger.warning(f"Error fetching dog image file: {image_response.status}")
                                await ctx.send("🐶 Couldn't fetch a dog picture. Try again later.")
                    else:
                        await ctx.send("🐶 Couldn't find a dog picture. Try again later.")
                else:
                    logger.warning(f"Dog CEO API error: {response.status}")
                    await ctx.send("🐕 Couldn't fetch a dog picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /dog command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="timezone", description="Get the current time in a city.")
@interactions.slash_option(
    name="place",
    description="Enter a place name (e.g., New York, Germany).",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def timezone_lookup(ctx: interactions.ComponentContext, place: str):
    """
    Fetch and display the current time for a specified city using Google Maps Time Zone API.
    
    :param city: The city name.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /timezone command for city: '{place}'")
        async with aiohttp.ClientSession() as session:
            geocode_url = f"https://maps.googleapis.com/maps/api/geocode/json"
            geocode_params = {"address": place, "key": GOOGLE_API_KEY}
            async with session.get(geocode_url, params=geocode_params) as response:
                if response.status == 200:
                    geo_data = await response.json()
                    logger.debug(f"Received Google Geocoding API response: {json.dumps(geo_data, indent=2)}")
                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        await ctx.send(f"❌ Could not find the city '{place}'. Check spelling.")
                        return
                else:
                    await ctx.send(f"⚠️ Google Geocoding API error. Try again later.")
                    return
            timestamp = int(datetime.datetime.now().timestamp())
            timezone_url = f"https://maps.googleapis.com/maps/api/timezone/json"
            timezone_params = {"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}
            async with session.get(timezone_url, params=timezone_params) as response:
                if response.status == 200:
                    tz_data = await response.json()
                    logger.debug(f"Received Google Time Zone API response: {json.dumps(tz_data, indent=2)}")
                    if tz_data.get("status") == "OK":
                        timezone_name = tz_data["timeZoneId"]
                        raw_offset = tz_data["rawOffset"] / 3600
                        dst_offset = tz_data["dstOffset"] / 3600
                        utc_offset = raw_offset + dst_offset
                        is_dst = "Yes" if dst_offset > 0 else "No"
                        current_utc_time = datetime.datetime.now(datetime.timezone.utc)
                        local_time = current_utc_time + datetime.timedelta(hours=utc_offset)
                        formatted_time = local_time.strftime("%Y-%m-%d %H:%M:%S")
                        embed = interactions.Embed(
                            title=f"🕒 Current Time in {place}",
                            description=f"⏰ **{formatted_time}** (UTC {utc_offset:+})",
                            color=0x1D4ED8
                        )
                        embed.add_field(name="🌍 Timezone", value=timezone_name, inline=True)
                        embed.add_field(name="🕰️ UTC Offset", value=f"UTC {utc_offset:+}", inline=True)
                        embed.add_field(name="🌞 Daylight Savings", value=is_dst, inline=True)
                        embed.set_footer(text="Powered by Google Maps Time Zone API")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ Error retrieving timezone info for '{place}'.")
                else:
                    await ctx.send(f"⚠️ Google Time Zone API error. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /timezone command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="timedifference", description="Get the time difference between two places.")
@interactions.slash_option(
    name="place1",
    description="Enter the first city name (e.g., New York).",
    required=True,
    opt_type=interactions.OptionType.STRING
)
@interactions.slash_option(
    name="place2",
    description="Enter the second city name (e.g., London).",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def time_difference(ctx: interactions.ComponentContext, place1: str, place2: str):
    """
    Calculate the time difference between two cities using Google Maps Time Zone API.
    
    :param place1: The first city.
    :param place2: The second city.
    """
    try:
        await ctx.defer()
        logger.debug(f"Received /timedifference command: '{place1}' and '{place2}'")

        async def get_utc_offset(city):
            """
            Helper function to get UTC offset for a given city.
            """
            geocode_url = f"https://maps.googleapis.com/maps/api/geocode/json"
            timezone_url = f"https://maps.googleapis.com/maps/api/timezone/json"
            async with aiohttp.ClientSession() as session:
                async with session.get(geocode_url, params={"address": city, "key": GOOGLE_API_KEY}) as response:
                    geo_data = await response.json()
                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        return None
                timestamp = int(datetime.datetime.now().timestamp())
                async with session.get(timezone_url, params={"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}) as response:
                    tz_data = await response.json()
                    if tz_data.get("status") == "OK":
                        raw_offset = tz_data["rawOffset"] / 3600
                        dst_offset = tz_data["dstOffset"] / 3600
                        return raw_offset + dst_offset
                    else:
                        return None

        offset1 = await get_utc_offset(place1)
        offset2 = await get_utc_offset(place2)

        if offset1 is None or offset2 is None:
            await ctx.send(f"❌ Could not retrieve timezones for '{place1}' or '{place2}'.")
            return

        time_difference = abs(offset1 - offset2)
        await ctx.send(f"⏳ The time difference between **{place1.title()}** and **{place2.title()}** is **{time_difference} hours**.")

    except Exception as e:
        logger.exception(f"Error in /timedifference command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="joke", description="Get a random joke.")
async def random_joke(ctx: interactions.ComponentContext):
    """
    Fetch a random joke using JokeAPI and send it as an embed.
    """
    try:
        await ctx.defer()
        joke_url = "https://v2.jokeapi.dev/joke/Dark"
        logger.debug(f"Fetching joke from {joke_url}")
        async with aiohttp.ClientSession() as session:
            async with session.get(joke_url) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received JokeAPI response: {json.dumps(data, indent=2)}")
                    joke = data.get("joke") or f"**{data.get('setup')}**\n{data.get('delivery')}"
                    category = data.get("category", "Unknown")
                    embed = interactions.Embed(
                        title=f"😂 Random Joke ({category})",
                        description=joke,
                        color=0xD3D3D3
                    )
                    await ctx.send(embed=embed)
                else:
                    logger.warning(f"JokeAPI error: {response.status}")
                    await ctx.send("🤷 Couldn't fetch a joke. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /joke command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(
    name="warp",
    description="Apply a warp effect to a user's profile picture."
)
@interactions.slash_option(
    name="user",
    description="Select a user to warp their profile picture.",
    required=True,
    opt_type=interactions.OptionType.USER
)
@interactions.slash_option(
    name="mode",
    description="Select the warp mode.",
    required=True,
    opt_type=interactions.OptionType.STRING,
    choices=[
        {"name": "Swirl", "value": "swirl"},
        {"name": "Bulge", "value": "bulge"}
    ]
)
@interactions.slash_option(
    name="strength",
    description="Warp strength (0 = none, 6 = extreme, default = 6).",
    required=False,
    opt_type=interactions.OptionType.INTEGER,
    min_value=0,
    max_value=6
)
async def warp(ctx: interactions.ComponentContext, user: interactions.User, mode: str, strength: int = 6):
    """
    Apply a warp effect (swirl or bulge) to a user's profile picture.
    
    :param user: The target user.
    :param mode: The warp mode ("swirl" or "bulge").
    :param strength: Intensity of the warp effect (0 to 6).
    """
    await ctx.defer()
    logger.info(f"Received /warp command from {ctx.author.username} for {user.username}")
    logger.info(f"Mode: {mode}, Strength: {strength}")
    try:
        # Fetch the user's avatar URL.
        avatar_url = f"{user.avatar_url}"
        logger.debug(f"Avatar URL for {user.username}: {avatar_url}")
        if not avatar_url:
            logger.warning(f"{user.username} has no profile picture.")
            await ctx.send("❌ This user has no profile picture.", ephemeral=True)
            return

        logger.info(f"Fetching high-res avatar for {user.username}...")
        async with aiohttp.ClientSession() as session:
            async with session.get(avatar_url) as resp:
                if resp.status != 200:
                    await ctx.send("❌ Failed to fetch profile picture.", ephemeral=True)
                    logger.error(f"Failed to download avatar for {user.username} (HTTP {resp.status})")
                    return
                image_bytes = await resp.read()

        # Convert image bytes to a PIL Image.
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        width, height = img.size
        img_np = np.array(img)
        logger.debug(f"Image dimensions: {width}x{height}")

        # If strength is 0, return the original image.
        if strength == 0:
            output_buffer = io.BytesIO()
            img.save(output_buffer, format="PNG")
            output_buffer.seek(0)
            file = interactions.File(file=output_buffer, file_name="original.png")
            await ctx.send(files=[file])
            logger.info("Sent unmodified image (Strength 0)")
            return

        # Determine the center of the image for the warp effect.
        center_x, center_y = width // 2, height // 2
        strength_map = {0: 0, 1: 0.05, 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.5, 6: 0.7}
        effect_strength = strength_map.get(strength, 0.3)
        effect_radius = min(width, height) // 2
        logger.debug(f"Warp Center: ({center_x}, {center_y}), Effect Strength: {effect_strength}")

        # Create coordinate grids.
        x_coords, y_coords = np.meshgrid(np.arange(width), np.arange(height))
        dx = x_coords - center_x
        dy = y_coords - center_y
        distance = np.sqrt(dx**2 + dy**2)
        angle = np.arctan2(dy, dx)

        if mode == "swirl":
            logger.info("Applying swirl effect.")
            warped_angle = angle + (7 * effect_strength * np.exp(-distance / effect_radius))
            new_x_coords = (center_x + distance * np.cos(warped_angle)).astype(int)
            new_y_coords = (center_y + distance * np.sin(warped_angle)).astype(int)
        elif mode == "bulge":
            logger.info("Applying bulge effect.")
            normalized_distance = distance / effect_radius
            bulge_factor = 1 + effect_strength * (normalized_distance**2 - 1)
            bulge_factor = np.clip(bulge_factor, 0.5, 3.0)
            new_x_coords = (center_x + bulge_factor * dx).astype(int)
            new_y_coords = (center_y + bulge_factor * dy).astype(int)
        else:
            logger.warning(f"Invalid warp mode: {mode}")
            await ctx.send("❌ Invalid warp mode selected.", ephemeral=True)
            return

        # Ensure new coordinates are within image bounds.
        new_x_coords = np.clip(new_x_coords, 0, width - 1)
        new_y_coords = np.clip(new_y_coords, 0, height - 1)

        # Apply the transformation.
        warped_img_np = img_np[new_y_coords, new_x_coords]
        warped_img = Image.fromarray(warped_img_np)
        output_buffer = io.BytesIO()
        warped_img.save(output_buffer, format="PNG")
        output_buffer.seek(0)
        file = interactions.File(file=output_buffer, file_name=f"{mode}_warp.png")
        await ctx.send(files=[file])
        logger.info(f"Successfully applied {mode} effect with strength {strength} for {user.username}!")
    except Exception as e:
        logger.error(f"Error in /warp command: {e}", exc_info=True)
        await ctx.send("⚠️ An error occurred while processing the image. Please try again later.", ephemeral=True)

# -------------------------
# Bot Startup
# -------------------------
try:
    bot.start(TOKEN)
except Exception:
    logger.exception("Exception occurred during bot startup!")
    sys.exit(1)