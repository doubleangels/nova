import asyncio
import datetime
import logging
from nova.bot_client import bot
import nova.database as db

logger = logging.getLogger("Nova")

async def schedule_mute_kick(member_id: int, username: str, join_time: str, mute_kick_time: int, guild_id: int):
    try:
        now = datetime.datetime.now(datetime.UTC)
        join_time_dt = datetime.datetime.fromisoformat(join_time)
        elapsed_time = (now - join_time_dt).total_seconds()
        remaining_time = (mute_kick_time * 3600) - elapsed_time

        if remaining_time <= 0:
            member = bot.get_member(guild_id, member_id)
            if not member:
                logger.info(f"Member {username} ({member_id}) not found in guild {guild_id} (possibly already left). Removing from tracking.")
                db.remove_tracked_member(member_id)
                return
            try:
                await member.kick(reason="User did not send a message in time.")
                db.remove_tracked_member(member_id)
                logger.info(f"Kicked {username} ({member_id}) immediately due to bot restart.")
            except Exception as e:
                logger.warning(f"Failed to kick {username} ({member_id}) immediately after bot restart: {e}")
            return

        async def delayed_kick():
            await asyncio.sleep(remaining_time)
            if db.get_tracked_member(member_id):
                member = bot.get_member(guild_id, member_id)
                if not member:
                    logger.info(f"Member {username} ({member_id}) not found in guild {guild_id} during scheduled kick. Removing from tracking.")
                    db.remove_tracked_member(member_id)
                    return
                try:
                    await member.kick(reason="User did not send a message in time.")
                    db.remove_tracked_member(member_id)
                    logger.info(f"Kicked {username} ({member_id}) after scheduled time.")
                except Exception as e:
                    logger.warning(f"Failed to kick {username} ({member_id}) after scheduled time: {e}")

        asyncio.create_task(delayed_kick())
        logger.debug(f"Scheduled kick for {username} ({member_id}) in {remaining_time:.2f} seconds.")
    except Exception as e:
        logger.exception(f"Error scheduling mute mode kick for {username} ({member_id}): {e}")
