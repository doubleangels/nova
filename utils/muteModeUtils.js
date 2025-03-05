const logger = require('../logger')('muteModeUtils.js');
const dayjs = require('dayjs');
const { getValue, getAllTrackedMembers, removeTrackedMember, getTrackedMember } = require('../utils/database');

/**
 * Schedules a mute kick for a member if they do not send a message within the allowed mute time.
 *
 * This function calculates the remaining time based on the member's join time and the allowed mute time.
 * If the remaining time is less than or equal to zero, the member is kicked immediately.
 * Otherwise, a delayed kick is scheduled.
 *
 * @param {string} memberId - The ID of the member to be kicked.
 * @param {string} username - The username of the member.
 * @param {string} joinTime - The ISO string representing when the member joined.
 * @param {number} muteKickTime - The allowed mute time in hours before a kick.
 * @param {string} guildId - The ID of the guild.
 * @param {Client} client - The Discord client instance.
 */
async function scheduleMuteKick(memberId, username, joinTime, muteKickTime, guildId, client) {
  try {
    logger.debug(
      `Scheduling mute kick for member '${username}' (ID: ${memberId}) in guild ${guildId}. Join time: ${joinTime}, allowed mute time: ${muteKickTime} hour(s).`
    );
    
    const now = dayjs();
    const joinTimeDt = dayjs(joinTime);
    const elapsedTime = now.diff(joinTimeDt, 'second');
    logger.debug(
      `Current time: ${now.toISOString()}, Join time: ${joinTimeDt.toISOString()}, Elapsed time: ${elapsedTime} second(s).`
    );
    
    // Calculate remaining time (in seconds) before the kick should occur.
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Remaining time before kick for member '${username}': ${remainingTime.toFixed(2)} second(s).`);
    
    if (!client) {
      logger.error("Discord client is undefined. Cannot schedule mute kick without client instance.");
      return;
    }
    
    // Get the guild object from the client.
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) {
      logger.warn(`Guild with ID ${guildId} not found. Removing tracked member '${username}' (ID: ${memberId}).`);
      await removeTrackedMember(memberId);
      return;
    }
    
    // If remaining time is less than or equal to 0, kick immediately.
    if (remainingTime <= 0) {
      let member = guildObj.members.cache.get(memberId);
      if (!member) {
        try {
          // Attempt to fetch the member from the API if not cached.
          member = await guildObj.members.fetch(memberId);
          logger.debug(`Member '${username}' (ID: ${memberId}) fetched from API for immediate kick.`);
        } catch (e) {
          logger.info(`Member '${username}' (ID: ${memberId}) not found (may have left). Removing from tracking.`, { error: e.message });
          await removeTrackedMember(memberId);
          return;
        }
      }
      
      try {
        await member.kick("User did not send a message in time.");
        await removeTrackedMember(memberId);
        logger.info(`Member '${username}' (ID: ${memberId}) kicked immediately due to mute timeout.`);
      } catch (e) {
        logger.warn(`Failed to kick member '${username}' (ID: ${memberId}) immediately: ${e.message}`, { error: e });
      }
      return;
    }
    
    // Define the delayed kick function.
    async function delayedKick() {
      logger.debug(
        `Delayed kick initiated for member '${username}' (ID: ${memberId}). Scheduled in ${remainingTime.toFixed(2)} second(s).`
      );
      // Wait for the remaining time (converted to milliseconds).
      await new Promise(resolve => setTimeout(resolve, remainingTime * 1000));
      
      // Check if the member is still being tracked.
      const tracked = await getTrackedMember(memberId);
      if (tracked) {
        const guildNow = client.guilds.cache.get(guildId);
        if (!guildNow) {
          logger.warn(`Guild with ID ${guildId} not found at delayed kick time for member '${username}'.`);
          return;
        }
        let memberNow = guildNow.members.cache.get(memberId);
        if (!memberNow) {
          try {
            memberNow = await guildNow.members.fetch(memberId);
            logger.debug(`Member '${username}' (ID: ${memberId}) fetched during delayed kick.`);
          } catch (e) {
            logger.info(`Member '${username}' (ID: ${memberId}) not found during delayed kick. Removing from tracking.`, { error: e.message });
            await removeTrackedMember(memberId);
            return;
          }
        }
        try {
          await memberNow.kick("User did not send a message in time.");
          await removeTrackedMember(memberId);
          logger.info(`Member '${username}' (ID: ${memberId}) kicked after scheduled delay.`);
        } catch (e) {
          logger.warn(`Failed to kick member '${username}' (ID: ${memberId}) after delay: ${e.message}`, { error: e });
        }
      } else {
        logger.debug(`Member '${username}' (ID: ${memberId}) is no longer tracked at delayed kick time.`);
      }
    }
    
    // Schedule the delayed kick to run immediately in the event loop.
    setTimeout(delayedKick, 0);
    logger.debug(`Delayed kick for member '${username}' (ID: ${memberId}) scheduled successfully.`);
  } catch (e) {
    logger.error(`Error scheduling mute kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
  }
}

/**
 * Reschedules mute kicks for all tracked members.
 *
 * This function retrieves all tracked members from the database and schedules a mute kick for each
 * based on the configured mute kick time.
 *
 * @param {Client} client - The Discord client instance.
 */
async function rescheduleAllMuteKicks(client) {
  try {
    const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours"), 10) || 4;
    const trackedMembers = await getAllTrackedMembers();
    if (!trackedMembers || trackedMembers.length === 0) {
      logger.debug("No tracked members found for mute kick rescheduling.");
      return;
    }
    
    if (client.guilds.cache.size > 0) {
      // Use the first guild's ID (assuming a single-guild scenario).
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
      logger.warn("Bot is not in any guilds; cannot reschedule mute kicks.");
    }
  } catch (e) {
    logger.error(`Error rescheduling mute kicks on startup: ${e.message}`, { error: e });
  }
}

module.exports = {
  scheduleMuteKick,
  rescheduleAllMuteKicks
};
