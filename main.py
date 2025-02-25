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

# Dictionary mapping known bot IDs to their names.
bot_ids = {
    "302050872383242240": "Disboard",
    "1222548162741538938": "Discadia",
    "493224033067003023": "DS.me",
    "835255643157168168": "Unfocused",
}

# -------------------------
# Supabase Client
# -------------------------
# Create a Supabase client instance to interact with the database.
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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

# -------------------------
# Event Listeners
# -------------------------
@interactions.listen()
async def on_ready():
    """
    ! EVENT HANDLER CALLED WHEN THE BOT IS READY
    * Sets up bot presence and activity, initializes the reminders table,
    * and reschedules the Disboard reminder if a valid role is present.
    """
    logger.info("Bot is online! Setting up status and activity.")

    # Set bot presence and activity
    try:
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING,
            ),
        )
        logger.debug("Bot presence and activity set.")
    except Exception as e:
        logger.exception(f"Failed to set bot presence: {e}")

    # Initialize the reminders table
    try:
        initialize_reminders_table()
        logger.debug("Reminders table initialized.")
    except Exception as e:
        logger.exception(f"Error initializing reminders table: {e}")

    # Reschedule only the Disboard reminder based on a specific role
    try:
        role = get_role()
        if not role:
            logger.warning("No role set for reminders; skipping Disboard reminder reschedule.")
        else:
            try:
                logger.debug("Attempting to reschedule Disboard reminder.")
                await reschedule_reminder("disboard", role)
                logger.debug("Disboard reminder successfully rescheduled.")
            except Exception as inner_e:
                logger.exception(f"Failed to reschedule Disboard reminder: {inner_e}")
    except Exception as e:
        logger.exception(f"Error during Disboard reminder rescheduling: {e}")

    logger.info("Bot is ready!")

@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    """
    ! EVENT HANDLER TRIGGERED WHEN A NEW MESSAGE IS CREATED
    * Processes incoming messages to check if an embed contains "Bump done"
    * and triggers the Disboard reminder if found.
    """
    try:
        # Log the received message's author for debugging purposes
        logger.debug(f"Message received from {event.message.author.username}")

        # Process the message if it contains embeds
        if event.message.embeds:
            try:
                embed = event.message.embeds[0]
                embed_description = embed.description or ""
                logger.debug(f"Embed detected: {embed_description}")
                if "Bump done" in embed_description:
                    logger.debug("Triggering Disboard reminder.")
                    await disboard()
            except Exception as e:
                logger.exception(f"Error processing embed content: {e}")
    except Exception as e:
        logger.exception(f"Error processing on_message_create event: {e}")

@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    """
    ! EVENT HANDLER TRIGGERED WHEN A NEW MEMBER JOINS THE GUILD
    * Retrieves configuration settings for backup mode, troll mode, and mute mode.
    * Calculates the new member's account age and logs join details.
    * Skips processing if the member is a bot.
    * Kicks the member if troll mode is enabled and their account is too new.
    * If mute mode is enabled, tracks the member and schedules a mute kick.
    * If backup mode is fully configured, sends a welcome message in a specified channel and assigns a backup role.
    * Each major operation is wrapped with error handling to ensure that any exception does not stop the entire join process.
    """
    try:
        # Retrieve configuration settings
        assign_role = get_value("backup_mode_enabled") == "true"
        role_id = int(get_value("backup_mode_id") or 0)
        channel_id = int(get_value("backup_mode_channel") or 0)
        kick_users = get_value("troll_mode") == "true"
        kick_users_age_limit = int(get_value("troll_mode_account_age") or 30)
        mute_mode_enabled = str(get_value("mute_mode")).lower() == "true"
        mute_kick_time = int(get_value("mute_mode_kick_time_hours") or 4)

        # Get member and guild objects from the event
        member = event.member
        guild = event.guild

        # Calculate the member's account age in days
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at
        logger.debug(f"New member joined: {member.username} in guild {guild.name} | Account Age: {account_age.days} days")

        # Skip processing for bots
        if member.bot:
            logger.debug(f"Skipping mute tracking for bot {member.username}")
            return

        # Kick new members if troll mode is enabled and the account is too new
        if kick_users and account_age < datetime.timedelta(days=kick_users_age_limit):
            await member.kick(reason="Account is too new!")
            logger.debug(f"Kicked {member.username} for having an account younger than {kick_users_age_limit} days.")
            return

        # If mute mode is enabled, track the member and schedule a mute kick
        if mute_mode_enabled:
            join_time = datetime.datetime.now(datetime.UTC).isoformat()
            logger.debug(f"Attempting to track {member.username} for mute mode.")
            try:
                track_new_member(member.id, member.username, join_time)
                logger.debug(f"Successfully tracked {member.username} for mute mode.")
                await schedule_mute_kick(member.id, member.username, join_time, mute_kick_time, guild.id)
            except Exception as e:
                logger.error(f"Failed to track {member.username}: {e}")

        # Check if backup mode is fully configured before sending welcome messages and assigning roles
        if not (assign_role and role_id and channel_id):
            logger.debug("Backup mode is not fully configured. Skipping role assignment and welcome message.")
            return

        # Retrieve the designated channel for welcome messages
        channel = guild.get_channel(int(channel_id)) if channel_id else None
        if not channel:
            logger.warning(f"Channel with ID {channel_id} not found. Welcome message skipped.")
            return

        # Create the welcome embed with instructions and details for the new member
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
        # Send the welcome message in the designated channel
        await channel.send(embeds=[embed])
        logger.debug(f"Sent welcome message in {channel.name} for {member.username}.")

        # Retrieve the role object from the guild and assign it to the new member
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
    ! EVENT HANDLER TRIGGERED WHEN A MEMBER LEAVES THE GUILD
    * Logs the member's departure, removes the member from mute tracking, and ensures that the removal process is logged for debugging.
    * Exceptions are caught and logged to avoid interruption of the event flow.
    """
    try:
        # Retrieve the member and guild information from the event
        member = event.member
        guild = event.guild

        # Log the member's departure with details for debugging
        logger.debug(f"Member left: {member.username} from Guild {guild.name}. Removing from mute tracking.")

        # Remove the member from the mute tracking system
        remove_tracked_member(member.id)

        # Log successful removal for further traceability
        logger.debug(f"Successfully processed removal for {member.username}.")

    except Exception as e:
        # Catch and log any errors that occur during the removal process
        logger.exception(f"Error during on_member_remove event: {e}")


# -------------------------
# Graceful Shutdown Routine
# -------------------------
async def shutdown(loop, signal=None):
    """
    ! CANCEL OUTSTANDING TASKS AND FLUSH SENTRY LOGS BEFORE SHUTTING DOWN
    * Cancels all running tasks except the current one.
    * Waits for these tasks to finish, handling any exceptions that arise.
    * Flushes Sentry logs to ensure any pending logs are sent before exit.
    * Stops the event loop to complete the shutdown process.
    ? PARAMETERS:
    ? loop   - The current asyncio event loop.
    ? signal - Optional signal that triggered the shutdown.
    """
    # Retrieve all tasks in the event loop except the current one.
    tasks = [t for t in asyncio.all_tasks(loop) if t is not asyncio.current_task(loop)]
    
    # Cancel each of the gathered tasks.
    [task.cancel() for task in tasks]
    
    # Wait for all cancelled tasks to complete, capturing exceptions if any.
    await asyncio.gather(*tasks, return_exceptions=True)
    
    # Flush Sentry logs with a timeout of 2 seconds to ensure all logs are sent.
    sentry_sdk.flush(timeout=2)
    
    # Stop the event loop.
    loop.stop()

def handle_interrupt(signal, frame):
    """
    Synchronous signal handler that schedules the asynchronous shutdown.

    When a SIGINT or SIGTERM is received, this function gets the current
    event loop and schedules the shutdown coroutine.

    :param signal: The signal received (e.g., SIGINT, SIGTERM).
    :param frame: The current stack frame (unused but required by signal handler signature).
    """
    # Get the current event loop.
    loop = asyncio.get_event_loop()
    
    # Schedule the shutdown coroutine on the event loop, passing the signal.
    loop.create_task(shutdown(loop, signal=signal))

# Register the signal handlers to catch SIGINT and SIGTERM for graceful shutdown.
signal.signal(signal.SIGINT, handle_interrupt)
signal.signal(signal.SIGTERM, handle_interrupt)

# -------------------------
# Main Startup Routine
# -------------------------
async def main():
    """
    ! MAIN ENTRY POINT TO START THE BOT
    * Logs the startup process, attempts to start the bot asynchronously, and ensures a graceful shutdown by cleaning up tasks and flushing logs,
    * regardless of whether an exception occurs during startup.
    """
    try:
        # Log the beginning of the bot startup sequence.
        logger.info("Starting the bot...")
        
        # Asynchronously start the bot using the provided TOKEN.
        await bot.astart(TOKEN)
    
    except Exception:
        # Log any exception that occurs during the bot startup.
        logger.exception("Exception occurred during bot startup!")
    
    finally:
        # Ensure a graceful shutdown by cleaning up tasks and flushing any pending logs.
        await shutdown(asyncio.get_event_loop())


# -------------------------
# Entry Point
# -------------------------
if __name__ == "__main__":
    try:
        # Run the main asynchronous startup routine.
        asyncio.run(main())
    except KeyboardInterrupt:
        # Handle a keyboard interruption gracefully.
        logger.info("KeyboardInterrupt received. Exiting.")
    finally:
        # Ensure all logging resources are flushed and shut down before exiting.
        logging.shutdown()
        # Exit the program with a success status code.
        sys.exit(0)

# -------------------------
# Database Table Helpers
# -------------------------

def get_value(key: str):
    """
    ! RETRIEVE A CONFIGURATION VALUE FROM THE 'CONFIG' TABLE IN SUPABASE
    * Retrieves a configuration value for the specified key from the 'config' table in Supabase.
    ? PARAMETERS:
    ? key - The key to search for in the config table.
    ? RETURNS:
    * The deserialized value if found; otherwise, None.
    """
    try:
        # Execute a query to select the 'value' for the given key
        response = supabase.table("config").select("value").eq("id", key).maybe_single().execute()
        if response is None:
            logger.warning(f"Supabase query for key '{key}' returned None.")
            return None
        # If data exists and contains the 'value' field, deserialize it
        if response.data and isinstance(response.data, dict) and "value" in response.data:
            return json.loads(response.data["value"])
        logger.warning(f"Key '{key}' not found in Supabase or data missing.")
        return None
    except Exception:
        logger.exception(f"Error getting key '{key}' in Supabase.")
        return None

def set_value(key: str, value):
    """
    ! INSERT OR UPDATE A CONFIGURATION VALUE IN THE 'CONFIG' TABLE IN SUPABASE
    * Inserts or updates a configuration value in the 'config' table in Supabase.
    ? PARAMETERS:
    ? key   - The configuration key.
    ? value - The value to store; it will be serialized to JSON.
    """
    try:
        # Serialize the value to a JSON string
        serialized = json.dumps(value)
        # Check if the key already exists
        existing = get_value(key)
        if existing is None:
            # Insert a new config entry if the key does not exist
            supabase.table("config").insert({"id": key, "value": serialized}).execute()
            logger.debug(f"Inserted new config entry for key '{key}'.")
        else:
            # Update the existing config entry
            supabase.table("config").update({"value": serialized}).eq("id", key).execute()
            logger.debug(f"Updated config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting key '{key}' in Supabase.")

def delete_value(key: str):
    """
    ! DELETE A CONFIGURATION VALUE FROM THE 'CONFIG' TABLE IN SUPABASE
    * Deletes the configuration value for the specified key from the 'config' table in Supabase.
    ? PARAMETERS:
    ? key - The key to be deleted.
    """
    try:
        supabase.table("config").delete().eq("id", key).execute()
        logger.debug(f"Deleted config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting key '{key}' in Supabase.")

def get_reminder_data(key: str):
    """
    ! RETRIEVE REMINDER DATA FOR A GIVEN KEY FROM THE 'REMINDERS' TABLE
    * Retrieves reminder data for the specified key from the 'reminders' table.
    ? PARAMETERS:
    ? key - The reminder key.
    ? RETURNS:
    ? A dictionary with reminder data (state, scheduled_time, reminder_id) if found; otherwise, None.
    """
    try:
        response = supabase.table("reminders").select("state", "scheduled_time", "reminder_id") \
            .eq("key", key).maybe_single().execute()
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
    ! INSERT OR UPDATE REMINDER DATA IN THE 'REMINDERS' TABLE IN SUPABASE
    * Inserts or updates reminder data in the 'reminders' table in Supabase.
    ? PARAMETERS:
    ? key            - The reminder key.
    ? state          - The state of the reminder (active/inactive).
    ? scheduled_time - The scheduled time for the reminder.
    ? reminder_id    - The unique identifier for the reminder.
    """
    try:
        # Use the scheduled_time as-is; ensure it's in a proper format if needed
        serialized_time = scheduled_time
        existing = get_reminder_data(key)
        data = {
            "key": key,
            "state": state,
            "scheduled_time": serialized_time,
            "reminder_id": reminder_id
        }
        if existing is None:
            # Insert new reminder data if it does not exist
            supabase.table("reminders").insert(data).execute()
            logger.debug(f"Inserted new reminder entry for key '{key}'.")
        else:
            # Update existing reminder data
            supabase.table("reminders").update(data).eq("key", key).execute()
            logger.debug(f"Updated reminder entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting reminder data for key '{key}'.")

