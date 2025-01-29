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
import sentry_sdk
from logging.handlers import RotatingFileHandler
from supabase import create_client, Client

# -------------------------
# Sentry Setup
# -------------------------
sentry_sdk.init(
    dsn="https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
    traces_sample_rate=1.0,
    profiles_sample_rate=1.0,
    enable_tracing=True,
)

# -------------------------
# Logger Configuration
# -------------------------
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

file_handler = RotatingFileHandler("bot.log", maxBytes=2_000_000, backupCount=5)
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
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
    Retrieve a JSON value from the 'config' table in Supabase, using the provided key.
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
    If key doesn't exist, a new entry is inserted; otherwise, it is updated.
    """
    try:
        serialized = json.dumps(value)
        existing = get_value(key)
        if existing is None:
            supabase.table("config").insert({"id": key, "value": serialized}).execute()
            logger.info(f"Inserted new config entry for key '{key}'.")
        else:
            supabase.table("config").update({"value": serialized}).eq("id", key).execute()
            logger.info(f"Updated config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting key '{key}' in Supabase.")

def delete_value(key: str):
    """
    Delete a key/value pair from the 'config' table in Supabase.
    """
    try:
        supabase.table("config").delete().eq("id", key).execute()
        logger.info(f"Deleted config entry for key '{key}'.")
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
    Upsert (insert or update) a JSON value in the 'reminders' table in Supabase.
    If the key doesn't exist, a new row is inserted; otherwise it's updated.
    """
    try:
        serialized = json.dumps(data)
        existing = get_reminder_data(key)
        if existing is None:
            supabase.table("reminders").insert({"key": key, "reminder_data": serialized}).execute()
            logger.info(f"Inserted new reminder entry for key '{key}'.")
        else:
            supabase.table("reminders").update({"reminder_data": serialized}).eq("key", key).execute()
            logger.info(f"Updated reminder entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting reminder data for key '{key}'.")

def delete_reminder_data(key: str):
    """
    Delete reminder data from the 'reminders' table in Supabase for the given key.
    """
    try:
        supabase.table("reminders").delete().eq("key", key).execute()
        logger.info(f"Deleted reminder data for key '{key}'.")
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
            logger.info(f"Inserted default reminder_data for key: {k}")

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

print("Starting the bot...")

def handle_interrupt(signal_num, frame):
    """
    Handles shutdown signals (SIGINT, SIGTERM) gracefully by logging and exiting.
    """
    logger.info("Gracefully shutting down.")
    sys.exit(0)

signal.signal(signal.SIGINT, handle_interrupt)
signal.signal(signal.SIGTERM, handle_interrupt)

def get_role():
    """
    Fetch the role ID stored in the 'role' key from Supabase.
    Returns None if no role is set or if there's an error.
    """
    try:
        role = get_value("role")
        if not role:
            logger.info("No role has been set up for reminders.")
            return None
        return role
    except Exception:
        logger.exception("An error occurred while fetching the reminder role.")
        return None

async def get_channel(channel_key):
    """
    Given a key, fetch its channel ID from Supabase.
    Then return the channel object using bot.get_channel(channel_id).
    Returns None if channel not set or there's an error.
    """
    try:
        channel_id = get_value(channel_key)
        if not channel_id:
            logger.info(f"No channel has been set for '{channel_key}'.")
            return None
        return bot.get_channel(channel_id)
    except Exception:
        logger.exception("An error occurred while fetching the reminder channel.")
        return None

