import interactions
import asyncio
import os
import datetime
import pytz
import uuid
import sys
import signal
import logging
import json
import aiohttp
import time
import sentry_sdk
from supabase import create_client, Client
from sentry_sdk.integrations.logging import LoggingIntegration

# -------------------------
# Sentry Setup with Logging Integration
# -------------------------
sentry_logging = LoggingIntegration(
    level=logging.DEBUG,        # Capture info and above as breadcrumbs
    event_level=logging.ERROR  # Send errors as events
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
# Set log level from environment variable (default is INFO)
LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG").upper()

logger = logging.getLogger("Nova")
logger.setLevel(LOG_LEVEL)

# Enhanced formatter: includes timestamp, logger name, level, filename, and line number.
log_format = "%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"
formatter = logging.Formatter(log_format)

# Console handler: logs to stdout only.
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

missing_vars = [key for key, value in required_env_vars.items() if not value]
if missing_vars:
    for var in missing_vars:
        logger.error(f"{var} not found in environment variables.")
    sys.exit(1)

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
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------
# "config" Table Helpers
# -------------------------
def get_value(key: str):
    """
    Retrieve a JSON value from the 'config' table in Supabase using the provided key.
    Returns None if there's an error or no data is found.
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
    Returns a dictionary if found, otherwise None.
    """
    try:
        response = supabase.table("reminders").select("reminder_data").eq("key", key).maybe_single().execute()
        if response and response.data:
            reminder_data = response.data.get("reminder_data")
            if reminder_data:
                return json.loads(reminder_data)
        return None
    except Exception:
        logger.exception(f"Error getting reminder data for key '{key}'.")
        return None

def set_reminder_data(key: str, data: dict):
    """
    Upsert a JSON value in the 'reminders' table in Supabase.
    """
    try:
        serialized = json.dumps(data)
        existing = get_reminder_data(key)
        if existing is None:
            supabase.table("reminders").insert({"key": key, "reminder_data": serialized}).execute()
            logger.debug(f"Inserted new reminder entry for key '{key}'.")
        else:
            supabase.table("reminders").update({"reminder_data": serialized}).eq("key", key).execute()
            logger.debug(f"Updated reminder entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting reminder data for key '{key}'.")

def delete_reminder_data(key: str):
    """
    Delete reminder data from the 'reminders' table in Supabase for the given key.
    """
    try:
        supabase.table("reminders").delete().eq("key", key).execute()
        logger.debug(f"Deleted reminder data for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting reminder data for key '{key}'.")

def initialize_reminders_table():
    """
    Ensures that each known reminder key has a default row in the 'reminders' table.
    """
    default_keys = ["disboard", "discadia", "dsme", "unfocused"]
    for k in default_keys:
        existing = get_reminder_data(k)
        if existing is None:
            default_data = {
                "state": False,
                "scheduled_time": None,
                "reminder_id": None
            }
            set_reminder_data(k, default_data)
            logger.debug(f"Inserted default reminder_data for key: {k}")

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

bot_ids = {
    "302050872383242240": "Disboard",
    "1222548162741538938": "Discadia",
    "493224032167002123": "DS.me",
    "835255643157168168": "Unfocused",
}

logger.info("Starting the bot...")

import signal
import sys
import datetime
import asyncio
import aiohttp
import pytz

def handle_interrupt(signal_num, frame):
    """
    Handles shutdown signals (SIGINT, SIGTERM) gracefully.
    """
    logger.info("⚠️ Gracefully shutting down.")
    sys.exit(0)

signal.signal(signal.SIGINT, handle_interrupt)
signal.signal(signal.SIGTERM, handle_interrupt)

def get_role():
    """
    Fetch the role ID stored in the 'role' key from Supabase.
    """
    try:
        role = get_value("role")
        if not role:
            logger.warning("⚠️ No role has been set up for reminders.")
            return None
        logger.debug(f"🎭 Retrieved reminder role: {role}")
        return role
    except Exception as e:
        logger.exception(f"⚠️ Error while fetching the reminder role: {e}")
        return None

async def get_channel(channel_key):
    """
    Given a key, fetch its channel ID from Supabase and return the channel object.
    """
    try:
        channel_id = get_value(channel_key)
        if not channel_id:
            logger.warning(f"⚠️ No channel has been set for '{channel_key}'.")
            return None
        logger.debug(f"📢 Retrieved reminder channel: {channel_id}")
        return bot.get_channel(channel_id)
    except Exception as e:
        logger.exception(f"⚠️ Error while fetching the reminder channel: {e}")
        return None

def calculate_remaining_time(scheduled_time):
    """
    Calculate the remaining time until the scheduled time.
    """
    if not scheduled_time:
        return "⏳ Not set!"
    try:
        now = datetime.datetime.now(tz=pytz.UTC)
        scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
        remaining_time = scheduled_dt - now
        if remaining_time <= datetime.timedelta(seconds=0):
            return "⏰ Expired!"
        hours, remainder = divmod(int(remaining_time.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        time_str = f"{hours:02}:{minutes:02}:{seconds:02}"
        logger.debug(f"🕒 Remaining time calculated: {time_str}")
        return time_str
    except Exception as e:
        logger.exception(f"⚠️ Error calculating remaining time: {e}")
        return "⚠️ Error calculating time!"

async def safe_task(task):
    """
    Run tasks safely by catching exceptions.
    """
    try:
        await task
    except Exception as e:
        logger.exception(f"⚠️ Exception in scheduled task: {e}")

async def reschedule_reminder(key, role):
    """
    Reschedule a reminder if it hasn't already passed.
    """
    try:
        reminder_data = get_reminder_data(key)
        if not reminder_data:
            logger.debug(f"⚠️ No reminder data found for {key.title()}.")
            return
        
        scheduled_time = reminder_data.get("scheduled_time")
        reminder_id = reminder_data.get("reminder_id")

        if scheduled_time and reminder_id:
            scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
            now = datetime.datetime.now(tz=pytz.UTC)

            if scheduled_dt <= now:
                logger.debug(f"❌ Reminder {reminder_id} for {key.title()} has already expired. Removing it.")
                delete_reminder_data(key)
                return

            remaining_time = scheduled_dt - now
            logger.debug(f"🔄 Rescheduling reminder {reminder_id} for {key.title()} in {remaining_time}.")
            
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
        logger.exception(f"⚠️ Error while attempting to reschedule a reminder: {e}")

async def get_coordinates(city: str):
    """
    Fetch latitude and longitude for a given city using Google Maps Geocoding API.
    """
    try:
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {"address": city, "key": GOOGLE_API_KEY}

        async with aiohttp.ClientSession() as session:
            async with session.get(geocode_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"📍 Google Geocoding API response: {json.dumps(data, indent=2)[:500]}...")

                    if data.get("results"):
                        location = data["results"][0]["geometry"]["location"]
                        lat, lon = location["lat"], location["lng"]
                        logger.debug(f"🌍 Retrieved coordinates for {city}: ({lat}, {lon})")
                        return lat, lon
                    else:
                        logger.warning(f"❌ No results found for city: {city}")
                else:
                    logger.error(f"⚠️ Google Geocoding API error: Status {response.status}")
    except Exception as e:
        logger.exception(f"⚠️ Error fetching city coordinates: {e}")

    return None, None

# -------------------------
# Specific Bump/Boop Handlers
# -------------------------
async def disboard():
    """Called when Disboard has completed a bump. Sets a 2-hour reminder."""
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Disboard again!",
        interval=7200  # 2 hours
    )

async def dsme():
    """Called when DS.me indicates a successful vote. Sets a 12-hour reminder."""
    await handle_reminder(
        key="dsme",
        initial_message="Thanks for voting for the server on DS.me! I'll remind you when it's time to vote again.",
        reminder_message="It's time to vote for the server on DS.me again!",
        interval=43200  # 12 hours
    )

async def unfocused():
    """Called when Unfocused's boop confirmation is detected. Sets a 6-hour reminder."""
    await handle_reminder(
        key="unfocused",
        initial_message="Thanks for booping the server on Unfocused! I'll remind you when it's time to boop again.",
        reminder_message="It's time to boop the server on Unfocused again!",
        interval=21600  # 6 hours
    )

async def discadia():
    """Called when Discadia completes a bump. Sets a 12-hour reminder."""
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
    Sends an initial message (if provided), waits for `interval` seconds,
    then sends a reminder message and cleans up the reminder.
    """
    try:
        channel = await get_channel("reminder_channel")
        if not channel:
            logger.warning("⚠️ No valid reminder channel found; cannot send scheduled message.")
            return

        if initial_message:
            logger.debug(f"📢 Sending initial message for '{key}': {initial_message}")
            await channel.send(initial_message)

        logger.debug(f"⏳ Waiting {interval} seconds before sending reminder for '{key}'...")
        await asyncio.sleep(interval)

        logger.debug(f"🔔 Sending reminder message for '{key}': {reminder_message}")
        await channel.send(reminder_message)

        # Cleanup reminder
        reminder_data = get_reminder_data(key)
        if reminder_data:
            delete_reminder_data(key)
            logger.debug(f"✅ Reminder {reminder_data['reminder_id']} for '{key.title()}' has been cleaned up.")

    except Exception as e:
        logger.exception(f"⚠️ Error in send_scheduled_message: {e}")


async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    """
    Checks if a reminder is set; if not, creates a new reminder and schedules it.
    """
    try:
        existing_data = get_reminder_data(key)
        if existing_data and existing_data.get("scheduled_time"):
            logger.debug(f"⏳ {key.capitalize()} already has a timer set. Skipping new reminder.")
            return

        reminder_id = str(uuid.uuid4())
        reminder_data = {
            "state": True,
            "scheduled_time": (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
            "reminder_id": reminder_id
        }
        set_reminder_data(key, reminder_data)
        logger.debug(f"📝 Scheduled new reminder: {key.capitalize()} | ID: {reminder_id} | Interval: {interval} seconds")

        role = get_role()
        if role:
            await send_scheduled_message(
                initial_message,
                f"🔔 <@&{role}> {reminder_message}",
                interval,
                key
            )

    except Exception as e:
        logger.exception(f"⚠️ Error handling reminder for key '{key}': {e}")

# -------------------------
# Event Listeners
# -------------------------
@interactions.listen()
async def on_ready():
    """
    Fired once the bot is fully online and ready.
    Sets custom presence and attempts to reschedule existing reminders.
    """
    try:
        logger.info("✅ Bot is online! Setting up status and activity...")

        # Set bot presence
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING,
            ),
        )
        logger.debug("🎭 Bot presence and activity set.")

        # Initialize reminders
        initialize_reminders_table()
        logger.debug("🛠️ Checking for active reminders...")

        # Fetch role for reminders
        role = get_role()
        if not role:
            logger.warning("⚠️ No role set for reminders; skipping reminder reschedule.")
            return

        # Reschedule reminders
        for key in ["disboard", "dsme", "unfocused", "discadia"]:
            logger.debug(f"🔄 Attempting to reschedule {key} reminder...")
            await reschedule_reminder(key, role)
            logger.debug(f"✅ Reminder {key} successfully rescheduled.")

        logger.info("🎯 All reminders checked and rescheduled. Bot is ready!")

    except Exception as e:
        logger.exception(f"⚠️ An unexpected error occurred during on_ready: {e}")

@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    """
    Fired whenever a new message is created.
    Checks if it's from known bump bots and triggers reminders accordingly.
    """
    try:
        bot_id = str(event.message.author.id)
        message_content = event.message.content
        logger.debug(f"💬 Message received from {event.message.author.username} (ID: {bot_id})")

        # Check if the message is from a known bump bot
        if bot_id in bot_ids:
            logger.debug(f"🤖 Detected message from **{bot_ids[bot_id]}**.")

        # Check for embeds
        if event.message.embeds:
            embed = event.message.embeds[0]
            embed_description = embed.description or ""
            logger.debug(f"📜 Embed detected: {embed_description[:100]}...")  # Logs first 100 chars for debugging

            if "Bump done" in embed_description:
                logger.debug("🔔 Triggering Disboard reminder...")
                await disboard()
            elif "Your vote streak for this server" in embed_description:
                logger.debug("🔔 Triggering DSME reminder...")
                await dsme()

        else:
            # Plain text checks
            logger.debug(f"📄 Checking message content: {message_content[:100]}...")  # Logs first 100 chars for debugging

            if "Your server has been booped" in message_content:
                logger.debug("🔔 Triggering Unfocused reminder...")
                await unfocused()
            elif "has been successfully bumped" in message_content:
                logger.debug("🔔 Triggering Discadia reminder...")
                await discadia()

    except Exception as e:
        logger.exception(f"⚠️ Error processing on_message_create event: {e}")

@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    """
    Fired when a new user joins the server.
    Handles troll mode (kicking new accounts) and backup mode (role assignment & welcome).
    """
    try:
        # Retrieve settings
        assign_role = get_value("backup_mode_enabled")
        role_id = get_value("backup_mode_id")
        channel_id = get_value("backup_mode_channel")
        kick_users = get_value("troll_mode_enabled")
        kick_users_age_limit = get_value("troll_mode_account_age")

        member = event.member
        guild = event.guild
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at

        if kick_users_age_limit is None:
            kick_users_age_limit = 14  # Default if not set

        logger.debug(f"👤 New member joined: {member.username} (Guild ID: {guild.id}) | Account Age: {account_age.days} days")

        # Troll Mode: Kick if account is too new
        if kick_users and account_age < datetime.timedelta(days=kick_users_age_limit):
            await member.kick(reason="Account is too new!")
            logger.debug(f"❌ Kicked {member.username} for having an account younger than {kick_users_age_limit} days.")
            return

        # Backup Mode: Assign role & send welcome message
        if not (assign_role and role_id and channel_id):
            logger.debug("⚠️ Backup mode is not fully configured. Skipping role assignment and welcome message.")
            return

        channel = guild.get_channel(channel_id)
        if not channel:
            logger.warning(f"⚠️ Channel with ID {channel_id} not found. Welcome message skipped.")
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
            ),
            color=0xCD41FF,
        )
        await channel.send(embeds=[embed])
        logger.debug(f"📢 Sent welcome message in <#{channel_id}> for {member.username}.")

        # Assign role
        role_obj = guild.get_role(role_id)
        if role_obj:
            await member.add_role(role_obj)
            logger.debug(f"✅ Assigned role '{role_obj.name}' to {member.username}.")
        else:
            logger.warning(f"⚠️ Role with ID {role_id} not found in the guild. Role assignment skipped.")

    except Exception as e:
        logger.exception(f"⚠️ Error during on_member_join event: {e}")

# -------------------------
# Slash Commands
# -------------------------
@interactions.slash_command(name="remindersetup", description="Setup bump and boop reminders.")
@interactions.slash_option(
    name="channel",
    description="Channel to send reminders in",
    required=True,
    opt_type=interactions.OptionType.CHANNEL
)
@interactions.slash_option(
    name="role",
    description="Role to ping in reminders",
    required=True,
    opt_type=interactions.OptionType.ROLE
)
async def reminder_setup(ctx: interactions.ComponentContext, channel, role: interactions.Role):
    """
    Sets up the reminder channel and role in the database.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /remindersetup attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"⏰ Reminder setup requested by {ctx.author.username} ({ctx.author.id}). Channel: {channel.id}, Role: {role.id}")

        # Store settings
        set_value("reminder_channel", channel.id)
        set_value("role", role.id)

        await ctx.send(f"✅ **Reminder setup complete!**\n📢 Reminders will be sent in <#{channel.id}>.\n🎭 The role to be pinged is <@&{role.id}>.")
        logger.debug("✅ Reminder setup successfully completed.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /remindersetup command: {e}")
        await ctx.send("⚠️ An error occurred while setting up reminders. Please try again later.", ephemeral=True)

@interactions.slash_command(name="status", description="Check the current status of all reminders.")
async def check_status(ctx: interactions.ComponentContext):
    """
    Shows the channel/role set for reminders and how much time remains for each reminder.
    """
    try:
        logger.debug(f"📊 Status check requested by {ctx.author.username} ({ctx.author.id}).")

        # Fetch stored values
        channel_id = get_value("reminder_channel")
        role_id = get_value("role")

        channel_str = f"📢 <#{channel_id}>" if channel_id else "⚠️ Not set!"
        role_str = f"🎭 <@&{role_id}>" if role_id else "⚠️ Not set!"

        logger.debug(f"Reminder Channel: {channel_id if channel_id else 'Not Set'}")
        logger.debug(f"Reminder Role: {role_id if role_id else 'Not Set'}")

        # Fetch reminder statuses
        reminders_info = []
        for reminder_key in ["disboard", "discadia", "dsme", "unfocused"]:
            data = get_reminder_data(reminder_key)
            time_str = calculate_remaining_time(data.get("scheduled_time")) if data else "⚠️ Not set!"
            reminders_info.append(f"⏳ **{reminder_key.capitalize()}**: {time_str}")

            logger.debug(f"Reminder {reminder_key}: {time_str}")

        # Format the response
        summary = (
            f"📌 **Reminder Status:**\n"
            f"📢 **Channel:** {channel_str}\n"
            f"🎭 **Role:** {role_str}\n\n"
            + "\n".join(reminders_info)
        )

        await ctx.send(summary)
        logger.debug("✅ Status check completed successfully.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /status command: {e}")
        await ctx.send("⚠️ An error occurred while fetching status. Please try again later.", ephemeral=True)

@interactions.slash_command(name="testmessage", description="Send a test message to the reminder channel.")
async def test_reminders(ctx: interactions.ComponentContext):
    """
    Sends a quick test ping to confirm the reminder channel/role setup works.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /testmessage attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"🔔 Test message requested by {ctx.author.username} ({ctx.author.id}).")

        role_id = get_value("role")
        if not role_id:
            logger.warning("⚠️ No role has been set up for reminders.")
            await ctx.send("⚠️ No role has been set up for reminders.", ephemeral=True)
            return

        await ctx.send(f"🔔 <@&{role_id}> This is a test reminder message!")
        logger.debug("✅ Test reminder message successfully sent.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /testmessage command: {e}")
        await ctx.send("⚠️ Could not send test message. Please try again later.", ephemeral=True)

@interactions.slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: interactions.ComponentContext):
    """
    A placeholder command for developer maintenance.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /dev attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"👨‍💻 Developer tag maintenance requested by {ctx.author.username} ({ctx.author.id}).")

        await ctx.send("🛠️ Developer tag maintained!")
        logger.debug("✅ Developer tag maintenance completed.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /dev command: {e}")
        await ctx.send("⚠️ An error occurred while maintaining the developer tag. Please try again later.", ephemeral=True)