def delete_reminder_data(key: str):
    """
    ! DELETE REMINDER DATA FOR A GIVEN KEY FROM THE 'REMINDERS' TABLE
    * Deletes the reminder data for the specified key from the 'reminders' table.
    ? PARAMETERS:
    ? key - The reminder key to delete.
    """
    try:
        supabase.table("reminders").delete().eq("key", key).execute()
        logger.debug(f"Deleted reminder data for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting reminder data for key '{key}'.")

def initialize_reminders_table():
    """
    ! INITIALIZE THE REMINDERS TABLE WITH DEFAULT KEYS IF THEY DO NOT ALREADY EXIST
    * Checks for the presence of each default key in the reminders table.
    * If a key is missing, inserts a default reminder entry with state set to False, scheduled_time as None, and reminder_id as None.
    """
    default_keys = ["disboard"]
    for key in default_keys:
        try:
            existing = get_reminder_data(key)
            if existing is None:
                # Insert default reminder data with default values.
                set_reminder_data(key, False, None, None)
                logger.debug(f"Inserted default reminder data for key: {key}")
            else:
                logger.debug(f"Reminder data for key '{key}' already exists. Skipping initialization.")
        except Exception as e:
            logger.exception(f"Failed to initialize reminder for key '{key}': {e}")


def track_new_member(member_id: int, username: str, join_time: str):
    """
    ! TRACK A NEW MEMBER IN THE 'TRACKED_MEMBERS' TABLE
    * Inserts or updates the record for a new member in the 'tracked_members' table.
    ? PARAMETERS:
    ? member_id - The unique ID of the member.
    ? username  - The username of the member.
    ? join_time - The join time of the member (in ISO format).
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
    ! RETRIEVE TRACKING INFORMATION FOR A MEMBER FROM THE 'TRACKED_MEMBERS' TABLE
    * Retrieves the tracking information for a member from the 'tracked_members' table.
    ? PARAMETERS:
    ? member_id - The unique ID of the member.
    ? RETURNS:
    ? The tracked member data if found; otherwise, None.
    """
    try:
        response = supabase.table("tracked_members").select("*").eq("member_id", member_id).maybe_single().execute()
        if response and response.data:
            return response.data
        return None
    except Exception:
        logger.exception("Error retrieving tracked data for a member.")
        return None

def remove_tracked_member(member_id: int):
    """
    ! REMOVE A MEMBER'S TRACKING INFORMATION FROM THE 'TRACKED_MEMBERS' TABLE
    * Removes the tracking information for a member from the 'tracked_members' table.
    ? PARAMETERS:
    ? member_id - The unique ID of the member to remove.
    """
    try:
        response = supabase.table("tracked_members").delete().eq("member_id", member_id).execute()
        resp_dict = response.dict()
        if resp_dict.get("error"):
            logger.error("Failed to remove tracked member.")
        elif not resp_dict.get("data"):
            logger.debug("No tracked member found. Nothing to remove.")
        else:
            logger.debug("Removed tracked member.")
    except Exception as e:
        logger.exception(f"Error removing tracked member: {e}")

def get_all_tracked_members():
    """
    ! RETRIEVE ALL TRACKED MEMBERS FROM THE 'TRACKED_MEMBERS' TABLE
    * Retrieves all tracked member records from the 'tracked_members' table.
    ? RETURNS:
    ? A list of tracked member records; returns an empty list if none found or on error.
    """
    try:
        response = supabase.table("tracked_members").select("member_id", "username", "join_time").execute()
        if response and response.data:
            return response.data
        return []
    except Exception:
        logger.exception("Error retrieving all tracked members from Supabase.")
        return []

def get_role():
    """
    ! RETRIEVE THE ROLE CONFIGURATION USED FOR REMINDERS
    * Retrieves the role configuration used for reminders.
    ? RETURNS:
    ? The role if set; otherwise, None.
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
    ! ASYNCHRONOUSLY RETRIEVE A CHANNEL OBJECT BASED ON A CONFIGURATION KEY
    * Retrieves a channel object asynchronously based on a configuration key.
    ? PARAMETERS:
    ? channel_key - The key used to fetch the channel ID from the configuration.
    ? RETURNS:
    ? The channel object if found; otherwise, None.
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

# -------------------------
# Miscellaneous Helpers
# -------------------------

def calculate_remaining_time(scheduled_time):
    """
    ! CALCULATE AND FORMAT THE REMAINING TIME UNTIL THE SCHEDULED TIME
    * Calculates the time left until the provided scheduled time.
    * Returns a string in the format "HH:MM:SS" if still pending, "⏰ Expired!" if passed, or an error message if calculation fails.
    ? PARAMETERS:
    ? scheduled_time - An ISO-formatted datetime string.
    ? RETURNS:
    ? A formatted string representing the remaining time, "⏰ Expired!" if the time has passed, or an error message.
    """
    if not scheduled_time:
        return "Not set!"
    try:
        # Get the current time in UTC
        now = datetime.datetime.now(tz=pytz.UTC)
        # Convert the scheduled time from ISO format to a timezone-aware datetime object in UTC
        scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
        remaining_time = scheduled_dt - now
        # Check if the remaining time has expired
        if remaining_time <= datetime.timedelta(seconds=0):
            return "⏰ Expired!"
        # Calculate hours, minutes, and seconds
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
    ! AWAIT A TASK WHILE SAFELY HANDLING AND LOGGING ANY EXCEPTIONS
    * Awaits an awaitable task while catching and logging any exceptions that occur.
    ? PARAMETERS:
    ? task - An awaitable task.
    """
    try:
        await task
    except Exception as e:
        logger.exception(f"Exception in scheduled task: {e}")


