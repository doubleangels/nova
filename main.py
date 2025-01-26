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

# Initialize Sentry for error tracking and performance monitoring
sentry_sdk.init(
    dsn="https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
    traces_sample_rate=1.0,
    profiles_sample_rate=1.0,
)

# Set up logger for both console and file output
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

# Load and check required environment variables
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

# Extract the variables into local constants
TOKEN = required_env_vars["DISCORD_BOT_TOKEN"]
GOOGLE_API_KEY = required_env_vars["GOOGLE_API_KEY"]
SEARCH_ENGINE_ID = required_env_vars["SEARCH_ENGINE_ID"]
IMAGE_SEARCH_ENGINE_ID = required_env_vars["IMAGE_SEARCH_ENGINE_ID"]
GEMINI_API_KEY = required_env_vars["GEMINI_API_KEY"]
SUPABASE_URL = required_env_vars["SUPABASE_URL"]
SUPABASE_KEY = required_env_vars["SUPABASE_KEY"]

# Create a Supabase client instance
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Retrieve a JSON value from the "nova_config" table in Supabase
def get_value(key: str):
    try:
        response = supabase.table("nova_config").select("value").eq("id", key).single().execute()
        if response.data:
            return json.loads(response.data["value"])
    except Exception as e:
        logger.error(f"Error retrieving key '{key}' from Supabase: {e}")
    return None

# Set or update a JSON value in the "nova_config" table in Supabase
def set_value(key: str, value):
    try:
        serialized = json.dumps(value)
        existing = get_value(key)
        # If the key doesn't exist, insert a new entry; otherwise update existing
        if existing is None:
            supabase.table("nova_config").insert({"id": key, "value": serialized}).execute()
        else:
            supabase.table("nova_config").update({"value": serialized}).eq("id", key).execute()
    except Exception as e:
        logger.error(f"Error setting key '{key}' in Supabase: {e}")

# Delete a key/value pair from the "nova_config" table in Supabase
def delete_value(key: str):
    try:
        supabase.table("nova_config").delete().eq("id", key).execute()
    except Exception as e:
        logger.error(f"Error deleting key '{key}' in Supabase: {e}")

# Configure the Gemini generative AI with the provided API key
genai.configure(api_key=GEMINI_API_KEY)

# Create a Discord bot client using the interactions library
bot = interactions.Client(
    intents=(
        interactions.Intents.DEFAULT
        | interactions.Intents.MESSAGE_CONTENT
        | interactions.Intents.GUILD_MEMBERS
    )
)

# Dictionary mapping certain known bot IDs to their names
bot_ids = {
    "302050872383242240": "Disboard",
    "1222548162741538938": "Discadia",
    "493224032167002123": "DS.me",
    "835255643157168168": "Unfocused",
}

# ID for this particular bot (Nova)
nova_id = "835255643157168168"

print("Starting the bot...")

# Gracefully handle interrupt signals to shut down
def handle_interrupt(signal_num, frame):
    logger.info("Gracefully shutting down.")
    sys.exit(0)

signal.signal(signal.SIGINT, handle_interrupt)
signal.signal(signal.SIGTERM, handle_interrupt)

# Retrieve the role ID used for reminders from the database
def get_role():
    try:
        role = get_value("role")
        if not role:
            logger.info("No role has been set up for reminders.")
            return None
        return role
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Retrieve a channel ID from the database and return a channel object
async def get_channel(channel_key):
    try:
        channel_id = get_value(channel_key)
        if not channel_id:
            logger.info(f"No channel has been set for {channel_key}.")
            return None
        return bot.get_channel(channel_id)
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Calculate how much time is left until a scheduled datetime
def calculate_remaining_time(scheduled_time):
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

# Helper to wrap tasks to ensure exceptions are caught properly
async def safe_task(task):
    try:
        await task
    except Exception as e:
        logger.error(f"Exception in scheduled task: {e}")

