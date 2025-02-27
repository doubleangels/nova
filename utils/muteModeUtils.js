const logger = require('../logger');
const { getValue, getTrackedMember, removeTrackedMember, getAllTrackedMembers } = require('./supabase');

/**
 * Schedules a kick for a member under mute mode.
 * Calculates elapsed time since the member joined and determines the remaining time before a kick should occur.
 * If the remaining time is ≤ 0, attempts an immediate kick; otherwise, schedules a delayed kick.
 *
 * @param {string|number} memberId - The unique ID of the member.
 * @param {string} username - The member's username.
 * @param {string} joinTime - The time the member joined (ISO-formatted string).
 * @param {number} muteKickTime - The allowed time in hours before the member is kicked.
 * @param {string} guildId - The ID of the guild where the kick should occur.
 * @param {object} client - The Discord client.
 */
async function scheduleMuteKick(memberId, username, joinTime, muteKickTime, guildId, client) {
  try {
    logger.debug(`Scheduling mute kick for member '${username}' (ID: ${memberId}) in guild ${guildId}. Join time: ${joinTime}, allowed mute time: ${muteKickTime} hours.`);
    
    // Calculate elapsed time since join (in seconds)
    const now = new Date();
    const joinTimeDt = new Date(joinTime);
    const elapsedTime = (now - joinTimeDt) / 1000;
    logger.debug(`Current time: ${now.toISOString()}, Join time: ${joinTimeDt.toISOString()}, Elapsed time: ${elapsedTime.toFixed(2)} seconds.`);
    
    // Calculate remaining time (in seconds) before kick is due.
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Calculated remaining time before kick: ${remainingTime.toFixed(2)} seconds.`);
    
    // Retrieve the guild object using its ID.
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warning(`Guild ${guildId} not found.`);
      // Optionally, remove member tracking if the guild is not found.
      await removeTrackedMember(memberId);
      return;
    }
    
    // If remaining time is up or negative, attempt an immediate kick.
    if (remainingTime <= 0) {
      let member = guild.members.cache.get(memberId);
      if (!member) {
        try {
          member = await guild.members.fetch(memberId);
          logger.debug(`Member '${username}' fetched from API for immediate kick.`);
        } catch (e) {
          logger.info(`Member '${username}' not found in the guild (possibly already left). Removing from tracking. Error: ${e}`);
          await removeTrackedMember(memberId);
          return;
        }
      }
      
      try {
        await member.kick("User did not send a message in time.");
        await removeTrackedMember(memberId);
        logger.info(`Member '${username}' (ID: ${memberId}) kicked immediately due to mute timeout.`);
      } catch (e) {
        logger.warning(`Failed to kick member '${username}' immediately after bot restart: ${e}`);
      }
      return;
    }
    
    // Define a delayed kick function.
    async function delayedKick() {
      logger.debug(`Delayed kick scheduled to occur in ${remainingTime.toFixed(2)} seconds for member '${username}' (ID: ${memberId}).`);
      // Wait for the remaining time.
      await new Promise(resolve => setTimeout(resolve, remainingTime * 1000));
      
      // Verify the member is still tracked before proceeding.
      const tracked = await getTrackedMember(memberId);
      if (tracked) {
        const guildNow = client.guilds.cache.get(guildId);
        if (!guildNow) {
          logger.warning(`Guild ${guildId} not found at delayed kick time. Cannot kick member '${username}'.`);
          return;
        }
        let memberNow = guildNow.members.cache.get(memberId);
        if (!memberNow) {
          try {
            memberNow = await guildNow.members.fetch(memberId);
            logger.debug(`Member '${username}' fetched during scheduled kick.`);
          } catch (e) {
            logger.info(`Member '${username}' not found during scheduled kick. Removing from tracking. Error: ${e}`);
            await removeTrackedMember(memberId);
            return;
          }
        }
        try {
          await memberNow.kick("User did not send a message in time.");
          await removeTrackedMember(memberId);
          logger.info(`Member '${username}' (ID: ${memberId}) kicked after scheduled delay.`);
        } catch (e) {
          logger.warning(`Failed to kick member '${username}' after scheduled delay: ${e}`);
        }
      } else {
        logger.debug(`Member '${username}' (ID: ${memberId}) is no longer tracked at delayed kick time.`);
      }
    }
    
    // Schedule the delayed kick as a background task.
    setTimeout(delayedKick, 0);
    logger.debug(`Scheduled delayed kick for member '${username}' in ${remainingTime.toFixed(2)} seconds.`);
  } catch (e) {
    logger.error(`Error scheduling mute mode kick for member '${username}' (ID: ${memberId}): ${e}`);
  }
}

/**
 * Reschedules all pending mute kicks on startup.
 * Retrieves all tracked members from the 'tracked_members' table and calls scheduleMuteKick
 * for each one so that any pending kick is rescheduled.
 *
 * @param {object} client - The Discord client.
 */
async function rescheduleAllMuteKicks(client) {
  try {
    const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours")) || 4;
    const trackedMembers = await getAllTrackedMembers();
    if (!trackedMembers || trackedMembers.length === 0) {
      logger.debug("No tracked members found to reschedule mute kicks.");
      return;
    }
    
    if (client.guilds.cache.size > 0) {
      // Use the first guild's ID (assuming a single guild scenario).
      const guildId = client.guilds.cache.first().id;
      for (const memberData of trackedMembers) {
        logger.debug(`Rescheduling mute kick for tracked member: ${JSON.stringify(memberData)}`);
        await scheduleMuteKick(
          memberData.member_id,
          memberData.username,
          memberData.join_time,
          muteKickTime,
          guildId,
          client
        );
      }
    } else {
      logger.warning("Bot is not in any guilds; cannot reschedule mute kicks.");
    }
  } catch (e) {
    logger.error(`Error while rescheduling mute kicks on startup: ${e}`);
  }
}

module.exports = {
  scheduleMuteKick,
  rescheduleAllMuteKicks
};