async def get_coordinates(city: str):
    """
    ! RETRIEVE THE LATITUDE AND LONGITUDE FOR A GIVEN CITY USING THE GOOGLE GEOCODING API
    * Retrieves geographic coordinates for the given city.
    ? PARAMETERS:
    ? city - The name of the city to geocode.
    ? RETURNS:
    ? A tuple (latitude, longitude) if successful; otherwise, (None, None).
    """
    try:
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {"address": city, "key": GOOGLE_API_KEY}
        # Create an asynchronous HTTP session
        async with aiohttp.ClientSession() as session:
            async with session.get(geocode_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Google Geocoding API response: {json.dumps(data, indent=2)}")
                    # Check if results were returned
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
# Specific Bump/Boop Handler
# -------------------------
async def disboard():
    """
    ! TRIGGER THE DISBOARD BUMP REMINDER LOGIC
    * Uses the `handle_reminder` helper to:
    * - Acknowledge that the server has been bumped on Disboard.
    * - Schedule a reminder message for when it's time to bump again.
    * The reminder is set with a 7200-second (2 hours) interval.
    """
    # Call the reminder handler with Disboard-specific messages and timing.
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Disboard again!",
        interval=7200  # Reminder interval set to 2 hours (7200 seconds)
    )

# -------------------------
# Reminder Scheduling
# -------------------------

async def send_scheduled_message(initial_message: str, reminder_message: str, interval: int, key: str):
    """
    ! SEND INITIAL AND REMINDER MESSAGE
    * Sends an initial message (if provided), waits for the specified interval,
    * then sends a reminder message and cleans up the reminder data.
    ? PARAMETERS:
    ? initial_message  - Message to send immediately.
    ? reminder_message - Reminder message to send after the delay.
    ? interval         - Delay in seconds before sending the reminder.
    ? key              - The reminder key used to fetch and delete reminder data.
    """
    try:
        # Retrieve the reminder channel from configuration
        channel = await get_channel("reminder_channel")
        if not channel:
            logger.warning("No valid reminder channel found; cannot send scheduled message.")
            return

        # Send the initial message if provided
        if initial_message:
            logger.debug(f"Sending initial message for '{key}': {initial_message}")
            await channel.send(initial_message)

        # Wait for the specified interval
        logger.debug(f"Waiting {interval} seconds before sending reminder for '{key}'.")
        await asyncio.sleep(interval)

        # Send the reminder message after the delay
        logger.debug(f"Sending reminder message for '{key}': {reminder_message}")
        await channel.send(reminder_message)

        # Clean up the reminder data if it exists
        reminder_data = get_reminder_data(key)
        if reminder_data:
            delete_reminder_data(key)
            logger.debug(f"Reminder {reminder_data['reminder_id']} for '{key.title()}' has been cleaned up.")
    except Exception as e:
        logger.exception(f"Error in send_scheduled_message: {e}")