# Reschedule a reminder if it already has data in the database
async def reschedule_reminder(key, role):
    try:
        reminder_data = get_value(f"{key}_reminder_data")
        if not reminder_data:
            logger.info(f"No reminder data found for {key.title()}.")
            return
        
        scheduled_time = reminder_data.get("scheduled_time")
        reminder_id = reminder_data.get("reminder_id")
        if scheduled_time and reminder_id:
            scheduled_dt = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
            remaining_time = scheduled_dt - datetime.datetime.now(tz=pytz.UTC)
            if remaining_time > datetime.timedelta(seconds=0):
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

# Functions that trigger reminders for known bump/boop services
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
        interval=21600  # 6 hours
    )

async def discadia():
    await handle_reminder(
        key="discadia",
        initial_message="Thanks for bumping the server on Discadia! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Discadia again!",
        interval=43200  # 12 hours
    )

# When the bot is ready, set a custom status and attempt to reschedule any existing reminders
@interactions.listen()
async def on_ready():
    try:
        logger.info("Setting up status and activity...")
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING
            )
        )

        logger.info("Checking for active reminders...")
        role = get_role()
        if not role:
            return
        
        # Attempt to reschedule any reminders found in the database
        for key in ["disboard", "dsme", "unfocused", "discadia"]:
            await reschedule_reminder(key, role)

        logger.info("Active reminders have been checked and rescheduled.")
        logger.info("I am online and ready!")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Listen for messages created in the server, look for known triggers from other bots and handle reminders
@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    try:
        bot_id = str(event.message.author.id)
        message_content = event.message.content
        
        if bot_id in bot_ids:
            bot_name = bot_ids[bot_id]
            logger.info(f"Detected message from {bot_name}.")
        
        # Check for embeds containing specific text for Disboard or DS.me
        if event.message.embeds and len(event.message.embeds) > 0:
            embed = event.message.embeds[0]
            embed_description = embed.description
            if embed_description:
                if "Bump done" in embed_description:
                    await disboard()
                elif "Your vote streak for this server" in embed_description:
                    await dsme()
        else:
            # Look for plain text triggers for Unfocused or Discadia
            if "Your server has been booped" in message_content:
                await unfocused()
            elif "has been successfully bumped" in message_content:
                await discadia()
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Listen for new members joining, handle "backup mode" auto-roles and "troll mode" for kicking new accounts
@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    try:
        # Check settings in the database
        assign_role = get_value("backup_mode_enabled")
        role_id = get_value("backup_mode_id")
        channel_id = get_value("backup_mode_channel")
        kick_users = get_value("troll_mode_enabled")
        kick_users_age_limit = get_value("troll_mode_account_age")

        member = event.member
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at
        account_age_limit = datetime.timedelta(days=kick_users_age_limit) if kick_users_age_limit else datetime.timedelta(days=14)

        # If troll_mode is enabled, check the new member's account age and kick if too new
        if kick_users and account_age < account_age_limit:
            await member.kick(reason="Account is too new!")
            logger.info(f"Kicked {member.username} due to account age.")

        # Check if backup mode is fully configured
        if not (assign_role and role_id and channel_id):
            logger.error("Role assignment or channel announcement cannot proceed, configuration values missing.")
            return

        guild = event.guild
        logger.info(f"New member {member.username} has joined the guild.")

        # If backup mode is enabled, post a welcome message and assign a role
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

