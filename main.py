import interactions
import asyncio
import os
import datetime
import pytz
import uuid
import sys
import signal
import logging
from logging.handlers import RotatingFileHandler
import aiohttp
import google.generativeai as genai
import sentry_sdk
import json
from supabase import create_client, Client

# -------------------------
# Sentry Setup
# -------------------------
sentry_sdk.init(
    dsn="https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
    traces_sample_rate=1.0,
    profiles_sample_rate=1.0,
)

# -------------------------
# Logger Configuration
# -------------------------
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

file_handler = RotatingFileHandler("bot.log", maxBytes=2_000_000, backupCount=5)
file_handler.setLevel(logging.INFO)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

logger.addHandler(file_handler)
logger.addHandler(console_handler)

# -------------------------
# Environment Variable Check
# -------------------------
required_env_vars = {
    "DISCORD_BOT_TOKEN": os.getenv("DISCORD_BOT_TOKEN"),
    "GOOGLE_API_KEY": os.getenv("GOOGLE_API_KEY"),
    "SEARCH_ENGINE_ID": os.getenv("SEARCH_ENGINE_ID"),
    "IMAGE_SEARCH_ENGINE_ID": os.getenv("IMAGE_SEARCH_ENGINE_ID"),
    "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY"),
    "SUPABASE_URL": os.getenv("SUPABASE_URL"),
    "SUPABASE_KEY": os.getenv("SUPABASE_KEY")
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
GEMINI_API_KEY = required_env_vars["GEMINI_API_KEY"]
SUPABASE_URL = required_env_vars["SUPABASE_URL"]
SUPABASE_KEY = required_env_vars["SUPABASE_KEY"]

# -------------------------
# Supabase Client
# -------------------------
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------
# "config" Table Helpers (unchanged for general settings)
# -------------------------
def get_value(key: str):
    """
    Retrieve a JSON value from the 'config' table in Supabase, using the provided key.
    Returns None if there's an error or no data is found.
    """
    try:
        response = supabase.table("config").select("value").eq("id", key).single().execute()
        if response.data and "value" in response.data:
            return json.loads(response.data["value"])
        else:
            return None
    except Exception as e:
        logger.error(f"Error getting key '{key}' in Supabase: {e}")
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
        else:
            supabase.table("config").update({"value": serialized}).eq("id", key).execute()
    except Exception as e:
        logger.error(f"Error setting key '{key}' in Supabase: {e}")

def delete_value(key: str):
    """
    Delete a key/value pair from the 'config' table in Supabase.
    """
    try:
        supabase.table("config").delete().eq("id", key).execute()
    except Exception as e:
        logger.error(f"Error deleting key '{key}' in Supabase: {e}")

# -------------------------
# New "reminders" Table Helpers
# -------------------------
def get_reminder_data(key: str):
    """
    Retrieve reminder data from the 'reminders' table in Supabase for the given key.
    Returns a dictionary if found, otherwise None.
    """
    try:
        response = supabase.table("reminders").select("reminder_data").eq("key", key).single().execute()
        if response.data and "reminder_data" in response.data:
            return json.loads(response.data["reminder_data"])
        else:
            return None
    except Exception as e:
        logger.error(f"Error getting reminder data for key '{key}': {e}")
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
        else:
            supabase.table("reminders").update({"reminder_data": serialized}).eq("key", key).execute()
    except Exception as e:
        logger.error(f"Error setting reminder data for key '{key}': {e}")

def delete_reminder_data(key: str):
    """
    Delete reminder data from the 'reminders' table in Supabase for the given key.
    """
    try:
        supabase.table("reminders").delete().eq("key", key).execute()
    except Exception as e:
        logger.error(f"Error deleting reminder data for key '{key}': {e}")

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
# Gemini (Google Generative AI) Configuration
# -------------------------
genai.configure(api_key=GEMINI_API_KEY)

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

nova_id = "835255643157168168"

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
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

async def get_channel(channel_key):
    """
    Given a key, fetch its channel ID from Supabase.
    Then return the channel object using bot.get_channel(channel_id).
    Returns None if channel not set or there's an error.
    """
    try:
        channel_id = get_value(channel_key)
        if not channel_id:
            logger.info(f"No channel has been set for {channel_key}.")
            return None
        return bot.get_channel(channel_id)
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

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
        scheduled_time = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
        remaining_time = scheduled_time - now
        if remaining_time <= datetime.timedelta(seconds=0):
            return "Expired!"
        hours, remainder = divmod(int(remaining_time.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02}:{minutes:02}:{seconds:02}"
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

async def safe_task(task):
    """
    A helper function to run tasks and catch any exceptions that occur.
    This prevents exceptions from tasks from crashing the event loop.
    """
    try:
        await task
    except Exception as e:
        logger.error(f"Exception in scheduled task: {e}")

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
            logger.info(f"Rescheduling reminder {reminder_id} for {key.title()}.")
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
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# -------------------------
# Specific Bump/Boop Handlers
# -------------------------
async def disboard():
    """
    Called when Disboard has completed a bump. Sets a 2-hour reminder.
    """
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Disboard again!",
        interval=7200  # 2 hours
    )