async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    """
    ! HANDLE THE CREATION AND SCHEDULING OF A REMINDER
    * Checks if a reminder for the given key already exists.
    * If not, creates a new reminder entry with a unique reminder ID and schedules the sending of messages using send_scheduled_message.
    ? PARAMETERS:
    ? key              - The reminder key.
    ? initial_message  - The message to send immediately.
    ? reminder_message - The reminder message to send after the interval.
    ? interval         - The delay (in seconds) before sending the reminder.
    """
    try:
        # Check if a reminder is already scheduled for this key
        existing_data = get_reminder_data(key)
        if existing_data and existing_data.get("scheduled_time"):
            logger.debug(f"{key.capitalize()} already has a timer set. Skipping new reminder.")
            return

        # Generate a unique reminder ID and set the reminder data
        reminder_id = str(uuid.uuid4())
        set_reminder_data(
            key,
            True,
            (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
            reminder_id
        )

        # Get the role for mentions in the reminder message
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


async def reschedule_reminder(key, role):
    """
    ! RESCHEDULE EXISTING REMINDER
    * Checks the reminder data for Disboard and calculates the remaining time.
    * If the reminder is still pending, creates a safe task to send the scheduled message;
    * if expired, cleans up the reminder data.
    ? PARAMETERS:
    ? key  - The reminder key.
    ? role - The role ID to mention in the reminder message.
    """
    try:
        # Only proceed if the key is "disboard"
        if key != "disboard":
            logger.debug(f"Reminder key '{key}' is not supported. Only 'disboard' is handled.")
            return

        # Retrieve the current reminder data for the specified key
        reminder_data = get_reminder_data(key)
        if not reminder_data:
            logger.debug("No reminder data found for Disboard.")
            return

        scheduled_time = reminder_data.get("scheduled_time")
        reminder_id = reminder_data.get("reminder_id")

        if scheduled_time and reminder_id:
            # Convert scheduled time to a timezone-aware datetime object
            scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
            now = datetime.datetime.now(tz=pytz.UTC)
            if scheduled_dt <= now:
                logger.debug(f"Reminder {reminder_id} for Disboard has already expired. Removing it.")
                delete_reminder_data(key)
                return

            # Calculate the remaining time until the scheduled reminder
            remaining_time = scheduled_dt - now
            logger.debug(f"Rescheduling Disboard reminder {reminder_id} in {remaining_time}.")

            # Create a safe task to send the scheduled message after the remaining time elapses
            asyncio.create_task(
                safe_task(
                    send_scheduled_message(
                        initial_message=None,
                        reminder_message=f"🔔 <@&{role}> It's time to bump on Disboard!",
                        interval=remaining_time.total_seconds(),
                        key=key
                    )
                )
            )
    except Exception as e:
        logger.exception(f"Error while attempting to reschedule the Disboard reminder: {e}")

# -------------------------
# Mute Mode Kick Scheduling
# -------------------------
async def schedule_mute_kick(member_id: int, username: str, join_time: str, mute_kick_time: int, guild_id: int):
    """
    ! SCHEDULE A KICK FOR A MEMBER UNDER MUTE MODE
    * Calculates elapsed time since the member joined and determines the remaining time before a kick should occur.
    * If the remaining time is ≤ 0, attempts an immediate kick; otherwise, schedules a delayed kick using an asynchronous task.
    ? PARAMETERS:
    ? member_id      - The unique ID of the member.
    ? username       - The member's username.
    ? join_time      - The time the member joined (ISO-formatted string).
    ? mute_kick_time - The allowed time in hours before the member is kicked.
    ? guild_id       - The ID of the guild where the kick should occur.
    """
    try:
        # Calculate the current time and the time elapsed since the member joined.
        now = datetime.datetime.now(datetime.timezone.utc)
        join_time_dt = datetime.datetime.fromisoformat(join_time)
        elapsed_time = (now - join_time_dt).total_seconds()

        # Calculate the remaining time (in seconds) before the kick is due.
        remaining_time = (mute_kick_time * 3600) - elapsed_time

        # Retrieve the guild object using its ID.
        guild = bot.get_guild(guild_id)

        # If the remaining time is up or negative, attempt an immediate kick.
        if remaining_time <= 0:
            if not guild:
                logger.info(f"Guild {guild_id} not found. Removing {username} from tracking.")
                remove_tracked_member(member_id)
                return

            member = guild.get_member(member_id)
            if not member:
                logger.info(f"Member {username} not found in the guild (possibly already left). Removing from tracking.")
                remove_tracked_member(member_id)
                return
            try:
                # Attempt to kick the member immediately.
                await member.kick(reason="User did not send a message in time.")
                remove_tracked_member(member_id)
                logger.info(f"Kicked {username} immediately due to bot restart.")
            except Exception as e:
                logger.warning(f"Failed to kick {username} immediately after bot restart: {e}")
            return

        # Define an asynchronous function to perform the delayed kick.
        async def delayed_kick():
            # Wait for the remaining time before executing the kick.
            await asyncio.sleep(remaining_time)
            # Verify that the member is still tracked before proceeding.
            if get_tracked_member(member_id):
                guild = bot.get_guild(guild_id)
                if not guild:
                    logger.warning(f"Guild {guild_id} not found. Cannot kick {username}.")
                    return
                member = guild.get_member(member_id)
                if not member:
                    try:
                        # Try fetching the member if not found in the current cache.
                        member = await bot.fetch_member(guild_id, member_id)
                    except Exception as e:
                        logger.info(f"Member {username} not found during scheduled kick. Removing from tracking.")
                        remove_tracked_member(member_id)
                        return
                try:
                    # Attempt to kick the member and remove them from tracking.
                    await member.kick(reason="User did not send a message in time.")
                    remove_tracked_member(member_id)
                    logger.info(f"Kicked {username} after scheduled time.")
                except Exception as e:
                    logger.warning(f"Failed to kick {username} after scheduled time: {e}")

        # Schedule the delayed kick as a background task.
        asyncio.create_task(delayed_kick())
        logger.debug(f"Scheduled kick for {username} in {remaining_time:.2f} seconds.")
    except Exception as e:
        logger.exception(f"Error scheduling mute mode kick for {username}: {e}")

# -------------------------
# reminder Slash Command
# -------------------------
@interactions.slash_command(
    name="reminder",
    description="Setup and check the status of bump reminders."
)
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
    ! HANDLE /REMINDER COMMAND
    * Sets or checks reminder configuration. When both channel and role are provided, the command saves the channel ID and role ID
    * for future reminders (admin-only). Without these options, it displays the current reminder configuration and status of the
    * Disboard reminder.
    ? PARAMETERS:
    ? ctx     - The context of the command.
    ? channel - (Optional) Channel where reminders will be sent.
    ? role    - (Optional) Role to ping in reminder messages.
    """
    try:
        # Check if both channel and role are provided for setup.
        if channel and role:
            # Validate that the user has administrator permissions.
            if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /reminder setup attempt by {ctx.author.username}")
                await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
                return

            # Log the reminder setup details.
            logger.debug(f"⏰ Disboard reminder setup requested by {ctx.author.username}. Channel: {channel.name}, Role: {role.id}")

            # Save the channel and role configuration.
            set_value("reminder_channel", channel.id)
            set_value("role", role.id)
            logger.debug("Disboard reminder setup successfully completed.")

            # Confirm successful setup to the user.
            await ctx.send(
                f"✅ **Reminder setup complete!**\n"
                f"📢 Disboard reminders will be sent in {channel.name}.\n"
                f"🎭 The role to be pinged is <@&{role.id}>."
            )
            return

        # If channel and role are not provided, perform a status check.
        logger.debug(f"Disboard reminder status check requested by {ctx.author.username}.")
        channel_id = get_value("reminder_channel")
        role_id = get_value("role")

        # Retrieve channel name if configured; otherwise, mark as not set.
        if channel_id:
            channel_obj = bot.get_channel(channel_id)
            channel_str = channel_obj.name if channel_obj else "Not set!"
        else:
            channel_str = "Not set!"

        # Format the role display string.
        role_str = f"<@&{role_id}>" if role_id else "Not set!"

        logger.debug(f"Disboard Reminder Channel: {channel_str}")
        logger.debug(f"Disboard Reminder Role: {role_str}")

        # Prepare reminder status information for the Disboard reminder.
        data = get_reminder_data("disboard")
        time_str = calculate_remaining_time(data.get("scheduled_time")) if data else "Not set!"
        reminder_info = f"⏳ **Disboard**: {time_str}"
        logger.debug(f"Disboard Reminder: {time_str}")

        # Construct the summary message with configuration and Disboard reminder status.
        summary = (
            f"📌 **Disboard Reminder Status:**\n"
            f"📢 **Channel:** {channel_str}\n"
            f"🎭 **Role:** {role_str}\n\n"
            f"{reminder_info}"
        )
        # Send the summary back to the user.
        await ctx.send(summary)
    except Exception as e:
        # Log any errors and notify the user of an error.
        logger.exception(f"Error in /reminder command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request. Please try again later.", ephemeral=True)

# -------------------------
# fix Slash Command
# -------------------------
@interactions.slash_command(
    name="fix",
    description="Runs the fix logic for Disboard by adding the service data to the database."
)
async def fix_command(ctx: interactions.ComponentContext):
    """
    ! EXECUTE FIX LOGIC FOR DISBOARD
    * Restricted to administrators. Sets a new reminder for Disboard with a pre-defined delay (7200 seconds) and updates the database accordingly.
    ? PARAMETERS:
    ? ctx - The context of the command.
    """
    # Ensure the user has administrator permissions.
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /fix attempt by {ctx.author.username}")
        return

    try:
        # Defer the response to allow time for processing.
        await ctx.defer()
        logger.debug(f"Received /fix command from {ctx.author.username} for service: disboard")

        # Set the delay for Disboard (2 hours = 7200 seconds).
        seconds = 7200
        logger.debug(f"Service 'disboard' selected with a delay of {seconds} seconds.")

        # Generate a unique reminder ID and calculate the scheduled time.
        reminder_id = str(uuid.uuid4())
        scheduled_time = (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=seconds)).isoformat()

        # Prepare and store the reminder data for Disboard.
        reminder_data = {
            "state": True,
            "scheduled_time": scheduled_time,
            "reminder_id": reminder_id
        }
        set_reminder_data("disboard", True, scheduled_time, reminder_id)
        logger.debug(f"Fix logic applied: {reminder_data}")

        # Confirm the successful application of the fix logic.
        await ctx.send("✅ Fix logic successfully applied for **disboard**!")
    except Exception as e:
        logger.exception(f"Error in /fix command: {e}")
        await ctx.send("⚠️ An error occurred while applying fix logic. Please try again later.", ephemeral=True)

# -------------------------
# resetreminders Slash Command
# -------------------------
@interactions.slash_command(
    name="resetreminders",
    description="Reset the Disboard reminder in the database to its default value."
)
async def reset_reminders(ctx: interactions.ComponentContext):
    """
    ! RESET DISBOARD REMINDER
    * Restricted to administrators. Resets the Disboard reminder in the database to its default value by setting its state to
    * False and clearing any scheduled time or reminder ID.
    ? PARAMETERS:
    ? ctx - The context of the command.
    """
    # Verify that the user has administrator permissions.
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /resetreminders attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        logger.debug(f"Received /resetreminders command from {ctx.author.username}")
        await ctx.defer()

        # Reset only the 'disboard' reminder data.
        set_reminder_data("disboard", False, None, None)
        logger.debug("Reset reminder data for disboard")

        logger.debug("Disboard reminder successfully reset.")
        await ctx.send("✅ The Disboard reminder has been reset to default values.")
    except Exception as e:
        logger.exception(f"Error in /resetreminders command: {e}")
        await ctx.send("⚠️ An error occurred while resetting the Disboard reminder. Please try again later.", ephemeral=True)

# -------------------------
# mutemode Slash Command
# -------------------------
@interactions.slash_command(
    name="mutemode",
    description="Toggle auto-kicking of users who don't send a message within a time limit."
)
@interactions.slash_option(
    name="enabled",
    description="Enable or disable mute mode",
    required=True,
    opt_type=interactions.OptionType.STRING,
    choices=[
        {"name": "Enabled", "value": "enabled"},
        {"name": "Disabled", "value": "disabled"}
    ]
)
@interactions.slash_option(
    name="time",
    description="Time limit in hours before a silent user is kicked (Default: 2)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def toggle_mute_mode(ctx: interactions.ComponentContext, enabled: str, time: int = 2):
    """
    ! TOGGLE MUTE MODE (AUTO-KICK SILENT USERS)
    * Restricted to administrators. When enabled, users must send a message within the specified time limit (in hours)
    * or they will be automatically kicked from the server.
    ? PARAMETERS:
    ? ctx     - The context of the slash command.
    ? enabled - A string value ("enabled" or "disabled") indicating whether to enable mute mode.
    ? time    - (Optional) The time limit in hours before a silent user is kicked. Defaults to 2 hours.
    """
    # Determine if mute mode should be enabled based on the provided option.
    is_enabled = True if enabled.lower() == "enabled" else False

    # Check if the user has administrator permissions.
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /mutemode attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        # Log the receipt of the command with details.
        logger.debug(f"Received /mutemode command from {ctx.author.username}")
        logger.debug(f"Mute mode toggle: {'Enabled' if is_enabled else 'Disabled'}, Kick Time: {time} hours")
        
        # Update the configuration values in the database.
        set_value("mute_mode", is_enabled)
        set_value("mute_mode_kick_time_hours", time)

        # Build the response message based on whether mute mode is enabled or disabled.
        response_message = (
            f"🔇 Mute mode has been ✅ **enabled**. New users must send a message within **{time}** hours or be kicked."
            if is_enabled else "🔇 Mute mode has been ❌ **disabled**."
        )
        # Send the response to the user.
        await ctx.send(response_message)
        logger.debug(f"Mute mode {'enabled' if is_enabled else 'disabled'} by {ctx.author.username}, kick time set to {time} hours.")
    except Exception as e:
        # Log any exceptions and notify the user.
        logger.exception(f"Error in /mutemode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling mute mode. Please try again later.", ephemeral=True)

# -------------------------
# testmessage Slash Command
# -------------------------
@interactions.slash_command(
    name="testmessage", 
    description="Send a test message to the reminder channel."
)
async def test_reminders(ctx: interactions.ComponentContext):
    """
    ! SEND TEST REMINDER MESSAGE
    * Restricted to administrators. Checks if a role is set for reminders and sends a test message pinging the role in the reminder channel.
    ? PARAMETERS:
    ? ctx - The context of the slash command.
    """
    # Check if the user has administrator permissions.
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /testmessage attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        # Log the request for a test message.
        logger.debug(f"Test message requested by {ctx.author.username}.")

        # Retrieve the role ID from the database/configuration.
        role_id = get_value("role")
        if not role_id:
            logger.warning("No role has been set up for reminders.")
            await ctx.send("⚠️ No role has been set up for reminders.", ephemeral=True)
            return

        # Log that the test message is about to be sent.
        logger.debug("Sending test reminder message.")
        
        # Send a test message that pings the configured role.
        await ctx.send(f"🔔 <@&{role_id}> This is a test reminder message!")
        logger.debug("Test reminder message successfully sent.")
        
    except Exception as e:
        # Log any exception and notify the user of the error.
        logger.exception(f"Error in /testmessage command: {e}")
        await ctx.send("⚠️ Could not send test message. Please try again later.", ephemeral=True)

# -------------------------
# dev Slash Command
# -------------------------
@interactions.slash_command(
    name="dev",
    description="Maintain developer tag."
)
async def dev(ctx: interactions.ComponentContext):
    """
    ! MAINTAIN DEVELOPER TAG
    * Restricted to administrators. Logs the maintenance process and sends a confirmation message that the developer tag has been maintained.
    ? PARAMETERS:
    ? ctx - The context of the slash command.
    """
    # Check if the user has administrator permissions.
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /dev attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        # Log the start of the developer tag maintenance process.
        logger.debug(f"Developer tag maintenance requested by {ctx.author.username}.")
        
        # Perform any developer tag maintenance logic here.
        # (Currently, no maintenance logic is implemented beyond logging.)
        logger.debug("Developer tag maintenance completed.")
        
        # Send a confirmation message to the user.
        await ctx.send("🛠️ Developer tag maintained!")
    except Exception as e:
        # Log any errors and inform the user of the error.
        logger.exception(f"Error in /dev command: {e}")
        await ctx.send("⚠️ An error occurred while maintaining the developer tag. Please try again later.", ephemeral=True)

# -------------------------
# source Slash Command
# -------------------------
@interactions.slash_command(
    name="source",
    description="Get links for the bot's resources."
)
async def source(ctx: interactions.ComponentContext):
    """
    ! SEND BOT RESOURCES EMBED
    * Sends an embed with links to the bot's resources, including the GitHub repository and Supabase database dashboard.
    ? PARAMETERS:
    ? ctx - The context of the slash command.
    """
    try:
        # Log the receipt of the /source command
        logger.debug(f"Received /source command from {ctx.author.username}")

        # Create an embed containing resource links
        embed = interactions.Embed(
            title="📜 **Bot Resources**",
            description="Here are the links for the bot's resources:",
            color=0x00ff00,
        )
        embed.add_field(
            name="🖥️ GitHub Repository",
            value="[🔗 Click Here](https://github.com/doubleangels/Nova)",
            inline=False
        )
        embed.add_field(
            name="🗄️ Supabase Database",
            value="[🔗 Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)",
            inline=False
        )
        
        # Log that the embed was created successfully
        logger.debug(f"Successfully created bot resources embed for {ctx.author.username}.")

        # Send the embed as a response to the command
        await ctx.send(embeds=[embed])
    except Exception as e:
        # Log any exceptions and inform the user of an error
        logger.exception(f"Error in /source command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request.", ephemeral=True)

# -------------------------
# backupmode Slash Command
# -------------------------
@interactions.slash_command(
    name="backupmode",
    description="Configure and toggle backup mode for new members."
)
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
    description="Enable or disable auto-role assignment (leave empty to check status)",
    required=False,
    opt_type=interactions.OptionType.STRING,
    choices=[
        {"name": "Enabled", "value": "enabled"},
        {"name": "Disabled", "value": "disabled"}
    ]
)
async def backup_mode(ctx: interactions.ComponentContext, channel=None, role: interactions.Role = None, enabled: str = None):
    """
    ! CONFIGURE AND TOGGLE BACKUP MODE
    * Restricted to administrators. Updates backup mode settings (welcome channel, auto-role assignment role, enabled state)
    * when configuration options are provided, otherwise displays the current configuration.
    ? PARAMETERS:
    ? ctx     - The context of the slash command.
    ? channel - Optional channel where welcome messages will be sent.
    ? role    - Optional role to assign to new members.
    ? enabled - Optional string ("enabled" or "disabled") to toggle auto-role assignment.
    """
    try:
        # Check if any configuration options were provided.
        if channel or role or enabled is not None:
            # Ensure that the user has administrator permissions.
            if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /backupmode setup attempt by {ctx.author.username}")
                await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
                return

            logger.debug(f"Received /backupmode command from {ctx.author.username}")

            # Update the backup mode channel if provided.
            if channel:
                set_value("backup_mode_channel", channel.id)
                logger.debug(f"Backup mode channel set to {channel.name}")

            # Update the backup mode role if provided.
            if role:
                set_value("backup_mode_id", role.id)
                logger.debug(f"Backup mode role set to {role.id}")

            # Update the enabled status if provided.
            if enabled is not None:
                # Convert enabled string to boolean: "enabled" -> True, "disabled" -> False.
                is_enabled = True if enabled.lower() == "enabled" else False
                set_value("backup_mode_enabled", is_enabled)
                logger.debug(f"Backup mode {'enabled' if is_enabled else 'disabled'}")

            # Send confirmation of the updated configuration.
            await ctx.send(
                f"🔄 **Backup Mode Configured!**\n"
                f"📢 Welcome messages will be sent in {channel.name if channel else 'Not changed'}\n"
                f"🎭 New members will be assigned the role: {f'<@&{role.id}>' if role else 'Not changed'}\n"
                f"🔘 Auto-role assignment: {'✅ **Enabled**' if enabled and enabled.lower() == 'enabled' else ('❌ **Disabled**' if enabled and enabled.lower() == 'disabled' else 'Not changed')}"
            )
            return

        # If no configuration options were provided, perform a status check.
        logger.debug(f"Backup mode status check requested by {ctx.author.username}")
        channel_id = get_value("backup_mode_channel")
        role_id = get_value("backup_mode_id")
        enabled_status = get_value("backup_mode_enabled")

        # Retrieve the channel name from the guild.
        if channel_id:
            channel_obj = ctx.guild.get_channel(channel_id)
            channel_str = channel_obj.name if channel_obj else "Not set!"
        else:
            channel_str = "Not set!"

        # Format the role display string.
        role_str = f"<@&{role_id}>" if role_id else "Not set!"
        enabled_str = "✅ **Enabled**" if enabled_status else "❌ **Disabled**"

        # Build the summary message.
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

# -------------------------
# trollmode Slash Command
# -------------------------
@interactions.slash_command(
    name="trollmode",
    description="Toggle kicking of accounts younger than a specified age."
)
@interactions.slash_option(
    name="enabled",
    description="Enable or disable troll mode",
    required=True,
    opt_type=interactions.OptionType.STRING,
    choices=[
        {"name": "Enabled", "value": "enabled"},
        {"name": "Disabled", "value": "disabled"}
    ]
)
@interactions.slash_option(
    name="age",
    description="Minimum account age in days (Default: 30)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def toggle_troll_mode(ctx: interactions.ComponentContext, enabled: str, age: int = 30):
    """
    ! TOGGLE TROLL MODE
    * Restricted to administrators. When enabled, new accounts younger than the given age (in days) will be kicked.
    ? PARAMETERS:
    ? ctx     - The context of the slash command.
    ? enabled - A string value ("enabled" or "disabled") to toggle troll mode.
    ? age     - The minimum account age in days required to bypass kicking. Defaults to 30.
    """
    # Determine if troll mode should be enabled.
    is_enabled = True if enabled.lower() == "enabled" else False

    # Check if the user has administrator permissions.
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /trollmode attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return

    try:
        # Log the receipt and details of the command.
        logger.debug(f"Received /trollmode command from {ctx.author.username}")
        logger.debug(f"Troll mode toggle: {'Enabled' if is_enabled else 'Disabled'}, Minimum age: {age} days")

        # Update the configuration values in the database.
        set_value("troll_mode", is_enabled)
        set_value("troll_mode_account_age", age)

        # Build the response message based on whether troll mode is enabled or disabled.
        response_message = (
            f"👹 Troll mode has been ✅ **enabled**. Minimum account age: **{age}** days."
            if is_enabled else "👹 Troll mode has been ❌ **disabled**."
        )

        # Send the response message to the user.
        await ctx.send(response_message)
        logger.debug(f"Troll mode {'enabled' if is_enabled else 'disabled'} by {ctx.author.username}; account age threshold = {age} days.")
    except Exception as e:
        # Log any errors and send an error message to the user.
        logger.exception(f"Error in /trollmode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling troll mode. Please try again later.", ephemeral=True)

# -------------------------
# google Slash Command
# -------------------------
@interactions.slash_command(
    name="google",
    description="Search Google and return the top results."
)
@interactions.slash_option(
    name="query",
    description="What do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
@interactions.slash_option(
    name="results",
    description="How many results do you want? (1-10, Default: 5)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def google_search(ctx: interactions.ComponentContext, query: str, results: int = 5):
    """
    ! SEARCH GOOGLE
    * Uses the Custom Search API to search Google and returns the top search results as embeds.
    ? PARAMETERS:
    ? ctx     - The context of the slash command.
    ? query   - The search query provided by the user.
    ? results - The number of search results to return (must be between 1 and 10, defaults to 5).
    """
    try:
        # Defer the response to allow time for processing.
        await ctx.defer()
        logger.debug(f"Received /google command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}', requested results: {results}")

        # Format the query (capitalized) and ensure the results count is within the valid range.
        formatted_query = query.title()
        results = max(1, min(results, 10))
        logger.debug(f"Formatted query: '{formatted_query}', adjusted results: {results}")

        # Define the Google Custom Search API URL and parameters.
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": SEARCH_ENGINE_ID,
            "q": query,
            "num": results
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        # Make the API request using an asynchronous HTTP session.
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    # Parse the JSON response from the API.
                    data = await response.json()
                    logger.debug(f"Received Google Search data: {json.dumps(data, indent=2)}")

                    # Check if search results were returned.
                    if "items" in data and data["items"]:
                        embeds = []
                        # Loop through each search result and create an embed.
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

                        # Send the embeds if there are any search results.
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

# -------------------------
# googleimage Slash Command
# -------------------------
@interactions.slash_command(
    name="googleimage",
    description="Search Google for images and return the top results."
)
@interactions.slash_option(
    name="query",
    description="What images do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
@interactions.slash_option(
    name="results",
    description="How many results do you want? (1-10, Default: 5)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def google_image_search(ctx: interactions.ComponentContext, query: str, results: int = 5):
    """
    ! SEARCH GOOGLE FOR IMAGES
    * Uses the Custom Search API to find images for the provided query and returns the top results as embeds.
    ? PARAMETERS:
    ? ctx     - The context of the slash command.
    ? query   - The search query provided by the user.
    ? results - The number of image results to return (between 1 and 10, defaults to 5).
    """
    try:
        # Defer the response to allow time for processing.
        await ctx.defer()
        logger.debug(f"Received /googleimage command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}', requested results: {results}")

        # Format the query (capitalize words) and clamp the results count between 1 and 10.
        formatted_query = query.title()
        results = max(1, min(results, 10))
        logger.debug(f"Formatted query: '{formatted_query}', adjusted results: {results}")

        # Set up the Google Custom Search API URL and parameters for an image search.
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": IMAGE_SEARCH_ENGINE_ID,
            "q": query,
            "searchType": "image",  # Specify image search.
            "num": results
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        # Make the API request using an asynchronous HTTP session.
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    # Parse the JSON response.
                    data = await response.json()
                    logger.debug(f"Received Google Image data: {json.dumps(data, indent=2)}")

                    # Check if any image items were returned.
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            # Extract the title, image URL, and the context (page) link.
                            title = item.get("title", "No Title")
                            image_link = item.get("link", "")
                            page_link = item.get("image", {}).get("contextLink", image_link)
                            logger.debug(f"Extracted Image - Title: {title}, Image Link: {image_link}")

                            # Create an embed for each image result.
                            embed = interactions.Embed(
                                title=f"🖼️ **{title}**",
                                description=f"🔗 **[View Image]({image_link})**",
                                color=0x1A73E8
                            )
                            embed.set_image(url=image_link)
                            embed.set_footer(text="Powered by Google Image Search")
                            embeds.append(embed)

                        # Send the embeds if available, otherwise inform the user.
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

# -------------------------
# youtube Slash Command
# ------------------------- 
@interactions.slash_command(
    name="youtube",
    description="Search YouTube for videos and return the top result."
)
@interactions.slash_option(
    name="query",
    description="What videos do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def youtube_video_search(ctx: interactions.ComponentContext, query: str):
    """
    ! SEARCH YOUTUBE FOR VIDEOS
    * Uses the YouTube Data API: Takes a search query, fetches the top video, and constructs an embed with the video's title,
    * description, and thumbnail.
    ? PARAMETERS:
    ? ctx   - The context of the slash command.
    ? query - The search query provided by the user.
    """
    try:
        # Defer the response to allow for processing time.
        await ctx.defer()
        logger.debug(f"Received /youtube command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}'")
        
        # Format the query for display purposes.
        formatted_query = query.title()
        logger.debug(f"Formatted query: '{formatted_query}'")

        # Define the YouTube Data API endpoint and parameters.
        search_url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            "key": GOOGLE_API_KEY,
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": 1  # Return only the top result.
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        # Make the API request using an asynchronous HTTP session.
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    # Parse the JSON response.
                    data = await response.json()
                    logger.debug(f"Received YouTube data: {json.dumps(data, indent=2)}")

                    # Check if any video items were returned.
                    if "items" in data and data["items"]:
                        item = data["items"][0]
                        video_id = item["id"].get("videoId", "")
                        snippet = item["snippet"]
                        title = snippet.get("title", "No Title")
                        description = snippet.get("description", "No Description")
                        # Get the high-quality thumbnail if available.
                        thumbnail = snippet.get("thumbnails", {}).get("high", {}).get("url", "")
                        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else "N/A"
                        logger.debug(f"Extracted YouTube Video - Title: {title}, Video ID: {video_id}")

                        # Create an embed to display the video information.
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
                        
                        # Send the embed to the user.
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

# -------------------------
# wikipedia Slash Command
# -------------------------
@interactions.slash_command(
    name="wikipedia",
    description="Search Wikipedia for articles and return the top result."
)
@interactions.slash_option(
    name="query",
    description="What topic do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def wikipedia_search(ctx: interactions.ComponentContext, query: str):
"""
    ! SEARCH WIKIPEDIA FOR A TOPIC
    * Defers the response, sends a request to Wikipedia with the provided query, processes the search results,
    * and constructs an embed with the article's title, snippet, and link.
    ? PARAMETERS:
    ? ctx   - The context of the slash command.
    ? query - The topic to search for on Wikipedia.
    """
    try:
        # Defer the response to allow for processing time.
        await ctx.defer()
        logger.debug(f"Received /wikipedia command from {ctx.author.username}")
        logger.debug(f"User input for query: '{query}'")

        # Format the query for display purposes.
        formatted_query = query.title()
        logger.debug(f"Formatted query: '{formatted_query}'")

        # Set up the Wikipedia API URL and parameters.
        search_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": query,
            "utf8": 1
        }
        logger.debug(f"Making API request to: {search_url} with params {params}")

        # Perform the API request using an asynchronous HTTP session.
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    # Parse the JSON response from Wikipedia.
                    data = await response.json()
                    logger.debug(f"Received Wikipedia data: {json.dumps(data, indent=2)}")

                    # Check if the response contains search results.
                    if data.get("query", {}).get("search"):
                        # Get the top search result.
                        top_result = data["query"]["search"][0]
                        title = top_result.get("title", "No Title")
                        snippet = top_result.get("snippet", "No snippet available.")

                        # Replace HTML span tags used for highlighting with markdown bold syntax.
                        snippet = snippet.replace("<span class=\"searchmatch\">", "**").replace("</span>", "**")
                        page_id = top_result.get("pageid")
                        wiki_url = f"https://en.wikipedia.org/?curid={page_id}"

                        logger.debug(f"Extracted Wikipedia Data - Title: {title}, Page ID: {page_id}")

                        # Create an embed to display the Wikipedia result.
                        embed = interactions.Embed(
                            title=f"📖 **{title}**",
                            description=f"📜 **Summary:** {snippet}",
                            url=wiki_url,
                            color=0xFFFFFF
                        )
                        embed.add_field(name="🔗 Wikipedia Link", value=f"[Click Here]({wiki_url})", inline=False)
                        embed.set_footer(text="Powered by Wikipedia API")

                        # Send the embed with the top search result.
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

# -------------------------
# imdb Slash Command
# -------------------------
@interactions.slash_command(
    name="imdb",
    description="Search for a movie or TV show on IMDB."
)
@interactions.slash_option(
    name="title",
    description="Enter the movie or TV show title.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def imdb_search(ctx: interactions.ComponentContext, title: str):
    """
    ! SEARCH FOR A MOVIE OR TV SHOW ON IMDB
    * Uses the OMDb API: Takes a title as input, makes an API request, and creates an embed with details including
    * the title, year, genre, IMDb rating, plot, poster image, and a link to IMDb.
    ? PARAMETERS:
    ? ctx   - The context of the slash command.
    ? title - The movie or TV show title to search for.
    """
    try:
        # Defer the response to allow for processing time.
        await ctx.defer()
        logger.debug(f"Received /imdb command from {ctx.author.username}")
        logger.debug(f"User input for title: '{title}'")

        # Format the title for display purposes.
        formatted_title = title.title()
        logger.debug(f"Formatted title: '{formatted_title}'")

        # Define the OMDb API endpoint and parameters.
        search_url = "http://www.omdbapi.com/"
        params = {"t": title, "apikey": OMDB_API_KEY}
        logger.debug(f"Making API request to: {search_url} with params {params}")

        # Make the API request using an asynchronous HTTP session.
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")
                if response.status == 200:
                    # Parse the JSON response.
                    data = await response.json()
                    logger.debug(f"Received IMDb data: {json.dumps(data, indent=2)}")

                    # Check if the API response is successful.
                    if data.get("Response") == "True":
                        # Extract relevant data from the API response.
                        title = data.get("Title", "Unknown")
                        year = data.get("Year", "Unknown")
                        genre = data.get("Genre", "Unknown")
                        imdb_rating = data.get("imdbRating", "N/A")
                        plot = data.get("Plot", "No plot available.")
                        poster = data.get("Poster", None)
                        imdb_id = data.get("imdbID", None)
                        imdb_link = f"https://www.imdb.com/title/{imdb_id}" if imdb_id else "N/A"
                        logger.debug(f"Extracted IMDb Data - Title: {title}, Year: {year}, Genre: {genre}, IMDb Rating: {imdb_rating}")

                        # Create an embed with the movie/TV show details.
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

                        # Send the embed as the response.
                        await ctx.send(embed=embed)
                    else:
                        logger.warning(f"No results found for title: '{formatted_title}'.")
                        await ctx.send(f"❌ No results found for '**{formatted_title}**'. Try another title!")
                else:
                    logger.warning(f"OMDb API error: {response.status}")
                    await ctx.send(f"⚠️ Error: OMDb API returned status code {response.status}.")
    except Exception as e:
        # Log any exceptions and notify the user of an error.
        logger.exception(f"Error in /imdb command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# weather Slash Command
# -------------------------
@interactions.slash_command(
    name="weather",
    description="Get the current weather for a place."
)
@interactions.slash_option(
    name="place",
    description="Enter the place name.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
@interactions.slash_option(
    name="private",
    description="Keep your location private? (Yes/No)",
    required=False,
    opt_type=interactions.OptionType.STRING,
    choices=[
        {"name": "Yes", "value": "yes"},
        {"name": "No", "value": "no"}
    ]
)
async def weather_search(ctx: interactions.ComponentContext, place: str, private: str = "no"):
    """
    ! GET CURRENT WEATHER FOR A GIVEN PLACE
    * Retrieves coordinates using the `get_coordinates` helper, fetches current weather and a 3-day forecast
    * from the PirateWeather API, and sends the results in an embed. If `private` is set to "Yes",
    * location details (place name, latitude, longitude) are omitted.
    ? PARAMETERS:
    ? ctx     - The context of the slash command.
    ? place   - The place name for which to retrieve the weather.
    ? private - (Optional) "yes" to hide location details, "no" (default) to show them.
    """
    try:
        # Defer the response to allow time for processing.
        await ctx.defer()
        logger.debug(f"Received weather command from {ctx.author.username}")
        logger.debug(f"User input for city: '{place}'")

        # Retrieve the latitude and longitude for the given place.
        lat, lon = await get_coordinates(place)
        if lat is None or lon is None:
            logger.warning(f"Failed to get coordinates for '{place}'.")
            await ctx.send(f"Could not find the location for '{place}'. Try another city.")
            return

        # Format the place name.
        formatted_place = place.title()
        logger.debug(f"Formatted city name: '{formatted_place}' (Lat: {lat}, Lon: {lon})")

        # Construct the API URL and parameters for PirateWeather.
        url = f"https://api.pirateweather.net/forecast/{PIRATEWEATHER_API_KEY}/{lat},{lon}"
        params = {"units": "si"}
        logger.debug(f"Making API request to: {url} with params {params}")

        # Make the API request using an asynchronous HTTP session.
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Received weather data: {json.dumps(data, indent=2)}")

                    # Extract current weather and daily forecast details.
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

                    # Build a 3-day forecast string.
                    forecast_text = ""
                    for i in range(3):
                        day = daily[i]
                        day_summary = day.get("summary", "No data")
                        high_c = day.get("temperatureHigh", "N/A")
                        high_f = round((high_c * 9/5) + 32, 1) if isinstance(high_c, (int, float)) else "N/A"
                        low_c = day.get("temperatureLow", "N/A")
                        low_f = round((low_c * 9/5) + 32, 1) if isinstance(low_c, (int, float)) else "N/A"
                        forecast_text += f"**Day {i+1}:** {day_summary}\n🌡 High: {high_c}°C / {high_f}°F, Low: {low_c}°C / {low_f}°F\n\n"

                    logger.debug(f"Extracted weather data for {formatted_place}: Temp {temp_c}°C, Feels Like {feels_like_c}°C, Humidity {humidity}%")

                    # Create the weather embed.
                    embed = interactions.Embed(
                        title=f"Weather in {formatted_place}",
                        description=f"**{weather}**",
                        color=0xFF6E42
                    )

                    # Add location field only if private is not set to "yes".
                    if private.lower() != "yes":
                        embed.add_field(name="🌍 Location", value=f"📍 {formatted_place}\n📍 Lat: {lat}, Lon: {lon}", inline=False)

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

                    # Send the embed with weather details.
                    await ctx.send(embed=embed)
                else:
                    logger.warning(f"PirateWeather API error: {response.status}")
                    await ctx.send(f"Error: PirateWeather API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /weather command: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# urban Slash Command
# -------------------------
@interactions.slash_command(
    name="urban",
    description="Search Urban Dictionary for definitions."
)
@interactions.slash_option(
    name="query",
    description="What term do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def urban_dictionary_search(ctx: interactions.ComponentContext, query: str):
    """
    ! SEARCH URBAN DICTIONARY FOR A TERM
    * Sends a search query to the Urban Dictionary API, processes returned definitions, and creates an embed
    * with the word, definition, example usage, and thumbs up/down counts.
    ? PARAMETERS:
    ? ctx   - The context of the slash command.
    ? query - The term to search for on Urban Dictionary.
    """
    try:
        # Log the search request.
        logger.debug(f"User '{ctx.author.username}' searched for '{query}' on Urban Dictionary.")
        # Defer the response to allow for processing time.
        await ctx.defer()

        # Set up the Urban Dictionary API endpoint and parameters.
        search_url = "https://api.urbandictionary.com/v0/define"
        params = {"term": query}
        
        # Make an asynchronous HTTP request to Urban Dictionary.
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    # Parse the JSON response.
                    data = await response.json()
                    # Check if any definitions were returned.
                    if data.get("list"):
                        top_result = data["list"][0]
                        word = top_result.get("word", "No Word")
                        # Clean up the definition and example strings.
                        definition = top_result.get("definition", "No Definition Available.").replace("\r\n", "\n")
                        example = top_result.get("example", "").replace("\r\n", "\n") or "No example available."
                        thumbs_up = top_result.get("thumbs_up", 0)
                        thumbs_down = top_result.get("thumbs_down", 0)
                        logger.debug(f"Found definition for '{word}': {definition} ({thumbs_up}/{thumbs_down})")
                        
                        # Create an embed to display the definition.
                        embed = interactions.Embed(
                            title=f"📖 Definition: {word}",
                            description=definition,
                            color=0x1D2439
                        )
                        embed.add_field(name="📝 Example", value=example, inline=False)
                        embed.add_field(name="👍 Thumbs Up", value=str(thumbs_up), inline=True)
                        embed.add_field(name="👎 Thumbs Down", value=str(thumbs_down), inline=True)
                        embed.set_footer(text="🔍 Powered by Urban Dictionary")
                        
                        # Send the embed to the user.
                        await ctx.send(embed=embed)
                    else:
                        logger.debug(f"No definitions found for '{query}'.")
                        await ctx.send("⚠️ No definitions found for your query. Try refining it.")
                else:
                    logger.warning(f"Urban Dictionary API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Urban Dictionary API returned status code {response.status}.")
    except Exception as e:
        # Log any exceptions and notify the user with an error message.
        logger.exception(f"Error in /urban command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# anime Slash Command
# -------------------------
@interactions.slash_command(
    name="anime",
    description="Search for an anime on MyAnimeList."
)
@interactions.slash_option(
    name="title",
    description="Enter the anime title.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def anime_search(ctx: interactions.ComponentContext, title: str):
    """
    ! SEARCH FOR AN ANIME
    * Uses the MyAnimeList API to search for an anime.
    ? PARAMETERS:
    ? title - The anime title to search for.
    """
    try:
        # Defer the response to allow time for processing.
        await ctx.defer()
        logger.debug(f"Received /anime command from {ctx.author.username}")
        logger.debug(f"User input for title: '{title}'")

        # Format the title for display purposes.
        formatted_title = title.title()
        logger.debug(f"Formatted title: '{formatted_title}'")

        # Construct the search URL for MyAnimeList API.
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

                                # Create an embed with the retrieved anime details.
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
        logger.exception(f"Error in /anime command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# cat Slash Command
# -------------------------
@interactions.slash_command(
    name="cat",
    description="Get a random cat picture!"
)
async def cat_image(ctx: interactions.ComponentContext):
    """
    ! FETCH AND SEND A RANDOM CAT IMAGE
    * Uses the Cataas API to retrieve a random cat image, reads the image bytes, creates an in-memory file,
    * and sends the image as an attachment within an embed.
    ? PARAMETERS:
    ? ctx - The context of the slash command.
    """
    try:
        # Defer the response to allow time for processing.
        await ctx.defer()

        # Build the URL with a timestamp to avoid caching issues.
        cat_api_url = f"https://cataas.com/cat?timestamp={int(time.time())}"
        logger.debug(f"Fetching cat image from {cat_api_url}")

        # Create an asynchronous HTTP session to fetch the cat image.
        async with aiohttp.ClientSession() as session:
            async with session.get(cat_api_url) as response:
                if response.status == 200:
                    # Read the image bytes from the response.
                    image_bytes = await response.read()
                    
                    # Create a BytesIO object to hold the image data.
                    file_obj = io.BytesIO(image_bytes)
                    file_obj.seek(0)
                    filename = "cat.jpg"
                    
                    # Create an interactions.File object with the image data.
                    file = interactions.File(file_name=filename, file=file_obj)
                    
                    # Build the embed that will display the cat image.
                    embed = interactions.Embed(
                        title="Random Cat Picture",
                        description="😺 Here's a cat for you!",
                        color=0xD3D3D3
                    )
                    embed.set_image(url=f"attachment://{filename}")
                    embed.set_footer(text="Powered by Cataas API")
                    
                    # Send the embed and the file as an attachment.
                    await ctx.send(embeds=[embed], files=[file])
                else:
                    logger.warning(f"Cataas API error: {response.status}")
                    await ctx.send("😿 Couldn't fetch a cat picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /cat command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# dog Slash Command
# -------------------------
@interactions.slash_command(
    name="dog",
    description="Get a random dog picture!"
)
async def dog_image(ctx: interactions.ComponentContext):
    """
    ! FETCH AND SEND A RANDOM DOG IMAGE
    * Uses the Dog CEO API to retrieve a random dog image URL, fetches the image data, creates an in-memory file,
    * builds an embed, and sends the image as an attachment along with the embed.
    ? PARAMETERS:
    ? ctx - The context of the slash command.
    """
    try:
        # Defer the response to allow time for processing.
        await ctx.defer()
        dog_api_url = "https://dog.ceo/api/breeds/image/random"
        logger.debug(f"Fetching random dog image data from {dog_api_url}")
        
        # Create an asynchronous HTTP session to make the API request.
        async with aiohttp.ClientSession() as session:
            async with session.get(dog_api_url) as response:
                if response.status == 200:
                    # Parse the JSON response.
                    data = await response.json()
                    image_url = data.get("message", None)
                    
                    if image_url:
                        # Append a timestamp to the image URL to prevent caching.
                        image_url_with_timestamp = f"{image_url}?timestamp={int(time.time())}"
                        logger.debug(f"Fetching dog image from {image_url_with_timestamp}")
                        
                        # Fetch the actual image file.
                        async with session.get(image_url_with_timestamp) as image_response:
                            if image_response.status == 200:
                                # Read the image bytes.
                                image_bytes = await image_response.read()
                                file_obj = io.BytesIO(image_bytes)
                                file_obj.seek(0)
                                filename = "dog.jpg"
                                
                                # Create a file object to send as an attachment.
                                file = interactions.File(file_name=filename, file=file_obj)
                                
                                # Build the embed to display the dog image.
                                embed = interactions.Embed(
                                    title="Random Dog Picture",
                                    description="🐶 Here's a doggo for you!",
                                    color=0xD3D3D3
                                )
                                embed.set_image(url=f"attachment://{filename}")
                                embed.set_footer(text="Powered by Dog CEO API")
                                
                                # Send the embed along with the image file.
                                await ctx.send(embeds=[embed], files=[file])
                            else:
                                logger.warning(f"Error fetching dog image file: {image_response.status}")
                                await ctx.send("🐶 Couldn't fetch a dog picture. Try again later.")
                    else:
                        logger.warning("No dog image URL found in the API response.")
                        await ctx.send("🐶 Couldn't find a dog picture. Try again later.")
                else:
                    logger.warning(f"Dog CEO API error: {response.status}")
                    await ctx.send("🐕 Couldn't fetch a dog picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /dog command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# timezone Slash Command
# -------------------------
@interactions.slash_command(
    name="timezone",
    description="Get the current time in a place."
)
@interactions.slash_option(
    name="place",
    description="Enter a place name.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def timezone_lookup(ctx: interactions.ComponentContext, place: str):
    """
    ! GET CURRENT LOCAL TIME FOR A GIVEN PLACE
    * Uses Google APIs: Converts the place name into geographic coordinates via the Google Geocoding API, retrieves timezone 
    * info with the Google Time Zone API, calculates the current local time, and sends an embed with the time, timezone, UTC offset, and DST status.
    ? PARAMETERS:
    ? ctx   - The context of the slash command.
    ? place - The place name to lookup the current time for.
    """
    try:
        # Defer the response to allow processing time.
        await ctx.defer()
        logger.debug(f"Received /timezone command for city: '{place}'")
        
        # Initialize an HTTP session.
        async with aiohttp.ClientSession() as session:
            # Build URL and parameters for the Google Geocoding API.
            geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
            geocode_params = {"address": place, "key": GOOGLE_API_KEY}
            async with session.get(geocode_url, params=geocode_params) as response:
                if response.status == 200:
                    geo_data = await response.json()
                    logger.debug(f"Received Google Geocoding API response: {json.dumps(geo_data, indent=2)}")
                    
                    # Check if any results were returned.
                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        await ctx.send(f"❌ Could not find the city '{place}'. Check spelling.")
                        return
                else:
                    await ctx.send("⚠️ Google Geocoding API error. Try again later.")
                    return

            # Get current timestamp for timezone lookup.
            timestamp = int(datetime.datetime.now().timestamp())
            # Build URL and parameters for the Google Time Zone API.
            timezone_url = "https://maps.googleapis.com/maps/api/timezone/json"
            timezone_params = {"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}
            async with session.get(timezone_url, params=timezone_params) as response:
                if response.status == 200:
                    tz_data = await response.json()
                    logger.debug(f"Received Google Time Zone API response: {json.dumps(tz_data, indent=2)}")
                    
                    # Check if the API call was successful.
                    if tz_data.get("status") == "OK":
                        timezone_name = tz_data["timeZoneId"]
                        raw_offset = tz_data["rawOffset"] / 3600  # convert seconds to hours
                        dst_offset = tz_data["dstOffset"] / 3600      # convert seconds to hours
                        utc_offset = raw_offset + dst_offset
                        is_dst = "Yes" if dst_offset > 0 else "No"
                        
                        # Calculate local time by adding the UTC offset to current UTC time.
                        current_utc_time = datetime.datetime.now(datetime.timezone.utc)
                        local_time = current_utc_time + datetime.timedelta(hours=utc_offset)
                        formatted_time = local_time.strftime("%Y-%m-%d %H:%M:%S")
                        
                        # Build the embed with the time details.
                        embed = interactions.Embed(
                            title=f"🕒 Current Time in {place.title()}",
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
                    await ctx.send("⚠️ Google Time Zone API error. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /timezone command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# timedifference Slash Command
# -------------------------
@interactions.slash_command(
    name="timedifference",
    description="Get the time difference between two places."
)
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
@interactions.slash_option(
    name="private",
    description="Keep the city names private? (Yes/No)",
    required=False,
    opt_type=interactions.OptionType.STRING,
    choices=[
        {"name": "Yes", "value": "yes"},
        {"name": "No", "value": "no"}
    ]
)
async def time_difference(ctx: interactions.ComponentContext, place1: str, place2: str, private: str = "no"):
    """
    ! CALCULATE TIME DIFFERENCE BETWEEN TWO CITIES
    * Uses Google Maps Time Zone API: Retrieves geographic coordinates via the Google Geocoding API,
    * then looks up timezone info via the Google Time Zone API, computes the absolute time difference,
    * and outputs the result. City names are omitted if the private option is set to "Yes".
    ? PARAMETERS:
    ? ctx    - The context of the slash command.
    ? place1 - The first city.
    ? place2 - The second city.
    ? private - (Optional) "yes" to hide the city names in the output, "no" (default) to display them.
    """
    try:
        # Defer the response to allow for processing time.
        await ctx.defer()
        logger.debug(f"Received /timedifference command: '{place1}' and '{place2}' with private={private}")

        async def get_utc_offset(city: str):
            """
            ! HELPER FUNCTION: Retrieve UTC offset for a given city.
            * Uses the Google Geocoding API to get latitude and longitude, then the Google Time Zone API to compute the UTC offset.
            ? PARAMETERS:
            ? city - The city name to lookup.
            ? RETURNS:
            ? Total UTC offset in hours, or None if retrieval fails.
            """
            geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
            timezone_url = "https://maps.googleapis.com/maps/api/timezone/json"
            async with aiohttp.ClientSession() as session:
                # Get geographic coordinates for the city.
                async with session.get(geocode_url, params={"address": city, "key": GOOGLE_API_KEY}) as response:
                    geo_data = await response.json()
                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        return None
                # Get timezone info using the coordinates.
                timestamp = int(datetime.datetime.now().timestamp())
                async with session.get(timezone_url, params={"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}) as response:
                    tz_data = await response.json()
                    if tz_data.get("status") == "OK":
                        raw_offset = tz_data["rawOffset"] / 3600
                        dst_offset = tz_data["dstOffset"] / 3600
                        return raw_offset + dst_offset
                    else:
                        return None

        # Retrieve UTC offsets for both cities.
        offset1 = await get_utc_offset(place1)
        offset2 = await get_utc_offset(place2)

        if offset1 is None or offset2 is None:
            await ctx.send(f"❌ Could not retrieve timezones for '{place1}' or '{place2}'.")
            return

        # Calculate the absolute time difference.
        time_diff = abs(offset1 - offset2)

        # Format the output based on the privacy option.
        if private.lower() == "yes":
            message = f"⏳ The time difference is **{time_diff} hours**."
        else:
            message = (
                f"⏳ The time difference between **{place1.title()}** and **{place2.title()}** "
                f"is **{time_diff} hours**."
            )

        # Send the result.
        await ctx.send(message)
    except Exception as e:
        logger.exception(f"Error in /timedifference command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# warp Slash Command
# -------------------------
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
        {"name": "Bulge", "value": "bulge"},
        {"name": "Ripple", "value": "ripple"},
        {"name": "Fisheye", "value": "fisheye"}
    ]
)
@interactions.slash_option(
    name="strength",
    description="Warp strength (0-6, Default: 6).",
    required=False,
    opt_type=interactions.OptionType.INTEGER,
    min_value=0,
    max_value=6
)
async def warp(ctx: interactions.ComponentContext, user: interactions.User, mode: str, strength: int = 6):
    """
    ! APPLY WARP EFFECT
    * Downloads the target user's profile picture, applies the selected warp effect with the given strength,
    * and returns the modified image.
    ? PARAMETERS:
    ? ctx       - The context of the slash command.
    ? user      - The target user whose profile picture will be warped.
    ? mode      - The warp mode to apply ("swirl", "bulge", "ripple", or "fisheye").
    ? strength  - The intensity of the warp effect (from 0 to 6). If set to 0, the original image is returned.
    """
    await ctx.defer()
    logger.info(f"Received /warp command from {ctx.author.username} for {user.username}")
    logger.info(f"Mode: {mode}, Strength: {strength}")
    
    try:
        # Retrieve the target user's avatar URL.
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

        # Open the image using PIL and convert it to RGB.
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        width, height = img.size
        img_np = np.array(img)
        logger.debug(f"Image dimensions: {width}x{height}")

        # If strength is 0, return the original image.
        if strength == 0:
            output_buffer = io.BytesIO()
            img.save(output_buffer, format="PNG")
            output_buffer.seek(0)
            file = interactions.File(file_name="original.png", file=output_buffer)
            await ctx.send(files=[file])
            logger.info("Sent unmodified image (Strength 0)")
            return

        # Determine the warp effect parameters.
        center_x, center_y = width // 2, height // 2
        strength_map = {0: 0, 1: 0.05, 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.5, 6: 0.7}
        effect_strength = strength_map.get(strength, 0.3)
        effect_radius = min(width, height) // 2
        logger.debug(f"Warp Center: ({center_x}, {center_y}), Effect Strength: {effect_strength}")

        # Create a coordinate grid.
        x_coords, y_coords = np.meshgrid(np.arange(width), np.arange(height))
        dx = x_coords - center_x
        dy = y_coords - center_y
        distance = np.sqrt(dx**2 + dy**2)
        angle = np.arctan2(dy, dx)

        # Apply the selected warp effect.
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
        elif mode == "ripple":
            logger.info("Applying ripple effect.")
            wavelength = effect_radius / 5
            amplitude = effect_strength * effect_radius * 0.1
            new_x_coords = (x_coords + amplitude * np.sin(2 * np.pi * y_coords / wavelength)).astype(int)
            new_y_coords = (y_coords + amplitude * np.sin(2 * np.pi * x_coords / wavelength)).astype(int)
        elif mode == "fisheye":
            logger.info("Applying fisheye effect.")
            norm_x = (x_coords - center_x) / effect_radius
            norm_y = (y_coords - center_y) / effect_radius
            r = np.sqrt(norm_x**2 + norm_y**2)
            r_safe = np.where(r == 0, 1e-6, r)
            theta = np.arctan(r * effect_strength * 2)
            factor = np.where(r > 0, theta / r_safe, 1)
            new_x_coords = (center_x + norm_x * factor * effect_radius).astype(int)
            new_y_coords = (center_y + norm_y * factor * effect_radius).astype(int)
        else:
            logger.warning(f"Invalid warp mode: {mode}")
            await ctx.send("❌ Invalid warp mode selected.", ephemeral=True)
            return

        # Ensure the new coordinates are within image bounds.
        new_x_coords = np.clip(new_x_coords, 0, width - 1)
        new_y_coords = np.clip(new_y_coords, 0, height - 1)
        
        # Create the warped image from the modified coordinates.
        warped_img_np = img_np[new_y_coords, new_x_coords]
        warped_img = Image.fromarray(warped_img_np)
        output_buffer = io.BytesIO()
        warped_img.save(output_buffer, format="PNG")
        output_buffer.seek(0)
        
        # Prepare the file to send.
        file = interactions.File(file=output_buffer, file_name=f"{mode}_warp.png")
        await ctx.send(files=[file])
        logger.info(f"Successfully applied {mode} effect with strength {strength} for {user.username}!")
    except Exception as e:
        logger.error(f"Error in /warp command: {e}", exc_info=True)
        await ctx.send("⚠️ An error occurred while processing the image. Please try again later.", ephemeral=True)