def calculate_remaining_time(scheduled_time):
    """
    Given an ISO-formatted datetime string, calculate how much time remains
    until that time (hours, minutes, seconds).
    Returns 'Expired!' if the scheduled time is already past,
    or 'Not set!' if scheduled_time is None.
    """
    if not scheduled_time:
        return "Not set!"
    try:
        now = datetime.datetime.now(tz=pytz.UTC)
        scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
        remaining_time = scheduled_dt - now
        if remaining_time <= datetime.timedelta(seconds=0):
            return "Expired!"
        hours, remainder = divmod(int(remaining_time.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02}:{minutes:02}:{seconds:02}"
    except Exception:
        logger.exception("An error occurred while calculating remaining time.")
        return "Error calculating time!"

async def safe_task(task):
    """
    A helper function to run tasks and catch any exceptions that occur.
    This prevents exceptions from tasks from crashing the event loop.
    """
    try:
        await task
    except Exception:
        logger.exception("Exception in scheduled task.")

async def reschedule_reminder(key, role):
    """
    Attempt to reschedule a reminder if it hasn't already passed.
    - If the reminder time is in the past, remove the reminder from the database.
    - Otherwise, schedule a task to send the reminder.
    """
    try:
        reminder_data = get_reminder_data(key)
        if not reminder_data:
            logger.info(f"No reminder data found for {key.title()}.")
            return
        
        scheduled_time = reminder_data.get("scheduled_time")
        reminder_id = reminder_data.get("reminder_id")
        
        if scheduled_time and reminder_id:
            scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
            now = datetime.datetime.now(tz=pytz.UTC)
            
            if scheduled_dt <= now:
                logger.info(f"Reminder {reminder_id} for {key.title()} has already expired. Removing it.")
                delete_reminder_data(key)
                return
            
            remaining_time = scheduled_dt - now
            logger.info(f"Rescheduling reminder {reminder_id} for {key.title()} in {remaining_time}.")
            asyncio.create_task(
                safe_task(
                    send_scheduled_message(
                        initial_message=None,
                        reminder_message=(
                            f"<@&{role}> It's time to bump on {key.title()}!"
                            if key in ["disboard", "dsme", "discadia"]
                            else f"<@&{role}> It's time to boop on {key.title()}!"
                        ),
                        interval=remaining_time.total_seconds(),
                        key=key
                    )
                )
            )
    except Exception:
        logger.exception("Error while attempting to reschedule a reminder.")

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
    then sends a reminder message. After sending the reminder, removes it from DB.
    """
    try:
        channel = await get_channel("reminder_channel")
        if not channel:
            logger.warning("No valid reminder channel found; cannot send scheduled message.")
            return
        
        if initial_message:
            logger.info(f"Sending initial message for '{key}': {initial_message}")
            await channel.send(initial_message)

        await asyncio.sleep(interval)

        logger.info(f"Sending reminder message for '{key}': {reminder_message}")
        await channel.send(reminder_message)

        reminder_data = get_reminder_data(key)
        if reminder_data:
            delete_reminder_data(key)
            logger.info(f"Reminder {reminder_data['reminder_id']} for {key.title()} has been cleaned up.")
    except Exception:
        logger.exception("Error in send_scheduled_message.")

async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    """
    Checks if a reminder is set for `key`. A "set" reminder has a non-None 'scheduled_time'.
    If not, creates a new reminder in the DB and schedules the task.
    """
    try:
        existing_data = get_reminder_data(key)
        if existing_data and existing_data.get("scheduled_time"):
            logger.info(f"{key.capitalize()} already has a timer set.")
            return

        reminder_id = str(uuid.uuid4())
        reminder_data = {
            "state": True,
            "scheduled_time": (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
            "reminder_id": reminder_id
        }
        set_reminder_data(key, reminder_data)
        role = get_role()

        if role:
            await send_scheduled_message(
                initial_message,
                f"<@&{role}> {reminder_message}",
                interval,
                key
            )
    except Exception:
        logger.exception(f"Error handling reminder for key '{key}'.")

# -------------------------
# Event Listeners
# -------------------------
@interactions.listen()
async def on_ready():
    """
    Fired once the bot is fully online and ready.
    - Sets custom presence/status.
    - Attempts to reschedule existing reminders.
    """
    try:
        logger.info("Bot is online. Setting up status and activity...")
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING,
            ),
        )

        initialize_reminders_table()

        logger.info("Checking for active reminders...")
        role = get_role()
        if not role:
            logger.info("No role set; skipping reminder reschedule.")
            return
        
        for key in ["disboard", "dsme", "unfocused", "discadia"]:
            await reschedule_reminder(key, role)

        logger.info("Reminders checked and rescheduled. Bot is ready!")
    except Exception:
        logger.exception("An unexpected error occurred during on_ready.")

@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    """
    Fired whenever a new message is created.
    Checks if it's from known bump bots and triggers reminders accordingly.
    """
    try:
        bot_id = str(event.message.author.id)
        message_content = event.message.content
        
        if bot_id in bot_ids:
            logger.info(f"Detected message from {bot_ids[bot_id]}.")

        if event.message.embeds:
            embed = event.message.embeds[0]
            embed_description = embed.description or ""
            if "Bump done" in embed_description:
                await disboard()
            elif "Your vote streak for this server" in embed_description:
                await dsme()
        else:
            # Plain text checks
            if "Your server has been booped" in message_content:
                await unfocused()
            elif "has been successfully bumped" in message_content:
                await discadia()
    except Exception:
        logger.exception("Error processing on_message_create event.")

@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    """
    Fired when a new user joins the server. Handles:
    1. Troll mode: Kick if account is younger than a configured threshold.
    2. Backup mode: Auto-assign role & send welcome message.
    """
    try:
        assign_role = get_value("backup_mode_enabled")
        role_id = get_value("backup_mode_id")
        channel_id = get_value("backup_mode_channel")
        kick_users = get_value("troll_mode_enabled")
        kick_users_age_limit = get_value("troll_mode_account_age")

        member = event.member
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at
        if kick_users_age_limit is None:
            kick_users_age_limit = 14  # default if not set

        if kick_users and account_age < datetime.timedelta(days=kick_users_age_limit):
            await member.kick(reason="Account is too new!")
            logger.info(f"Kicked {member.username} for having an account younger than {kick_users_age_limit} days.")
            return

        # If no backup mode, exit
        if not (assign_role and role_id and channel_id):
            return

        guild = event.guild
        logger.info(f"New member {member.username} joined the guild (ID: {guild.id}).")

        if assign_role and role_id:
            channel = guild.get_channel(channel_id)
            embed = interactions.Embed(
                title=f"Welcome {member.username}!",
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
            role_obj = guild.get_role(role_id)
            if role_obj:
                await member.add_role(role_obj)
                logger.info(f"Assigned role '{role_obj.name}' to {member.username}.")
            else:
                logger.warning(f"Role with ID {role_id} not found in the guild.")
    except Exception:
        logger.exception("Error during on_member_join event.")

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
    Sets up the reminder channel and role in the database, so the bot knows
    where to send messages and which role to mention for future reminders.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f"Reminder setup requested by {ctx.author.username}. Channel: {channel.id}, Role: {role.id}")
        set_value("reminder_channel", channel.id)
        set_value("role", role.id)

        await ctx.send(f"Reminder setup complete! Will use <#{channel.id}> for reminders and role <@&{role.id}>.")
        logger.info("Reminder setup successfully completed.")
    except Exception:
        logger.exception("Error in /remindersetup command.")
        await ctx.send("An error occurred while setting up reminders.", ephemeral=True)

@interactions.slash_command(name="status", description="Check the current status of all reminders.")
async def check_status(ctx: interactions.ComponentContext):
    """
    Shows which channel/role are set for reminders, plus how much time
    remains for each known reminder (Disboard, Discadia, DS.me, Unfocused).
    """
    try:
        logger.info(f"Status check requested by {ctx.author.username}.")
        channel_id = get_value("reminder_channel")
        role_id = get_value("role")

        channel_str = f"<#{channel_id}>" if channel_id else "Not set!"
        role_str = f"<@&{role_id}>" if role_id else "Not set!"

        # Gather times
        reminders_info = []
        for reminder_key in ["disboard", "discadia", "dsme", "unfocused"]:
            data = get_reminder_data(reminder_key)
            time_str = calculate_remaining_time(data.get("scheduled_time")) if data else "Not set!"
            reminders_info.append(f"{reminder_key.capitalize()}: {time_str}")

        summary = (
            f"**Reminder Status:**\n"
            f"Channel: {channel_str}\n"
            f"Role: {role_str}\n\n"
            + "\n".join(reminders_info)
        )
        await ctx.send(summary)
        logger.info("Status check completed.")
    except Exception:
        logger.exception("Error in /status command.")
        await ctx.send("An error occurred while fetching status.", ephemeral=True)

@interactions.slash_command(name="testmessage", description="Send a test message to the reminder channel.")
async def test_reminders(ctx: interactions.ComponentContext):
    """
    Sends a quick test ping to confirm that the reminder channel/role setup works.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f"Test message requested by {ctx.author.username}.")
        role_id = get_value("role")
        if not role_id:
            await ctx.send("No role has been set up for reminders.", ephemeral=True)
            return
        await ctx.send(f"<@&{role_id}> This is a test message!")
        logger.info("Test reminder message sent.")
    except Exception:
        logger.exception("Error in /testmessage command.")
        await ctx.send("Could not send test message.", ephemeral=True)