# Generic scheduled message sender used by the handle_reminder function
async def send_scheduled_message(initial_message: str, reminder_message: str, interval: int, key: str):
    try:
        channel = await get_channel("reminder_channel")
        if not channel:
            return
        
        # Send an initial message if one is provided
        if initial_message:
            logger.info(f"Sending initial message: {initial_message}")
            await channel.send(initial_message)

        # Wait for the specified interval before sending the reminder
        await asyncio.sleep(interval)

        logger.info(f"Sending reminder message: {reminder_message}")
        await channel.send(reminder_message)

        # Once the reminder is sent, remove the corresponding reminder data from the database
        reminder_data = get_value(f"{key}_reminder_data")
        if reminder_data:
            delete_value(f"{key}_reminder_data")
            logger.info(f"Reminder {reminder_data['reminder_id']} for {key.title()} has been cleaned up from the database.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Handle the logic of starting a new reminder if one is not already set
async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    # If there's already a reminder set for this key, do nothing
    if get_value(f"{key}_reminder_data"):
        logger.info(f"{key.capitalize()} already has a timer set for a reminder.")
        return

    reminder_id = str(uuid.uuid4())
    # Save reminder details in the database so we can reschedule if the bot restarts
    reminder_data = {
        "state": True,
        "scheduled_time": (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
        "reminder_id": reminder_id
    }
    set_value(f"{key}_reminder_data", reminder_data)

    role = get_role()
    if not role:
        return

    # Send the initial message and schedule the reminder
    await send_scheduled_message(
        initial_message,
        f"<@&{role}> {reminder_message}",
        interval,
        key
    )

# Slash command to set up the channel and role used for bump/boop reminders
@interactions.slash_command(name="remindersetup", description="Setup bump and boop reminders.")
@interactions.slash_option(
    name="channel",
    description="Channel",
    required=True,
    opt_type=interactions.OptionType.CHANNEL
)
@interactions.slash_option(
    name="role",
    description="Role",
    required=True,
    opt_type=interactions.OptionType.ROLE
)
async def reminder_setup(ctx: interactions.ComponentContext, channel, role: interactions.Role):
    # Check for administrator permissions
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f'Setup requested by {ctx.author.username}.')
        channel_id = channel.id
        role_id = role.id
        logger.info(f"Reminder channel set to <#{channel_id}> and the role set to <@&{role_id}>.")
        
        # Save the chosen channel and role in the database
        set_value("reminder_channel", channel_id)
        set_value("role", role_id)

        await ctx.send(f"Reminder setup complete! Nova will use <#{channel_id}> for reminders and the role <@&{role_id}>.")
        logger.info("Reminder setup has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to check the status of each reminder (how much time remains, etc.)
@interactions.slash_command(name="status", description="Check the current status of reminders.")
async def check_status(ctx: interactions.ComponentContext):
    try:
        logger.info(f'Status check requested by {ctx.author.username}.')
        channel_id = get_value("reminder_channel")
        role = get_value("role")
        if not role:
            await ctx.send("No role has been set up for reminders.")
            return
        
        channel_status = f"<#{channel_id}>" if channel_id else "Not set!"
        role_name = f"<@&{role}>" if role else "Not set!"

        # Retrieve stored reminder data
        disboard_data = get_value("disboard_reminder_data")
        discadia_data = get_value("discadia_reminder_data")
        dsme_data = get_value("dsme_reminder_data")
        unfocused_data = get_value("unfocused_reminder_data")

        # Calculate remaining time for each of the reminders
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

# Command to send a test message to the reminder channel
@interactions.slash_command(name="testmessage", description="Send a test message.")
async def test_reminders(ctx: interactions.ComponentContext):
    # Check for administrator permissions
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

# Command stub for developer tag maintenance
@interactions.slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: interactions.ComponentContext):
    # Check for administrator permissions
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f'Developer tag maintenance requested by {ctx.author.username}.')
        await ctx.send("Developer tag maintained!")
        logger.info("Developer tag maintenance has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Command to send the GitHub repository link
@interactions.slash_command(name="github", description="Send link to the GitHub project for this bot.")
async def github(ctx: interactions.ComponentContext):
    try:
        logger.info(f'Github link requested by {ctx.author.username}.')
        await ctx.send("https://github.com/doubleangels/Nova")
        logger.info("GitHub link has been successfully sent.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Toggle the "backup mode" which automatically assigns a role to new members upon joining
@interactions.slash_command(name="togglebackupmode", description="Toggle role assignment for new members.")
@interactions.slash_option(
    name="enabled",
    description="Should role assignment for new members be enabled?",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
async def toggle_backup_mode(ctx: interactions.ComponentContext, enabled: bool):
    # Check for administrator permissions
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

# Configure which role to be assigned to new members and which channel to welcome them in
@interactions.slash_command(name="backupmode", description="Set the role to be assigned to new members.")
@interactions.slash_option(
    name="channel",
    description="What channel should new members be welcomed in?",
    required=True,
    opt_type=interactions.OptionType.CHANNEL
)
@interactions.slash_option(
    name="role",
    description="What role should be assigned to new members?",
    required=True,
    opt_type=interactions.OptionType.ROLE
)
async def backup_mode_setup(ctx: interactions.ComponentContext, channel, role: interactions.Role):
    # Check for administrator permissions
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        channel_id = channel.id
        role_id = role.id
        set_value("backup_mode_id", role_id)
        set_value("backup_mode_channel", channel_id)
        await ctx.send(f"Channel to welcome new members has been set to <#{channel_id}> and the role to be assigned is <@&{role_id}>.")
        logger.info(f"Backup mode channel set to {channel_id} and role set to {role_id} by {ctx.author}.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Toggle "troll mode," which kicks newly joined users if their account is under a certain age
@interactions.slash_command(name="trollmode", description="Toggle kicking of accounts with a specified account age threshold.")
@interactions.slash_option(
    name="enabled",
    description="Enable or disable kicking of new accounts.",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
@interactions.slash_option(
    name="age",
    description="What is the minimum account age in days? (Default: 14)",
    required=False,
    opt_type=interactions.OptionType.INTEGER
)
async def toggle_troll_mode(ctx: interactions.ComponentContext, enabled: bool, age: int = 14):
    # Check for administrator permissions
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        set_value("troll_mode_enabled", enabled)
        set_value("troll_mode_account_age", age)
        status = "enabled" if enabled else "disabled"
        await ctx.send(f"Troll mode for new members has been {status} and the account age threshold has been set to {age} days.")
        logger.info(f"Troll mode for new members has been {status}. Account age threshold set to {age} days.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to perform a Google text search
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
    try:
        # Defer the response because we may need time to query the API
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

# Slash command to perform a Google image search
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

# Slash command to query Google's Gemini AI model
@interactions.slash_command(name="ai", description="Ask Gemini a question and get a response.")
@interactions.slash_option(
    name="query",
    description="What do you want to ask Gemini?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def ai_query(ctx: interactions.ComponentContext, query: str):
    try:
        await ctx.defer()
        # Create a GenerativeModel instance and generate a response
        model = genai.GenerativeModel(
            model_name="gemini-1.5-pro",
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

# Slash command to search YouTube for videos
@interactions.slash_command(name="youtube", description="Search YouTube for videos and return the top result.")
@interactions.slash_option(
    name="query",
    description="What videos do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def youtube_video_search(ctx: interactions.ComponentContext, query: str):
    """
    For simplicity, we only return 1 result. If you want more, 
    you can add an integer slash option like in google_search.
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

# Slash command to search Wikipedia for articles
@interactions.slash_command(name="wikipedia", description="Search Wikipedia for articles and return the top result.")
@interactions.slash_option(
    name="query",
    description="What topic do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def wikipedia_search(ctx: interactions.ComponentContext, query: str):
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

# Slash command to search Urban Dictionary
@interactions.slash_command(name="urban", description="Search Urban Dictionary for definitions.")
@interactions.slash_option(
    name="query",
    description="What term do you want to search for?",
    required=True,
    opt_type=interactions.OptionType.STRING
)
async def urban_dictionary_search(ctx: interactions.ComponentContext, query: str):
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

# Start the bot with the provided token, and handle any exceptions that occur during startup
try:
    bot.start(TOKEN)
except Exception as e:
    logger.error("Exception occurred during bot startup!", exc_info=True)
    sys.exit(1)
