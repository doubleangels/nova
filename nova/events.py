import datetime
import pytz
import logging
from interactions import Embed
from nova.bot_client import bot
import nova.database as db
import nova.reminders as reminders
import nova.mute_mode as mute_mode

logger = logging.getLogger("Nova")

@bot.listen()
async def on_ready():
    try:
        logger.info("Bot is online! Setting up status and activity.")
        await bot.change_presence(
            status="online",
            activity={"name": "for ways to assist!", "type": "WATCHING"}
        )
        logger.debug("Bot presence and activity set.")

        db.initialize_reminders_table()
        logger.debug("Checking for active reminders.")

        role = reminders.get_role()
        if not role:
            logger.warning("No role set for reminders; skipping reminder reschedule.")
        else:
            for key in ["disboard", "dsme", "unfocused", "discadia"]:
                logger.debug(f"Attempting to reschedule {key} reminder.")
                await reminders.reschedule_reminder(key, role)
                logger.debug(f"Reminder {key} successfully rescheduled.")

        if db.get_value("mute_mode") is None:
            db.set_value("mute_mode", False)
        if db.get_value("mute_mode_kick_time_hours") is None:
            db.set_value("mute_mode_kick_time_hours", 4)
        if db.get_value("troll_mode") is None:
            db.set_value("troll_mode", False)
        if db.get_value("troll_mode_account_age") is None:
            db.set_value("troll_mode_account_age", 30)

        mute_mode_enabled = str(db.get_value("mute_mode")).lower() == "true"
        mute_kick_time = int(db.get_value("mute_mode_kick_time_hours") or 4)

        if not mute_mode_enabled:
            logger.info("Mute mode is disabled. Skipping rescheduling.")
        else:
            logger.info("Rescheduling mute mode kicks...")
            tracked_users = db.get_all_tracked_members()
            for user in tracked_users:
                member_id = user["member_id"]
                username = user["username"]
                join_time = user["join_time"]
                await mute_mode.schedule_mute_kick(member_id, username, join_time, mute_kick_time, bot.guilds[0].id)
            logger.info("All pending mute mode kicks have been rescheduled.")

        logger.info("All reminders checked and settings verified. Bot is ready!")
    except Exception as e:
        logger.exception(f"An unexpected error occurred during on_ready: {e}")

@bot.listen()
async def on_message_create(event):
    try:
        bot_id = str(event.message.author.id)
        message_content = event.message.content
        author_id = event.message.author.id
        author_username = event.message.author.username
        logger.debug(f"Message received from {author_username} (ID: {bot_id})")

        if db.get_tracked_member(author_id):
            db.remove_tracked_member(author_id)
            logger.debug(f"User {author_username} ({author_id}) sent a message and was removed from mute tracking.")

        bot_ids = {
            "302050872383242240": "Disboard",
            "1222548162741538938": "Discadia",
            "493224033067003023": "DS.me",
            "835255643157168168": "Unfocused",
        }
        if bot_id in bot_ids:
            logger.debug(f"Detected message from **{bot_ids[bot_id]}**.")

        if event.message.embeds:
            embed = event.message.embeds[0]
            embed_description = embed.description or ""
            logger.debug(f"Embed detected: {embed_description}")
            if "Bump done" in embed_description:
                logger.debug("Triggering Disboard reminder.")
                await reminders.disboard()
                db.update_bump_stats(author_id, author_username)
            elif "Your vote streak for this server" in embed_description:
                logger.debug("Triggering DSME reminder.")
                await reminders.dsme()
                db.update_bump_stats(author_id, author_username)
        else:
            logger.debug(f"Checking message content: {message_content}")
            if "Your server has been booped" in message_content:
                logger.debug("Triggering Unfocused reminder.")
                await reminders.unfocused()
                db.update_bump_stats(author_id, author_username)
            elif "has been successfully bumped" in message_content:
                logger.debug("Triggering Discadia reminder.")
                await reminders.discadia()
                db.update_bump_stats(author_id, author_username)
    except Exception as e:
        logger.exception(f"Error processing on_message_create event: {e}")

@bot.listen()
async def on_member_join(event):
    try:
        assign_role = db.get_value("backup_mode_enabled") == "true"
        role_id = int(db.get_value("backup_mode_id") or 0)
        channel_id = int(db.get_value("backup_mode_channel") or 0)
        kick_users = db.get_value("troll_mode") == "true"
        kick_users_age_limit = int(db.get_value("troll_mode_account_age") or 30)
        mute_mode_enabled = str(db.get_value("mute_mode")).lower() == "true"
        mute_kick_time = int(db.get_value("mute_mode_kick_time_hours") or 4)

        member = event.member
        guild = event.guild
        account_age = datetime.datetime.now(datetime.timezone.utc) - member.created_at
        logger.debug(f"New member joined: {member.username} (Guild ID: {guild.id}) | Account Age: {account_age.days} days")

        if member.bot:
            logger.debug(f"Skipping mute tracking for bot {member.username} ({member.id})")
            return

        if kick_users and account_age < datetime.timedelta(days=kick_users_age_limit):
            await member.kick(reason="Account is too new!")
            logger.debug(f"Kicked {member.username} for having an account younger than {kick_users_age_limit} days.")
            return

        if mute_mode_enabled:
            join_time = datetime.datetime.now(datetime.UTC).isoformat()
            logger.debug(f"Attempting to track {member.username} ({member.id}) for mute mode.")
            try:
                db.track_new_member(member.id, member.username, join_time)
                logger.debug(f"Successfully tracked {member.username} ({member.id}) for mute mode.")
                await mute_mode.schedule_mute_kick(member.id, member.username, join_time, mute_kick_time, guild.id)
            except Exception as e:
                logger.error(f"Failed to track {member.username} ({member.id}): {e}")

        if not (assign_role and role_id and channel_id):
            logger.debug("Backup mode is not fully configured. Skipping role assignment and welcome message.")
            return

        channel = guild.get_channel(channel_id)
        if not channel:
            logger.warning(f"Channel with ID {channel_id} not found. Welcome message skipped.")
            return

        embed = Embed(
            title=f"🎉 Welcome {member.username}!",
            description=(
                "• **How old are you?**\n"
                "• Where are you from?\n"
                "• What do you do in your free time?\n"
                "• What is your address?\n"
                "• What do you do to earn your daily bread in the holy church of our lord and savior Cheesus Driftus?\n"
                "• What's your blood type?\n"
                "• What's your shoe size?\n"
                "• Can we donate your organs to ... \"charity\"?\n\n"
                "**Please tell us how old you are at least - this is a 21+ server! If you don't send at least one message, you might get automatically kicked.**\n"
            ),
            color=0xCD41FF,
        )
        await channel.send(embeds=[embed])
        logger.debug(f"Sent welcome message in <#{channel_id}> for {member.username}.")

        role_obj = guild.get_role(role_id)
        if role_obj:
            await member.add_role(role_obj)
            logger.debug(f"Assigned role '{role_obj.name}' to {member.username}.")
        else:
            logger.warning(f"Role with ID {role_id} not found in the guild. Role assignment skipped.")
    except Exception as e:
        logger.exception(f"Error during on_member_join event: {e}")

@bot.listen()
async def on_member_remove(event):
    try:
        member = event.member
        guild = event.guild
        logger.debug(f"Member left: {member.username} (ID: {member.id}) from Guild {guild.id}. Removing from mute tracking.")
        db.remove_tracked_member(member.id)
        logger.debug(f"Successfully processed removal for {member.username} ({member.id}).")
    except Exception as e:
        logger.exception(f"Error during on_member_remove event: {e}")