@interactions.slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: interactions.ComponentContext):
    """
    Simple placeholder command that can be used to maintain or verify developer status.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f"Developer tag maintenance requested by {ctx.author.username}.")
        await ctx.send("Developer tag maintained!")
        logger.info("Developer tag maintenance completed.")
    except Exception:
        logger.exception("Error in /dev command.")
        await ctx.send("An error occurred while maintaining developer tag.", ephemeral=True)

@interactions.slash_command(name="source", description="Get links for the bot's resources.")
async def source(ctx: interactions.ComponentContext):
    """
    Responds with an embed containing links for the bot's resources.
    """
    try:
        embed = interactions.Embed(
            title="Bot Resources",
            description="Here are the links for the bot's resources:",
            color=0x00ff00,
        )
        embed.add_field(name="GitHub Repository", value="https://github.com/doubleangels/Nova", inline=False)
        embed.add_field(
            name="Supabase Database",
            value="https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public",
            inline=False
        )
        await ctx.send(embeds=[embed])
    except Exception:
        logger.exception("Error in /source command.")
        await ctx.send("An error occurred while processing your request.", ephemeral=True)

@interactions.slash_command(name="togglebackupmode", description="Toggle role assignment for new members.")
@interactions.slash_option(
    name="enabled",
    description="Enable (true) or Disable (false) auto-role assignment",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
async def toggle_backup_mode(ctx: interactions.ComponentContext, enabled: bool):
    """
    Enables or disables backup mode, which automatically assigns a role to each new member.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        set_value("backup_mode_enabled", enabled)
        status = "enabled" if enabled else "disabled"
        await ctx.send(f"Backup mode has been {status}.")
        logger.info(f"Backup mode {status} by {ctx.author.username}.")
    except Exception:
        logger.exception("Error in /togglebackupmode command.")
        await ctx.send("An error occurred while toggling backup mode.", ephemeral=True)

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
    Sets which channel to welcome new members in and which role to assign them (if backup mode is on).
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        set_value("backup_mode_id", role.id)
        set_value("backup_mode_channel", channel.id)
        await ctx.send(
            f"Channel set to <#{channel.id}>. Role to assign: <@&{role.id}>. Backup mode will take effect if enabled."
        )
        logger.info(f"Backup mode setup by {ctx.author.username}: channel={channel.id}, role={role.id}")
    except Exception:
        logger.exception("Error in /backupmode command.")
        await ctx.send("An error occurred while configuring backup mode.", ephemeral=True)

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
    Kicks new members if their account's creation date is under the specified age in days (when troll mode is enabled).
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        set_value("troll_mode_enabled", enabled)
        set_value("troll_mode_account_age", age)
        status = "enabled" if enabled else "disabled"
        await ctx.send(f"Troll mode has been {status}. Minimum account age: {age} days.")
        logger.info(f"Troll mode {status} by {ctx.author.username}; account age threshold={age} days.")
    except Exception:
        logger.exception("Error in /trollmode command.")
        await ctx.send("An error occurred while toggling troll mode.", ephemeral=True)

