import interactions
import asyncio
import os
import datetime
import pytz
import pickledb
import uuid
import sys
import signal
import logging
from logging.handlers import RotatingFileHandler

# Initialize logging with rotating file handler and console handler
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Rotating file handler
file_handler = RotatingFileHandler("bot.log", maxBytes=2000000, backupCount=5)
file_handler.setLevel(logging.INFO)

# Console handler to output to stdout (Docker reads this output)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

# Formatter for both handlers
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

# Add handlers to logger
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Load the bot token from environment variables
TOKEN = os.getenv('DISCORD_BOT_TOKEN')
if not TOKEN:
    logger.error("DISCORD_BOT_TOKEN not found in environment variables.")
    sys.exit(1)

# Load or create a PickleDB database to store persistent data
db = pickledb.load('db/pickle.db', True)

# Initialize the bot with default intents and MESSAGE_CONTENT to capture messages
bot = interactions.Client(intents=interactions.Intents.DEFAULT | interactions.Intents.MESSAGE_CONTENT | interactions.Intents.GUILD_MEMBERS)

# Dictionary to map specific bot IDs to bot names for easy identification
bot_ids = {
    "302050872383242240": "Disboard",
    "1222548162741538938": "Discadia",
    "493224032167002123": "DS.me",
    "835255643157168168": "Unfocused",
}

# Nova's ID for use in the bot
nova_id = "835255643157168168"

print("Starting the bot...")

# Graceful shutdown handler to save data before bot shutdown
def handle_interrupt(signal, frame):
    logger.info("Gracefully shutting down. Saving reminders...")
    db.dump()  # Ensure all data is saved
    sys.exit(0)

signal.signal(signal.SIGINT, handle_interrupt)
signal.signal(signal.SIGTERM, handle_interrupt)

# Helper function to retrieve role from the database
def get_role():
    try:
        role = db.get('role')
        if not role:
            logger.info("No role has been set up for reminders.")
            return None
        return role
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Helper function to retrieve channel from the database
async def get_channel(channel_key):
    try:
        channel_id = db.get(channel_key)
        if not channel_id:
            logger.info(f"No channel has been set for {channel_key}.")
            return None
        return bot.get_channel(channel_id)
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Helper function to calculate remaining time from the scheduled time
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

# Helper function to ensure tasks are ran in a safe manner
async def safe_task(task):
    try:
        await task
    except Exception as e:
        logger.error(f"Exception in scheduled task: {e}")

# Helper function to reschedule reminders
async def reschedule_reminder(key, role):
    try:
        reminder_data = db.get(f"{key}_reminder_data")
        if not reminder_data:
            logger.info(f"No reminder data found for {key.title()}.")
            return
        
        scheduled_time = reminder_data.get("scheduled_time")
        reminder_id = reminder_data.get("reminder_id")
        if scheduled_time and reminder_id:
            scheduled_time = datetime.datetime.fromisoformat(scheduled_time).astimezone(pytz.UTC)
            # Calculate the remaining time until the reminder should be sent
            remaining_time = scheduled_time - datetime.datetime.now(tz=pytz.UTC)
            if remaining_time > datetime.timedelta(seconds=0):
                # Reschedule the reminder if time remains
                logger.info(f"Rescheduling reminder {reminder_id} for {key.title()}.")
                asyncio.create_task(safe_task(send_scheduled_message(
                    initial_message=None,
                    reminder_message=f"<@&{role}> It's time to bump on {key.title()}!" if key in ['disboard', 'dsme', 'discadia'] else f"<@&{role}> It's time to boop on {key.title()}!",
                    interval=remaining_time.total_seconds(),
                    key=key
                )))
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")


# Function to handle Disboard bump reminder
async def disboard():
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Disboard again!",
        interval=7200  # Disboard reminders typically need to be repeated every 2 hours (7200 seconds)
    )

# Function to handle DS.me vote reminder
async def dsme():
    await handle_reminder(
        key="dsme",
        initial_message="Thanks for voting for the server on DS.me! I'll remind you when it's time to vote again.",
        reminder_message="It's time to vote for the server on DS.me again!",
        interval=43200  # Example interval, adjust as needed
    )

# Function to handle Unfocused reminder (boop)
async def unfocused():
    await handle_reminder(
        key="unfocused",
        initial_message="Thanks for booping the server on Unfocused! I'll remind you when it's time to boop again.",
        reminder_message="It's time to boop the server on Unfocused again!",
        interval=21600  # Example interval, adjust as needed
    )

# Function to handle Discadia bump reminder
async def discadia():
    await handle_reminder(
        key="discadia",
        initial_message="Thanks for bumping the server on Discadia! I'll remind you when it's time to bump again.",
        reminder_message="It's time to bump the server on Discadia again!",
        interval=43200  # Example interval, adjust as needed
    )