@interactions.slash_command(name="source", description="Get links for the bot's resources.")
async def source(ctx: interactions.ComponentContext):
    """
    Responds with an embed containing links for the bot's resources.
    """
    try:
        logger.debug(f"Received /source command from {ctx.author.username} ({ctx.author.id})")

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

        await ctx.send(embeds=[embed])
        logger.debug(f"✅ Successfully sent bot resources embed to {ctx.author.username}.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /source command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request.", ephemeral=True)

@interactions.slash_command(name="togglebackupmode", description="Toggle role assignment for new members.")
@interactions.slash_option(
    name="enabled",
    description="Enable (true) or Disable (false) auto-role assignment",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
async def toggle_backup_mode(ctx: interactions.ComponentContext, enabled: bool):
    """
    Enables or disables backup mode for auto-role assignment.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /togglebackupmode attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"Received /togglebackupmode command from {ctx.author.username} ({ctx.author.id})")
        logger.debug(f"Backup mode toggle: {'Enabled' if enabled else 'Disabled'}")

        # Update backup mode setting
        set_value("backup_mode_enabled", enabled)
        status = "✅ **enabled**" if enabled else "❌ **disabled**"

        await ctx.send(f"🔄 Backup mode has been {status}.")
        logger.debug(f"Backup mode successfully {status} by {ctx.author.username}.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /togglebackupmode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling backup mode. Please try again later.", ephemeral=True)

@interactions.slash_command(name="backupmode", description="Configure the role/channel used by backup mode.")
@interactions.slash_option(
    name="channel",
    description="Channel to send welcome messages for new members",
    required=True,
    opt_type=interactions.OptionType.CHANNEL
)
@interactions.slash_option(
    name="role",
    description="Role to assign to new members",
    required=True,
    opt_type=interactions.OptionType.ROLE
)
async def backup_mode_setup(ctx: interactions.ComponentContext, channel, role: interactions.Role):
    """
    Sets which channel to welcome new members in and which role to assign them.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /backupmode attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"Received /backupmode command from {ctx.author.username} ({ctx.author.id})")
        logger.debug(f"Setting backup mode: Channel=<#{channel.id}>, Role=<@&{role.id}>")

        # Store settings
        set_value("backup_mode_id", role.id)
        set_value("backup_mode_channel", channel.id)

        await ctx.send(
            f"🔄 **Backup Mode Configured!**\n📢 Welcome messages will be sent in <#{channel.id}>.\n🎭 New members will be assigned the role: <@&{role.id}>."
        )
        logger.debug(f"✅ Backup mode successfully set: Channel={channel.id}, Role={role.id}")

    except Exception as e:
        logger.exception(f"⚠️ Error in /backupmode command: {e}")
        await ctx.send("⚠️ An error occurred while configuring backup mode. Please try again later.", ephemeral=True)