@interactions.slash_command(
    name="fix",
    description="Runs the logic to add Disboard data to the database under the key name of 'fix'."
)
async def fix_command(ctx: interactions.ComponentContext):
    """
    This command mimics Disboard logic but only writes to the reminders table with the key "fix".
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        existing_data = get_reminder_data("fix") or {}
        if existing_data:
            await ctx.send("The 'fix' key already exists in the database.", ephemeral=True)
            return

        reminder_id = str(uuid.uuid4())
        reminder_data = {
            "state": True,
            "reminder_id": reminder_id
        }
        set_reminder_data("fix", reminder_data)
        await ctx.send("Fix logic applied! A new entry was created under the key 'fix'.")
        logger.info("Fix key created in reminders table.")
    except Exception:
        logger.exception("Error in /fix command.")
        await ctx.send("An error occurred while applying fix logic.", ephemeral=True)

@interactions.slash_command(name="resetreminders", description="Reset all reminders in the database to default values.")
async def reset_reminders(ctx: interactions.ComponentContext):
    """
    Resets all reminders in the 'reminders' table to their default values.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        default_data = {
            "state": False,
            "scheduled_time": None,
            "reminder_id": None
        }
        reminder_keys = ["disboard", "dsme", "unfocused", "discadia"]
        for key in reminder_keys:
            set_reminder_data(key, default_data)
            logger.info(f"Reset reminder data for key: {key}")

        await ctx.send("All reminders have been reset to default values.")
        logger.info("All reminders successfully reset.")
    except Exception:
        logger.exception("Error in /resetreminders command.")
        await ctx.send("An error occurred while resetting reminders. Please try again later.", ephemeral=True)

