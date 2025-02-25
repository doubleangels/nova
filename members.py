import datetime
import asyncio
import logging
from supabase_helpers import track_new_member, get_tracked_member, remove_tracked_member, get_all_tracked_members
from logging_setup import logger
from bot_instance import bot

async def schedule_mute_kick(member_id: int, username: str, join_time: str, mute_kick_time: int, guild_id: int):
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        join_time_dt = datetime.datetime.fromisoformat(join_time)
        elapsed_time = (now - join_time_dt).total_seconds()
        remaining_time = (mute_kick_time * 3600) - elapsed_time
        guild = bot.get_guild(guild_id)
        if remaining_time <= 0:
            if not guild:
                logger.info(f"Guild {guild_id} not found. Removing {username} from tracking.")
                remove_tracked_member(member_id)
                return
            member = guild.get_member(member_id)
            if not member:
                logger.info(f"Member {username} not found in guild. Removing from tracking.")
                remove_tracked_member(member_id)
                return
            try:
                await member.kick(reason="User did not send a message in time.")
                remove_tracked_member(member_id)
                logger.info(f"Kicked {username} immediately due to bot restart.")
            except Exception as e:
                logger.warning(f"Failed to kick {username} immediately: {e}")
            return

        async def delayed_kick():
            await asyncio.sleep(remaining_time)
            if get_tracked_member(member_id):
                guild = bot.get_guild(guild_id)
                if not guild:
                    logger.warning(f"Guild {guild_id} not found. Cannot kick {username}.")
                    return
                member = guild.get_member(member_id)
                if not member:
                    try:
                        member = await bot.fetch_member(guild_id, member_id)
                    except Exception as e:
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