# Event listener for when the bot becomes online and is ready
@interactions.listen()
async def on_ready():
    try:    
        logger.info("Setting up status and activity...")
        # Set the bot's presence (status and activity)
        await bot.change_presence(
            status=interactions.Status.ONLINE,
            activity=interactions.Activity(
                name="for ways to assist!",
                type=interactions.ActivityType.WATCHING
            )
        )

        logger.info("Checking for active reminders...")

        # Retrieve the role to mention for reminders
        role = get_role()
        if not role:
            return
        
        # Check and reschedule reminders if there are active timers when the bot starts
        for key in ['disboard', 'dsme', 'unfocused']:
            await reschedule_reminder(key, role)
        logger.info("Active reminders have been checked and rescheduled.")
        logger.info("I am online and ready!")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Event listener to handle message creation (whenever a new message is sent)
@interactions.listen()
async def on_message_create(event: interactions.api.events.MessageCreate):
    try:
        bot_id = str(event.message.author.id)
        message_content = event.message.content
        
        # Check if the message is from one of the specific bots (Disboard, Discadia, DS.me, or Unfocused)
        if bot_id in bot_ids:
            bot_name = bot_ids[bot_id]
            logger.info(f"Detected message from {bot_name}.")
        
        # If the message contains an embed, check for specific text to trigger reminders
        if event.message.embeds and len(event.message.embeds) > 0:
            embed = event.message.embeds[0]
            embed_description = embed.description
            if embed_description:
                if "Bump done" in embed_description:
                    await disboard()
                elif "Your vote streak for this server" in embed_description:
                    await dsme()
        else:
            # Look for specific keywords in plain message content
            if "Your server has been booped" in message_content:
                await unfocused()
            elif "has been successfully bumped" in message_content:
                await discadia()
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Function to handle new member join and assign a role
@interactions.listen()
async def on_member_join(event: interactions.api.events.MemberAdd):
    try:
        assign_role = db.get("backup_mode_enabled")
        role_id = db.get("backup_mode_id")
        channel_id = db.get("backup_mode_channel")
        member = event.member  # Get the member who joined

        # Ensure required values are set
        if not (assign_role and role_id and channel_id):
            logger.error("Role assignment or channel announcement cannot proceed, configuration values missing.")
            return

        guild = event.guild  # Access the guild where the member joined
        logger.info(f"New member {member.username} has joined the guild.")
        if assign_role and role_id:
            channel = guild.get_channel(channel_id)
            embed = interactions.Embed(
                title=f"Welcome {member.username}!",
                description=(
                    f"• **How old are you?**\n• Where are you from?\n• What do you do in your free time?\n• What is your address?\n• What do you do to earn your daily bread in the holy church of our lord and savior Cheesus Driftus?\n• What's your blood type?\n• What's your shoe size?\n• Can we donate your organs to ... \"charity\"?\n"
                ),
                color=0xcd41ff
            )
            await channel.send(embeds=[embed])
            role = guild.get_role(role_id)
            if role:
                await member.add_role(role)
                logger.info(f"Assigned role {role.name} to new member {member.username}.")
            else:
                logger.error(f"Role with ID {role_id} not found in the guild.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Function to send scheduled reminder messages after a delay
async def send_scheduled_message(initial_message: str, reminder_message: str, interval: int, key: str):
    try:
        # Retrieve the channel where reminders should be sent
        channel = await get_channel('reminder_channel')
        if not channel:
            return
        
        # Send the initial message, if provided
        logger.info(f"Sending initial message: {initial_message}")
        if initial_message:
            await channel.send(initial_message)
        
        # Wait for the specified interval (in seconds)
        await asyncio.sleep(interval)
        
        # Send the reminder message after the delay
        logger.info(f"Sending reminder message: {reminder_message}")
        await channel.send(reminder_message)
        
        # Clean up the reminder from the database after it has been sent
        reminder_data = db.get(f"{key}_reminder_data")
        if reminder_data:
            db.rem(f"{key}_reminder_data")
            db.dump()
            logger.info(f"Reminder {reminder_data['reminder_id']} for {key.title()} has been cleaned up from the database.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")
    
# Function to handle setting up and managing reminders for different services
async def handle_reminder(key: str, initial_message: str, reminder_message: str, interval: int):
    # Check if a reminder is already set for this service
    if db.get(f"{key}_reminder_data"):
        logger.info(f"{key.capitalize()} already has a timer set for a reminder.")
        return

    # Generate a unique ID for this reminder
    reminder_id = str(uuid.uuid4())

    # Store reminder state and timing info in the database
    reminder_data = {
        "state": True,
        "scheduled_time": (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=interval)).isoformat(),
        "reminder_id": reminder_id
    }
    db.set(f"{key}_reminder_data", reminder_data)
    db.dump()
    
    # Retrieve the role to mention for reminders
    role = get_role()
    if not role:
        return
    
    # Send the initial and scheduled reminder message
    await send_scheduled_message(
        initial_message,
        f"<@&{role}> {reminder_message}",
        interval,
        key
    )