async def dsme():
    """
    Called when DS.me indicates a successful vote. Sets a 12-hour reminder.
    """
    await handle_reminder(
        key="dsme",
        initial_message="Thanks for voting for the server on DS.me! I'll remind you when it's time to vote again.",
        reminder_message="It's time to vote for the server on DS.me again!",
        interval=43200  # 12 hours
    )

async def unfocused():
    """
    Called when Unfocused's boop confirmation is detected. Sets a 6-hour reminder.
    """
    await handle_reminder(
        key="unfocused",
        initial_message="Thanks for booping the server on Unfocused! I'll remind you when it's time to boop again.",
        reminder_message="It's time to boop the server on Unfocused again!",
        interval=21600  # 6 hours
    )

async def discadia():
    """
    Called when Discadia completes a bump. Sets a 12-hour reminder.
    """
    await handle_reminder(
        key="discadia",
        initial_message="Thanks for bumping the server on Discadia! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Discadia again!",
        interval=43200  # 12 hours
    )

# -------------------------
# Event Listeners
# -------------------------
@interactions.listen()
async def on_ready():
    """
    Fired once the bot is fully online and ready.
    - Sets custom presence/status.
    - Attempts to reschedule any existing reminders.
    """
    try:
        logger.info("Bot is online. Setting up status and activity...")
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING
            )
        )

        initialize_reminders_table()

        logger.info("Checking for active reminders...")
        role = get_role()
        if not role:
            return
        
        for key in ["disboard", "dsme", "unfocused", "discadia"]:
            await reschedule_reminder(key, role)

        logger.info("Active reminders have been checked and rescheduled.")
        logger.info("I am online and ready!")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    """
    Fired whenever a new message is created. We check:
    - If it's from a known bump bot (Disboard, DS.me, etc.).
    - If it matches certain textual patterns (bump confirmations, etc.).
    - Then trigger the appropriate reminder function.
    """
    try:
        bot_id = str(event.message.author.id)
        message_content = event.message.content
        
        if bot_id in bot_ids:
            bot_name = bot_ids[bot_id]
            logger.info(f"Detected message from {bot_name}.")

        if event.message.embeds and len(event.message.embeds) > 0:
            embed = event.message.embeds[0]
            embed_description = embed.description
            if embed_description:
                if "Bump done" in embed_description:
                    await disboard()
                elif "Your vote streak for this server" in embed_description:
                    await dsme()
        else:
            if "Your server has been booped" in message_content:
                await unfocused()
            elif "has been successfully bumped" in message_content:
                await discadia()
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    """
    Fired when a new user joins the server. Handles two features:
    1. Troll mode: Kick users if their accounts are younger than a configured threshold.
    2. Backup mode: Assign a default role to new users and send a welcome message.
    """
    try:
        assign_role = get_value("backup_mode_enabled")
        role_id = get_value("backup_mode_id")
        channel_id = get_value("backup_mode_channel")
        kick_users = get_value("troll_mode_enabled")
        kick_users_age_limit = get_value("troll_mode_account_age")

        member = event.member
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at
        account_age_limit = datetime.timedelta(days=kick_users_age_limit) if kick_users_age_limit else datetime.timedelta(days=14)

        if kick_users and account_age < account_age_limit:
            await member.kick(reason="Account is too new!")
            logger.info(f"Kicked {member.username} due to account age.")

        if not (assign_role and role_id and channel_id):
            return

        guild = event.guild
        logger.info(f"New member {member.username} has joined the guild.")
        
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
                color=0xCD41FF
            )
            await channel.send(embeds=[embed])
            role_obj = guild.get_role(role_id)
            if role_obj:
                await member.add_role(role_obj)
                logger.info(f"Assigned role {role_obj.name} to new member {member.username}.")
            else:
                logger.error(f"Role with ID {role_id} not found in the guild.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

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
            return
        
        if initial_message:
            logger.info(f"Sending initial message: {initial_message}")
            await channel.send(initial_message)

        await asyncio.sleep(interval)

        logger.info(f"Sending reminder message: {reminder_message}")
        await channel.send(reminder_message)

        reminder_data = get_reminder_data(key)
        if reminder_data:
            delete_reminder_data(key)
            logger.info(f"Reminder {reminder_data['reminder_id']} for {key.title()} has been cleaned up from the database.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    """
    Checks if a reminder is truly set for `key`.
    A "set" reminder has a non-None scheduled_time (meaning it's active).
    """
    existing_data = get_reminder_data(key)

    if existing_data and existing_data.get("scheduled_time") is not None:
        logger.info(f"{key.capitalize()} already has a timer set for a reminder.")
        return

    reminder_id = str(uuid.uuid4())
    reminder_data = {
        "state": True,
        "scheduled_time": (
            datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)
        ).isoformat(),
        "reminder_id": reminder_id
    }
    set_reminder_data(key, reminder_data)

    role = get_role()
    if not role:
        return

    await send_scheduled_message(
        initial_message,
        f"<@&{role}> {reminder_message}",
        interval,
        key
    )

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
        logger.info(f'Setup requested by {ctx.author.username}.')
        channel_id = channel.id
        role_id = role.id
        logger.info(f"Reminder channel set to <#{channel_id}> and the role set to <@&{role_id}>.")
        
        set_value("reminder_channel", channel_id)
        set_value("role", role_id)

        await ctx.send(f"Reminder setup complete! Nova will use <#{channel_id}> for reminders and the role <@&{role_id}>.")
        logger.info("Reminder setup has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.slash_command(name="status", description="Check the current status of all reminders.")
async def check_status(ctx: interactions.ComponentContext):
    """
    Shows which channel/role are set for reminders, plus how much time
    remains for each known reminder (Disboard, Discadia, DS.me, Unfocused).
    """
    try:
        logger.info(f'Status check requested by {ctx.author.username}.')
        channel_id = get_value("reminder_channel")
        role = get_value("role")
        if not role:
            await ctx.send("No role has been set up for reminders.")
            return
        
        channel_status = f"<#{channel_id}>" if channel_id else "Not set!"
        role_name = f"<@&{role}>" if role else "Not set!"

        disboard_data = get_reminder_data("disboard")
        discadia_data = get_reminder_data("discadia")
        dsme_data = get_reminder_data("dsme")
        unfocused_data = get_reminder_data("unfocused")

        disboard_remaining_time = calculate_remaining_time(disboard_data.get("scheduled_time")) if disboard_data else "Not set!"
        discadia_remaining_time = calculate_remaining_time(discadia_data.get("scheduled_time")) if discadia_data else "Not set!"
        dsme_remaining_time = calculate_remaining_time(dsme_data.get("scheduled_time")) if dsme_data else "Not set!"
        unfocused_remaining_time = calculate_remaining_time(unfocused_data.get("scheduled_time")) if unfocused_data else "Not set!"

        await ctx.send(
            f"**Reminder Status:**\n"
            f"Channel: {channel_status}\n"
            f"Role: {role_name}\n"
            f"Disboard: {disboard_remaining_time}\n"
            f"Discadia: {discadia_remaining_time}\n"
            f"DS.me: {dsme_remaining_time}\n"
            f"Unfocused: {unfocused_remaining_time}"
        )
        logger.info("Status check has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.slash_command(name="testmessage", description="Send a test message to the reminder channel.")
async def test_reminders(ctx: interactions.ComponentContext):
    """
    Sends a quick test ping to confirm that the reminder channel/role setup works.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        role = get_value("role")
        if not role:
            await ctx.send("No role has been set up for reminders.")
            return
        logger.info(f'Test message requested by {ctx.author.username}.')
        await ctx.send(f"<@&{role}> This is a test message!")
        logger.info("Test reminder message has been successfully sent.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: interactions.ComponentContext):
    """
    Simple placeholder command that can be used to maintain or verify developer status.
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f'Developer tag maintenance requested by {ctx.author.username}.')
        await ctx.send("Developer tag maintained!")
        logger.info("Developer tag maintenance has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.slash_command(name="github", description="Send link to the GitHub project for this bot.")
async def github(ctx: interactions.ComponentContext):
    """
    Responds with the GitHub URL where the bot's source code is hosted.
    """
    try:
        logger.info(f'Github link requested by {ctx.author.username}.')
        await ctx.send("https://github.com/doubleangels/Nova")
        logger.info("GitHub link has been successfully sent.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

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
        await ctx.send(f"Backup mode for new members has been {status}.")
        logger.info(f"Backup mode has been {status} by {ctx.author.username}.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

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
        channel_id = channel.id
        role_id = role.id
        set_value("backup_mode_id", role_id)
        set_value("backup_mode_channel", channel_id)
        await ctx.send(f"Channel to welcome new members set to <#{channel_id}>. Role to assign is <@&{role_id}>.")
        logger.info(f"Backup mode channel set to {channel_id} and role set to {role_id} by {ctx.author}.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

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
        await ctx.send(f"Troll mode for new members has been {status}. Minimum account age: {age} days.")
        logger.info(f"Troll mode for new members has been {status}. Account age threshold set to {age} days.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

@interactions.slash_command(
    name="fix",
    description="Runs the logic to add Disboard data to the database under the key name of 'fix'."
)
async def fix_command(ctx: interactions.ComponentContext):
    """
    This command mimics Disboard logic but stores it in the reminders table with the key "fix".
    """
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    
    initial_message = "This is dummy data for the fix command."
    reminder_message = "This is dummy data for the fix command."
    interval = 7200  # 2 hours

    existing_data = get_reminder_data("fix")
    if existing_data and existing_data.get("scheduled_time") is not None:
        await ctx.send("The 'fix' key already has a timer set for a reminder.", ephemeral=True)
        return

    reminder_id = str(uuid.uuid4())
    reminder_data = {
        "state": True,
        "scheduled_time": (
            datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)
        ).isoformat(),
        "reminder_id": reminder_id
    }
    set_reminder_data("fix", reminder_data)

    role = get_role()
    if role:
        channel = await get_channel("reminder_channel")
        if channel:
            await channel.send(initial_message)
    
    await ctx.send("Fix logic has been applied! A new reminder entry was created under the key 'fix'.")

@interactions.slash_command(name="resetreminders", description="Reset all reminders in the database to their default values.")
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

        await ctx.send("All reminders have been reset to their default values.")
        logger.info("All reminders successfully reset.")

    except Exception as e:
        logger.error(f"Error occurred while resetting reminders: {e}")
        await ctx.send("An error occurred while resetting reminders. Please try again later.")

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
    You can specify how many results to display (between 1 and 10).
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
                    if "items" in data and len(data["items"]) > 0:
                        items = data["items"]
                        embeds = []
                        for item in items:
                            title = item.get("title", "No Title Found")
                            link = item.get("link", "No Link Found")
                            snippet = item.get("snippet", "No Description Found")
                            embed = interactions.Embed(
                                title=title,
                                description=f"{snippet}\n[Link]({link})",
                                color=0x1A73E8
                            )
                            embeds.append(embed)
                        await ctx.send(embeds=embeds if embeds else None)
                    else:
                        await ctx.send("No results found for your query. Try refining it.")
                else:
                    logger.warning(f"Google API error: {response.status}")
                    await ctx.send(f"Error: Google API returned status code {response.status}.")
    except Exception as e:
        logger.error(f"Error in /search command: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.")

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
    You can specify how many results to display (between 1 and 10).
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
    except Exception as e:
        logger.error(f"Error in /imagesearch: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.")

@interactions.slash_command(name="ai", description="Ask Gemini a question and get a response.")
@interactions.slash_option(
    name="query",
    description="What do you want to ask Gemini?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def ai_query(ctx: interactions.ComponentContext, query: str):
    """
    Sends a query to Google's Gemini model and returns the generated response as an embed.
    Uses the 'gemini-1.5-flash' model.
    """
    try:
        await ctx.defer()
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=(
                "You are a Discord bot named Nova. Respond to the user's query. They cannot chat back to you for additional "
                "information, so keep that in mind when you respond."
            )
        )
        response = model.generate_content(query)
        ai_response = response.text if response and hasattr(response, "text") else "No response returned from Gemini."

        embed = interactions.Embed(description=ai_response, color=0x1A73E8)
        await ctx.send(embeds=[embed])
    except Exception as e:
        logger.error(f"Error in /ai: {e}")
        await ctx.send("An error occurred while querying the AI. Please try again later.")

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

                        await ctx.send(embeds=embeds if embeds else None)
                    else:
                        await ctx.send("No video results found for your query.")
                else:
                    logger.warning(f"YouTube API error: {response.status}")
                    await ctx.send(f"Error: YouTube API returned status code {response.status}.")
    except Exception as e:
        logger.error(f"Error in /youtube: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.")

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
                    if "query" in data and "search" in data["query"] and data["query"]["search"]:
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
    except Exception as e:
        logger.error(f"Error in /wikipedia: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.")

@interactions.slash_command(name="urban", description="Search Urban Dictionary for definitions.")
@interactions.slash_option(
    name="query",
    description="What term do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def urban_dictionary_search(ctx: interactions.ComponentContext, query: str):
    """
    Searches Urban Dictionary for the given term and displays the top result's definition, example,
    and vote counts. If no entries are found, it notifies the user.
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

                        example = example if example else "No example available."

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
    except Exception as e:
        logger.error(f"Error in /urban: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.")

# -------------------------
# Bot Startup
# -------------------------
try:
    bot.start(TOKEN)
except Exception as e:
    logger.error("Exception occurred during bot startup!", exc_info=True)
    sys.exit(1)
