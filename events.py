import asyncio
import datetime
import pytz
import logging
from interactions import listen, Status, Activity, ActivityType
from logging_setup import logger
from supabase_helpers import get_value, set_value, get_reminder_data, delete_reminder_data, get_tracked_member, remove_tracked_member
from reminders import initialize_reminders_table, reschedule_reminder
from members import schedule_mute_kick
from bot_instance import bot

# Helper function to retrieve a channel from configuration
async def get_channel(channel_key):
    try:
        channel_id = get_value(channel_key)
        if not channel_id:
            logger.warning(f"No channel set for '{channel_key}'.")
            return None
        channel_obj = bot.get_channel(channel_id)
        if channel_obj:
            logger.debug(f"Retrieved channel: {channel_obj.name}")
        else:
            logger.debug("Channel not found.")
        return channel_obj
    except Exception as e:
        logger.exception(f"Error fetching channel for key '{channel_key}': {e}")
        return None

@listen()
async def on_ready():
    try:
        logger.info("Bot is online! Setting up presence.")
        await bot.change_presence(
            status=Status.ONLINE,
            activity=Activity(
                name="for ways to assist!",
                type=ActivityType.WATCHING,
            ),
        )
        logger.debug("Bot presence set.")
        initialize_reminders_table()
        logger.debug("Checking for active reminders.")
        role = get_value("role")
        if not role:
            logger.warning("No role set for reminders; skipping reminder reschedule.")
        else:
            for key in ["disboard", "dsme", "unfocused", "discadia"]:
                logger.debug(f"Rescheduling {key} reminder.")
                await reschedule_reminder(key, role)
        logger.info("Ensuring mute and troll mode settings exist...")
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
            logger.info("Mute mode is disabled.")
        else:
            logger.info("Rescheduling mute mode kicks...")
            tracked_users = get_all_tracked_members()
            for user in tracked_users:
                member_id = user["member_id"]
                username = user["username"]
                join_time = user["join_time"]
                await schedule_mute_kick(member_id, username, join_time, mute_kick_time, bot.guilds[0].id)
            logger.info("Mute mode kicks rescheduled.")
        logger.info("Bot is ready!")
    except Exception as e:
        logger.exception(f"Error in on_ready event: {e}")

@listen()
async def on_message_create(event):
    try:
        logger.debug(f"Message from {event.message.author.username}")
        if get_tracked_member(event.message.author.id):
            remove_tracked_member(event.message.author.id)
            logger.debug(f"User {event.message.author.username} removed from mute tracking.")
        if str(event.message.author.id) in {
            "302050872383242240": "Disboard",
            "1222548162741538938": "Discadia",
            "493224033067003023": "DS.me",
            "835255643157168168": "Unfocused",
        }:
            logger.debug(f"Message from known bump bot {event.message.author.username}")
        if event.message.embeds:
            embed = event.message.embeds[0]
            description = embed.description or ""
            logger.debug(f"Embed detected: {description}")
            if "Bump done" in description:
                from commands.admin import disboard
                await disboard()
            elif "Your vote streak for this server" in description:
                from commands.admin import dsme
                await dsme()
        else:
            if "Your server has been booped" in event.message.content:
                from commands.admin import unfocused
                await unfocused()
            elif "has been successfully bumped" in event.message.content:
                from commands.admin import discadia
                await discadia()
    except Exception as e:
        logger.exception(f"Error in on_message_create event: {e}")

@listen()
async def on_member_join(event):
    try:
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
        logger.debug(f"New member: {member.username} | Account Age: {account_age.days} days")
        if member.bot:
            logger.debug(f"Skipping mute tracking for bot {member.username}")
            return
        if kick_users and account_age < datetime.timedelta(days=kick_users_age_limit):
            await member.kick(reason="Account is too new!")
            logger.debug(f"Kicked {member.username} for account age below {kick_users_age_limit} days.")
            return
        if mute_mode_enabled:
            join_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
            logger.debug(f"Tracking {member.username} for mute mode.")
            track_new_member(member.id, member.username, join_time)
            await schedule_mute_kick(member.id, member.username, join_time, mute_kick_time, guild.id)
        if not (assign_role and role_id and channel_id):
            logger.debug("Backup mode not fully configured.")
            return
        channel = guild.get_channel(channel_id) if channel_id else None
        if not channel:
            logger.warning(f"Channel {channel_id} not found.")
            return
        embed = {
            "title": f"🎉 Welcome {member.username}!",
            "description": "Please introduce yourself and send at least one message to avoid auto-kick.",
            "color": 0xCD41FF,
        }
        await channel.send(embeds=[embed])
        role_obj = guild.get_role(role_id) if role_id else None
        if role_obj:
            await member.add_role(role_obj)
            logger.debug(f"Assigned role {role_obj.name} to {member.username}.")
        else:
            logger.warning(f"Role {role_id} not found.")
    except Exception as e:
        logger.exception(f"Error in on_member_join event: {e}")

@listen()
async def on_member_remove(event):
    try:
        member = event.member
        guild = event.guild
        logger.debug(f"Member left: {member.username} from {guild.name}. Removing from tracking.")
        remove_tracked_member(member.id)
    except Exception as e:
        logger.exception(f"Error in on_member_remove event: {e}")

def register_events():
    # Simply importing this module will register the listeners.
    pass