# Slash command to set up the reminder functionality of the bot
@interactions.slash_command(name="remindersetup", description="Setup the reminders")
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
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f'Setup requested by {ctx.author.username}.')
        channel_id = channel.id
        role_id = role.id
        logger.info(f"Reminder channel set to <#{channel_id}> and the role set to <@&{role_id}>.")
        
        # Store channel and role information in the database
        db.set('reminder_channel', channel_id)
        db.set('role', role_id)
        db.dump()  # Ensure data is saved

        # Send a confirmation message
        await ctx.send(f"Reminder setup complete! Nova will use <#{channel_id}> for reminders and the role <@&{role_id}>.")
        logger.info("Reminder setup has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to check the current status of reminders
@interactions.slash_command(name="status", description="Check the current status of reminders")
async def check_status(ctx: interactions.ComponentContext):
    try:
        logger.info(f'Status check requested by {ctx.author.username}.')
        channel_id = db.get('reminder_channel')

        role = db.get('role')
        if not role:
            await ctx.send("No role has been set up for reminders.")
            return
        channel_status = f"<#{channel_id}>" if channel_id else "Not set!"
        role_name = f"<@&{role}>" if role else "Not set!"

        disboard_data = db.get('disboard_reminder_data')
        disboard_scheduled_time = disboard_data.get('scheduled_time') if disboard_data else None
        disboard_remaining_time = calculate_remaining_time(disboard_scheduled_time) if disboard_scheduled_time else "Not set!"
        discadia_data = db.get('discadia_reminder_data')
        discadia_scheduled_time = discadia_data.get('scheduled_time') if discadia_data else None
        discadia_remaining_time = calculate_remaining_time(discadia_scheduled_time) if discadia_scheduled_time else "Not set!"
        dsme_data = db.get('dsme_reminder_data')
        dsme_scheduled_time = dsme_data.get('scheduled_time') if dsme_data else None
        dsme_remaining_time = calculate_remaining_time(dsme_scheduled_time) if dsme_scheduled_time else "Not set!"
        unfocused_data = db.get('unfocused_reminder_data')
        unfocused_scheduled_time = unfocused_data.get('scheduled_time') if unfocused_data else None
        unfocused_remaining_time = calculate_remaining_time(unfocused_scheduled_time) if unfocused_scheduled_time else "Not set!"

        # Send the status message with current reminder info
        await ctx.send(f"**Reminder Status:**\n"
                    f"Channel: {channel_status}\n"
                    f"Role: {role_name}\n"
                    f"Disboard: {disboard_remaining_time}\n"
                    f"Discadia: {discadia_remaining_time}\n"
                    f"DS.me: {dsme_remaining_time}\n"
                    f"Unfocused: {unfocused_remaining_time}")
        logger.info("Status check has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to send a test reminder message
@interactions.slash_command(name="testmessage", description="Send a test message")
async def test_reminders(ctx: interactions.ComponentContext):
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        role = db.get('role')
        if not role:
            await ctx.send("No role has been set up for reminders.")
            return
        logger.info(f'Test message requested by {ctx.author.username}.')
        await ctx.send(f"<@&{role}> This is a test message!")
        logger.info("Test reminder message has been successfully sent.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to maintain developer tag
@interactions.slash_command(name="dev", description="Maintain developer tag")
async def dev(ctx: interactions.ComponentContext):
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        logger.info(f'Developer tag maintenance requested by {ctx.author.username}.')
        await ctx.send("Developer tag maintained!")
        logger.info("Developer tag maintenance has been successfully completed.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to send the GitHub link for the project
@interactions.slash_command(name="github", description="Send link to the GitHub project for this bot")
async def github(ctx: interactions.ComponentContext):
    try:
        logger.info(f'Github link requested by {ctx.author.username}.')
        await ctx.send("https://github.com/doubleangels/Nova")
        logger.info("GitHub link has been successfully sent.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to toggle role assignment functionality on/off
@interactions.slash_command(name="togglebackupmode", description="Toggle role assignment for new members")
@interactions.slash_option(
    name="enabled",
    description="Enabled",
    required=True,
    opt_type=interactions.OptionType.BOOLEAN
)
async def toggle_backup_mode(ctx: interactions.ComponentContext, enabled: bool):
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        db.set("backup_mode_enabled", enabled)
        db.dump()
        status = "enabled" if enabled else "disabled"
        await ctx.send(f"Backup mode for new members has been {status}.")
        logger.info(f"Backup mode has been {status} by {ctx.author.username}.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

# Slash command to set the role to be assigned to new members
@interactions.slash_command(name="backupmode", description="Set the role to be assigned to new members")
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
async def backup_mode_setup(ctx: interactions.ComponentContext, channel, role: interactions.Role):
    if not ctx.author.has_permission(interactions.Permissions.ADMINISTRATOR):
        await ctx.send("You do not have permission to use this command.", ephemeral=True)
        return
    try:
        channel_id = channel.id
        role_id = role.id
        db.set("backup_mode_id", role.id)
        db.set("backup_mode_channel", channel_id)
        db.dump()
        await ctx.send(f"Channel to welcome new members has been set to <#{channel_id}> and the role to be assigned is <@&{role.id}>.")
        logger.info(f"Backup mode channel set to {channel_id} and role set to {role_id} by {ctx.author}.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")


try:
    # Start the bot using the token
    bot.start(TOKEN)
except Exception as e:
    logger.error("Exception occurred during bot startup!", exc_info=True)
    sys.exit(1)