# -------------------------
# Search / AI Commands
# -------------------------
@interactions.slash_command(name="search", description="Search Google and return the top results.")
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
    You can specify how many results to display (1-10).
    """
    try:
        await ctx.defer()
        results = max(1, min(results, 10))
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {"key": GOOGLE_API_KEY, "cx": SEARCH_ENGINE_ID, "q": query, "num": results}

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title Found")
                            link = item.get("link", "No Link Found")
                            snippet = item.get("snippet", "No Description Found")
                            embed = interactions.Embed(
                                title=title,
                                description=f"{snippet}\n[Link]({link})",
                                color=0x1A73E8
                            )
                            embeds.append(embed)
                        if embeds:
                            await ctx.send(embeds=embeds)
                        else:
                            await ctx.send("No results found for your query.")
                    else:
                        await ctx.send("No results found for your query.")
                else:
                    logger.warning(f"Google API error: {response.status}")
                    await ctx.send(f"Error: Google API returned status code {response.status}.")
    except Exception:
        logger.exception("Error in /search command.")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)

@interactions.slash_command(name="imagesearch", description="Search Google for images and return the top results.")
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
    You can specify how many results to display (1-10).
    """
    try:
        await ctx.defer()
        results = max(1, min(results, 10))
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": IMAGE_SEARCH_ENGINE_ID,
            "q": query,
            "searchType": "image",
            "num": results
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            embed = interactions.Embed(
                                title=item.get("title", "No Title"),
                                description=f"[View Image]({item.get('link', '')})",
                                color=0x1A73E8
                            )
                            embed.set_image(url=item.get("link", ""))
                            embeds.append(embed)
                        if embeds:
                            await ctx.send(embeds=embeds)
                        else:
                            await ctx.send("No images found. Try refining your query.")
                    else:
                        await ctx.send("No image results found for your query.")
                else:
                    logger.warning(f"Google API error: {response.status}")
                    await ctx.send(f"Error: Google API returned status code {response.status}.")
    except Exception:
        logger.exception("Error in /imagesearch command.")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)

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
        search_url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            "key": GOOGLE_API_KEY,
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": 1
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            video_id = item["id"].get("videoId", "")
                            snippet = item["snippet"]
                            title = snippet.get("title", "No Title")
                            description = snippet.get("description", "No Description")
                            thumbnail = snippet.get("thumbnails", {}).get("high", {}).get("url", "")

                            embed = interactions.Embed(
                                title=title,
                                description=description,
                                url=f"https://www.youtube.com/watch?v={video_id}",
                                color=0xFF0000
                            )
                            if thumbnail:
                                embed.set_thumbnail(url=thumbnail)
                            embeds.append(embed)

                        if embeds:
                            await ctx.send(embeds=embeds)
                        else:
                            await ctx.send("No video results found for your query.")
                    else:
                        await ctx.send("No video results found for your query.")
                else:
                    logger.warning(f"YouTube API error: {response.status}")
                    await ctx.send(f"Error: YouTube API returned status code {response.status}.")
    except Exception:
        logger.exception("Error in /youtube command.")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)

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
    Sends a short snippet and a link to the full article.
    """
    try:
        await ctx.defer()
        search_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": query,
            "utf8": 1
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("query", {}).get("search"):
                        top_result = data["query"]["search"][0]
                        title = top_result.get("title", "No Title")
                        snippet = top_result.get("snippet", "No snippet available.")
                        snippet = snippet.replace("<span class=\"searchmatch\">", "**").replace("</span>", "**")
                        page_id = top_result.get("pageid")

                        embed = interactions.Embed(
                            title=title,
                            description=f"{snippet}...",
                            url=f"https://en.wikipedia.org/?curid={page_id}",
                            color=0xFFFFFF
                        )
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send("No results found for your query. Try refining it.")
                else:
                    logger.warning(f"Wikipedia API error: {response.status}")
                    await ctx.send(f"Error: Wikipedia API returned status code {response.status}.")
    except Exception:
        logger.exception("Error in /wikipedia command.")
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
    Searches Urban Dictionary for the given term and displays the top result's definition,
    example, and vote counts. If no entries are found, it notifies the user.
    """
    try:
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
                        example = top_result.get("example", "").replace("\r\n", "\n")
                        thumbs_up = top_result.get("thumbs_up", 0)
                        thumbs_down = top_result.get("thumbs_down", 0)

                        example = example or "No example available."

                        embed = interactions.Embed(
                            title=f"Definition: {word}",
                            description=definition,
                            color=0x1D2439
                        )
                        embed.add_field(name="Example", value=example, inline=False)
                        embed.add_field(name="Thumbs Up", value=str(thumbs_up), inline=True)
                        embed.add_field(name="Thumbs Down", value=str(thumbs_down), inline=True)
                        embed.set_footer(text="Powered by Urban Dictionary")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send("No definitions found for your query. Try refining it.")
                else:
                    logger.warning(f"Urban Dictionary API error: {response.status}")
                    await ctx.send(f"Error: Urban Dictionary API returned status code {response.status}.")
    except Exception:
        logger.exception("Error in /urban command.")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)

# -------------------------
# Bot Startup
# -------------------------
try:
    bot.start(TOKEN)
except Exception:
    logger.exception("Exception occurred during bot startup!")
    sys.exit(1)