@interactions.slash_command(name="trollmode", description="Toggle kicking of accounts younger than a specified age.")
@interactions.slash_option(
    name="enabled",
    description="Enable or disable troll mode",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
@interactions.slash_option(
    name="age",
    description="Minimum account age in days (Default: 14)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def toggle_troll_mode(ctx: interactions.ComponentContext, enabled: bool, age: int = 14):
    """
    Kicks new members if their account is under the specified age when troll mode is enabled.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /trollmode attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"Received /trollmode command from {ctx.author.username} ({ctx.author.id})")
        logger.debug(f"Troll mode toggle: {'Enabled' if enabled else 'Disabled'}, Minimum age: {age} days")

        # Update troll mode settings
        set_value("troll_mode_enabled", enabled)
        set_value("troll_mode_account_age", age)

        status = "✅ **enabled**" if enabled else "❌ **disabled**"
        await ctx.send(f"👹 Troll mode has been {status}. Minimum account age: **{age}** days.")
        logger.debug(f"Troll mode {status} by {ctx.author.username}; account age threshold={age} days.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /trollmode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling troll mode. Please try again later.", ephemeral=True)

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
    Mimics logic to write reminder data to the database and fix broken entries.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /fix attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"Received /fix command from {ctx.author.username} ({ctx.author.id}) for service: {service}")

        # Determine delay based on service
        service_delays = {
            "disboard": 7200,  # 2 hours
            "dsme": 43200,  # 12 hours
            "unfocused": 21600,  # 6 hours
            "discadia": 43200  # 12 hours
        }

        if service not in service_delays:
            logger.warning(f"Invalid service name provided: {service}")
            await ctx.send("⚠️ Invalid service name provided. Please use one of: **disboard, dsme, unfocused, discadia**.", ephemeral=True)
            return

        seconds = service_delays[service]
        logger.debug(f"Service '{service}' selected with a delay of {seconds} seconds.")

        # Generate unique reminder ID and timestamp
        reminder_id = str(uuid.uuid4())
        scheduled_time = (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=seconds)).isoformat()

        reminder_data = {
            "state": True,
            "scheduled_time": scheduled_time,
            "reminder_id": reminder_id
        }

        # Save to database
        set_reminder_data(service, reminder_data)
        logger.debug(f"🔧 Fix logic applied: {reminder_data}")

        await ctx.send(f"✅ Fix logic successfully applied for **{service}**!")
        logger.debug(f"✅ Fix logic successfully applied for service: {service}")

    except Exception as e:
        logger.exception(f"⚠️ Error in /fix command: {e}")
        await ctx.send("⚠️ An error occurred while applying fix logic. Please try again later.", ephemeral=True)

@interactions.slash_command(name="resetreminders", description="Reset all reminders in the database to default values.")
async def reset_reminders(ctx: interactions.ComponentContext):
    """
    Resets all reminders in the 'reminders' table to their default values.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /resetreminders attempt by {ctx.author.username} ({ctx.author.id})")
        return

    try:
        logger.debug(f"Received /resetreminders command from {ctx.author.username} ({ctx.author.id})")

        default_data = {
            "state": False,
            "scheduled_time": None,
            "reminder_id": None
        }
        reminder_keys = ["disboard", "dsme", "unfocused", "discadia"]

        for key in reminder_keys:
            set_reminder_data(key, default_data)
            logger.debug(f"🔄 Reset reminder data for key: {key}")

        await ctx.send("✅ All reminders have been reset to default values.")
        logger.debug("✅ All reminders successfully reset.")
    except Exception as e:
        logger.exception(f"⚠️ Error in /resetreminders command: {e}")
        await ctx.send("⚠️ An error occurred while resetting reminders. Please try again later.", ephemeral=True)

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
    Uses the Google Custom Search API to return top text results.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /google command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for query: '{query}', requested results: {results}")

        # Format query (capitalize first letter for consistency)
        formatted_query = query.title()
        results = max(1, min(results, 10))  # Ensure results are within 1-10
        logger.debug(f"Formatted query: '{formatted_query}', adjusted results: {results}")

        # Google API request
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

                    # Log the full API response for debugging
                    logger.debug(f"Received Google Search data: {json.dumps(data, indent=2)}")

                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title Found")
                            link = item.get("link", "No Link Found")
                            snippet = item.get("snippet", "No Description Found")

                            # Log extracted data
                            logger.debug(f"Extracted Google Search Result - Title: {title}, Link: {link}")

                            # Create embed with emojis
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
    Uses the Google Custom Search API (Image mode) to return top image results.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /googleimage command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for query: '{query}', requested results: {results}")

        # Format query (capitalize for consistency)
        formatted_query = query.title()
        results = max(1, min(results, 10))  # Ensure results are within 1-10
        logger.debug(f"Formatted query: '{formatted_query}', adjusted results: {results}")

        # Google API request
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

                    # Log the full API response for debugging
                    logger.debug(f"Received Google Image data: {json.dumps(data, indent=2)}")

                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title")
                            image_link = item.get("link", "")
                            page_link = item.get("image", {}).get("contextLink", image_link)

                            # Log extracted data
                            logger.debug(f"Extracted Image - Title: {title}, Image Link: {image_link}")

                            # Create embed with emojis
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
    Search the YouTube Data API for a single top video matching the query.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /youtube command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for query: '{query}'")

        # Format query (capitalize first letter for consistency)
        formatted_query = query.title()
        logger.debug(f"Formatted query: '{formatted_query}'")

        # YouTube API request
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

                    # Log the full API response for debugging
                    logger.debug(f"Received YouTube data: {json.dumps(data, indent=2)}")

                    if "items" in data and data["items"]:
                        item = data["items"][0]
                        video_id = item["id"].get("videoId", "")
                        snippet = item["snippet"]
                        title = snippet.get("title", "No Title")
                        description = snippet.get("description", "No Description")
                        thumbnail = snippet.get("thumbnails", {}).get("high", {}).get("url", "")

                        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else "N/A"

                        # Log extracted data
                        logger.debug(f"Extracted YouTube Video - Title: {title}, Video ID: {video_id}")

                        # Create embed with emojis
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
    Uses the Wikipedia API to find the top search result for the given query.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /wikipedia command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for query: '{query}'")

        # Format query (capitalize first letter for consistency)
        formatted_query = query.title()
        logger.debug(f"Formatted query: '{formatted_query}'")

        # Wikipedia API request
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

                    # Log the full API response for debugging
                    logger.debug(f"Received Wikipedia data: {json.dumps(data, indent=2)}")

                    if data.get("query", {}).get("search"):
                        top_result = data["query"]["search"][0]
                        title = top_result.get("title", "No Title")
                        snippet = top_result.get("snippet", "No snippet available.")
                        snippet = snippet.replace("<span class=\"searchmatch\">", "**").replace("</span>", "**")
                        page_id = top_result.get("pageid")
                        wiki_url = f"https://en.wikipedia.org/?curid={page_id}"

                        # Log extracted data
                        logger.debug(f"Extracted Wikipedia Data - Title: {title}, Page ID: {page_id}")

                        # Create embed with emojis
                        embed = interactions.Embed(
                            title=f"📖 **{title}**",
                            description=f"📜 **Summary:** {snippet}...",
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
    Searches OMDb for the given movie or TV show title and displays relevant information.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /imdb command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for title: '{title}'")

        # Format title (capitalize for consistency)
        formatted_title = title.title()
        logger.debug(f"Formatted title: '{formatted_title}'")

        # OMDb API request
        search_url = "http://www.omdbapi.com/"
        params = {"t": title, "apikey": OMDB_API_KEY}
        logger.debug(f"Making API request to: {search_url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                logger.debug(f"API Response Status: {response.status}")

                if response.status == 200:
                    data = await response.json()

                    # Log the full API response for debugging
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

                        # Log extracted data
                        logger.debug(f"Extracted IMDb Data - Title: {title}, Year: {year}, Genre: {genre}, IMDb Rating: {imdb_rating}")

                        # Create embed with emojis
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
    Searches for a word's definition and synonyms using the Free Dictionary API.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /define command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for word: '{word}'")

        # Format word (capitalize for consistency)
        word = word.lower()
        logger.debug(f"Formatted word: '{word}'")

        # Dictionary API request
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        logger.debug(f"Making API request to: {url}")

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                logger.debug(f"API Response Status: {response.status}")

                if response.status == 200:
                    data = await response.json()

                    # Log the full API response for debugging
                    logger.debug(f"Received dictionary data: {json.dumps(data, indent=2)}")

                    if isinstance(data, list) and data:
                        entry = data[0]
                        meanings = entry.get("meanings", [])
                        
                        if meanings:
                            definitions = meanings[0].get("definitions", [])
                            definition_text = definitions[0].get("definition", "No definition found.") if definitions else "No definition available."

                            synonyms = meanings[0].get("synonyms", [])
                            synonyms_text = ", ".join(synonyms[:5]) if synonyms else "No synonyms available."

                            # Log extracted data
                            logger.debug(f"Extracted definition: {definition_text}")
                            logger.debug(f"Extracted synonyms: {synonyms_text}")

                            # Create embed with emojis
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


@interactions.slash_command(name="weather", description="Get the current weather for a city.")
@interactions.slash_option(
    name="city",
    description="Enter the city name.",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def weather_search(ctx: interactions.ComponentContext, city: str):
    """
    Fetches the current weather and 3-day forecast from PirateWeather using city coordinates.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received weather command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for city: '{city}'")

        # Get coordinates
        lat, lon = await get_coordinates(city)
        if lat is None or lon is None:
            logger.warning(f"Failed to get coordinates for '{city}'.")
            await ctx.send(f"Could not find the location for '{city}'. Try another city.")
            return
        
        # Capitalize city name
        city = city.title()
        logger.debug(f"Formatted city name: '{city}' (Lat: {lat}, Lon: {lon})")

        # PirateWeather API request
        url = f"https://api.pirateweather.net/forecast/{PIRATEWEATHER_API_KEY}/{lat},{lon}"
        params = {"units": "si"}  # SI for Celsius
        logger.debug(f"Making API request to: {url} with params {params}")

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()

                    # Log the full API response for debugging
                    logger.debug(f"Received weather data: {json.dumps(data, indent=2)}")

                    currently = data["currently"]
                    daily = data["daily"]["data"]

                    # Extract current weather data
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

                    # Extract 3-day forecast
                    forecast_text = ""
                    for i in range(3):
                        day = daily[i]
                        day_summary = day.get("summary", "No data")
                        high_c = day.get("temperatureHigh", "N/A")
                        high_f = round((high_c * 9/5) + 32, 1) if isinstance(high_c, (int, float)) else "N/A"
                        low_c = day.get("temperatureLow", "N/A")
                        low_f = round((low_c * 9/5) + 32, 1) if isinstance(low_c, (int, float)) else "N/A"
                        forecast_text += f"**Day {i+1}:** {day_summary}\n🌡 High: {high_c}°C / {high_f}°F, Low: {low_c}°C / {low_f}°F\n\n"

                    # Log extracted weather data
                    logger.debug(f"Extracted weather data for {city}: Temp {temp_c}°C, Feels Like {feels_like_c}°C, Humidity {humidity}%")

                    # Create embed
                    embed = interactions.Embed(
                        title=f"Weather in {city}",
                        description=f"**{weather}**",
                        color=0xFF6E42
                    )
                    embed.add_field(name="🌍 Location", value=f"📍 {city}\n📍 Lat: {lat}, Lon: {lon}", inline=False)
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

                    # Add forecast
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
    Searches Urban Dictionary for the given term and displays the top result's definition.
    """
    try:
        logger.debug(f"📖 User '{ctx.author.username}' (ID: {ctx.author.id}) searched for '{query}' on Urban Dictionary.")

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

                        logger.debug(f"✅ Found definition for '{word}': {definition[:100]}... 👍 {thumbs_up} 👎 {thumbs_down}")

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
                        logger.debug(f"⚠️ No definitions found for '{query}'.")
                        await ctx.send("⚠️ No definitions found for your query. Try refining it.")

                else:
                    logger.warning(f"⚠️ Urban Dictionary API error: {response.status}")
                    await ctx.send(f"⚠️ Error: Urban Dictionary API returned status code {response.status}.")

    except Exception as e:
        logger.exception(f"⚠️ Error in /urban command: {e}")
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
    Searches MyAnimeList for the given anime title and displays relevant information.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /mal command from user: {ctx.author.id} (User: {ctx.author.username})")
        logger.debug(f"User input for title: '{title}'")

        # Format title for consistency
        formatted_title = title.title()
        logger.debug(f"Formatted title: '{formatted_title}'")

        # MyAnimeList API request
        search_url = f"https://api.myanimelist.net/v2/anime?q={title}&limit=1"
        headers = {"X-MAL-CLIENT-ID": MAL_CLIENT_ID}
        logger.debug(f"Making API request to: {search_url} with headers {headers}")

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, headers=headers) as response:
                logger.debug(f"API Response Status: {response.status}")

                if response.status == 200:
                    data = await response.json()

                    # Log the full API response for debugging
                    logger.debug(f"Received MAL data: {data}")

                    if "data" in data and data["data"]:
                        anime = data["data"][0]["node"]
                        anime_id = anime.get("id", None)
                        title = anime.get("title", "Unknown")
                        image_url = anime.get("main_picture", {}).get("medium", None)
                        mal_link = f"https://myanimelist.net/anime/{anime_id}" if anime_id else "N/A"

                        # Fetching more details
                        details_url = f"https://api.myanimelist.net/v2/anime/{anime_id}?fields=id,title,synopsis,mean,genres,start_date"
                        async with session.get(details_url, headers=headers) as details_response:
                            if details_response.status == 200:
                                details_data = await details_response.json()
                                synopsis = details_data.get("synopsis", "No synopsis available.")
                                rating = details_data.get("mean", "N/A")
                                genres = ", ".join([g["name"] for g in details_data.get("genres", [])]) or "Unknown"
                                release_date = details_data.get("start_date", "Unknown")

                                # Log extracted data
                                logger.debug(f"Extracted MAL Data - Title: {title}, Rating: {rating}, Genres: {genres}")

                                # Create embed with emojis
                                embed = interactions.Embed(
                                    title=f"📺 **{title}**",
                                    description=f"📜 **Synopsis:** {synopsis[:500]}...",  # Truncate long descriptions
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
    Fetches a random cat image from the Cataas API without caching issues.
    """
    try:
        await ctx.defer()

        # Fetch a random cat image URL from Cataas API
        cat_api_url = "https://cataas.com/cat?json=true"
        logger.debug(f"Fetching random cat image from {cat_api_url}")

        async with aiohttp.ClientSession() as session:
            async with session.get(cat_api_url) as response:
                if response.status == 200:
                    data = await response.json()
                    image_id = data.get("_id", None)

                    if image_id:
                        # Generate a unique image URL with a timestamp to avoid caching
                        timestamp = int(time.time())  # Current time to bust cache
                        image_url = f"https://cataas.com/cat/{image_id}?t={timestamp}"

                        await ctx.send(image_url)  # Send the fresh image URL
                    else:
                        await ctx.send("😿 Couldn't find a cat picture. Try again later.")
                else:
                    logger.warning(f"Cataas API error: {response.status}")
                    await ctx.send("😿 Couldn't fetch a cat picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /cat command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="dog", description="Get a random dog picture!")
async def dog_image(ctx: interactions.ComponentContext):
    """
    Fetches a random dog image from the Dog CEO API with a cache-busting trick.
    """
    try:
        await ctx.defer()

        # Add a timestamp query parameter to prevent caching
        timestamp = int(time.time())  # Current timestamp in seconds
        dog_url = f"https://dog.ceo/api/breeds/image/random?t={timestamp}"
        logger.debug(f"Fetching random dog image from {dog_url}")

        async with aiohttp.ClientSession() as session:
            async with session.get(dog_url) as response:
                if response.status == 200:
                    data = await response.json()
                    image_url = data.get("message", None)

                    if image_url:
                        await ctx.send(image_url)  # Send the direct link to the image
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
    name="city",
    description="Enter a city name (e.g., New York, London, Tokyo).",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def timezone_lookup(ctx: interactions.ComponentContext, city: str):
    """
    Fetches the current time in a given city using Google Maps Time Zone API.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /timezone command for city: '{city}'")

        async with aiohttp.ClientSession() as session:
            # Step 1: Get latitude & longitude of the city using Google Geocoding API
            geocode_url = f"https://maps.googleapis.com/maps/api/geocode/json"
            geocode_params = {"address": city, "key": GOOGLE_API_KEY}

            async with session.get(geocode_url, params=geocode_params) as response:
                if response.status == 200:
                    geo_data = await response.json()
                    logger.debug(f"Received Google Geocoding API response: {json.dumps(geo_data, indent=2)[:500]}...")

                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        await ctx.send(f"❌ Could not find the city '{city}'. Check spelling.")
                        return
                else:
                    await ctx.send(f"⚠️ Google Geocoding API error. Try again later.")
                    return

            # Step 2: Get timezone details using Google Maps Time Zone API
            timestamp = int(datetime.datetime.now().timestamp())  # Current UNIX timestamp
            timezone_url = f"https://maps.googleapis.com/maps/api/timezone/json"
            timezone_params = {"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}

            async with session.get(timezone_url, params=timezone_params) as response:
                if response.status == 200:
                    tz_data = await response.json()
                    logger.debug(f"Received Google Time Zone API response: {json.dumps(tz_data, indent=2)[:500]}...")

                    if tz_data.get("status") == "OK":
                        timezone_name = tz_data["timeZoneId"]
                        raw_offset = tz_data["rawOffset"] / 3600  # Convert to hours
                        dst_offset = tz_data["dstOffset"] / 3600  # Convert to hours
                        utc_offset = raw_offset + dst_offset  # Final UTC offset
                        is_dst = "Yes" if dst_offset > 0 else "No"

                        # Calculate local time
                        current_utc_time = datetime.datetime.now(datetime.timezone.utc)
                        local_time = current_utc_time + datetime.timedelta(hours=utc_offset)
                        formatted_time = local_time.strftime("%Y-%m-%d %H:%M:%S")

                        # Create embed
                        embed = interactions.Embed(
                            title=f"🕒 Current Time in {city}",
                            description=f"⏰ **{formatted_time}** (UTC {utc_offset:+})",
                            color=0x1D4ED8
                        )
                        embed.add_field(name="🌍 Timezone", value=timezone_name, inline=True)
                        embed.add_field(name="🕰️ UTC Offset", value=f"UTC {utc_offset:+}", inline=True)
                        embed.add_field(name="🌞 Daylight Savings", value=is_dst, inline=True)
                        embed.set_footer(text="Powered by Google Maps Time Zone API")

                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ Error retrieving timezone info for '{city}'.")
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
    Calculates the time difference between two cities using Google Maps Time Zone API.
    """
    try:
        await ctx.defer()

        logger.debug(f"Received /timedifference command: '{place1}' and '{place2}'")

        async def get_utc_offset(city):
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

        await ctx.send(f"⏳ The time difference between **{place1}** and **{place2}** is **{time_difference} hours**.")

    except Exception as e:
        logger.exception(f"Error in /timedifference command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# Bot Startup
# -------------------------
try:
    bot.start(TOKEN)
    run_healthcheck()
except Exception:
    logger.exception("Exception occurred during bot startup!")
    sys.exit(1)
