const logger = require('../logger')('muteModeUtils.js');
const dayjs = require('dayjs');
const { getValue, getAllTrackedMembers, removeTrackedMember, getTrackedMember } = require('../utils/database');

// Configuration constants.
const DEFAULT_MUTE_KICK_TIME_HOURS = 4;
const KICK_REASON_TIMEOUT = "User did not send a message in time.";
const IMMEDIATE_TIMEOUT_MS = 0;

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
    
    // Validate client existence first to avoid unnecessary calculations.
    if (!client) {
      logger.error("Discord client is undefined. Cannot schedule mute kick without client instance.");
      return;
    }
    
    const now = dayjs();
    const joinTimeDt = dayjs(joinTime);
    const elapsedTime = now.diff(joinTimeDt, 'second');
    logger.debug(
      `Current time: ${now.toISOString()}, Join time: ${joinTimeDt.toISOString()}, Elapsed time: ${elapsedTime} second(s).`
    );
    
    // Calculate remaining time (in seconds) before the kick should occur.
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Remaining time before kick for member '${username}': ${remainingTime.toFixed(2)} second(s).`);
    
    // Get the guild object from the client.
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) {
      logger.warn(`Guild with ID ${guildId} not found. Removing tracked member '${username}' (ID: ${memberId}).`);
      await removeTrackedMember(memberId);
      return;
    }
    
    // If remaining time is less than or equal to 0, kick immediately.
    if (remainingTime <= 0) {
      await performKick(guildObj, memberId, username, "immediate");
      return;
    }
    
    // Schedule the delayed kick to run asynchronously.
    setTimeout(() => delayedKick(remainingTime), IMMEDIATE_TIMEOUT_MS);
    logger.debug(`Delayed kick for member '${username}' (ID: ${memberId}) scheduled successfully.`);
  } catch (e) {
    logger.error(`Error scheduling mute kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
  }
  
  /**
   * Performs the delayed kick after the scheduled time has passed.
   * @param {number} delaySeconds - The delay in seconds before executing the kick.
   */
  async function delayedKick(delaySeconds) {
    try {
      logger.debug(
        `Delayed kick initiated for member '${username}' (ID: ${memberId}). Scheduled in ${delaySeconds.toFixed(2)} second(s).`
      );
      
      // Wait for the remaining time (converted to milliseconds).
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      
      // Check if the member is still being tracked.
      const tracked = await getTrackedMember(memberId);
      if (!tracked) {
        logger.debug(`Member '${username}' (ID: ${memberId}) is no longer tracked at delayed kick time.`);
        return;
      }
      
      const guildNow = client.guilds.cache.get(guildId);
      if (!guildNow) {
        logger.warn(`Guild with ID ${guildId} not found at delayed kick time for member '${username}'.`);
        return;
      }
      
      await performKick(guildNow, memberId, username, "delayed");
    } catch (e) {
      logger.error(`Error in delayed kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
    }
  }
}

/**
 * Helper function to perform the actual kick operation.
 * 
 * @param {Guild} guild - The Discord guild object.
 * @param {string} memberId - The ID of the member to be kicked.
 * @param {string} username - The username of the member.
 * @param {string} kickType - The type of kick ("immediate" or "delayed").
 */
async function performKick(guild, memberId, username, kickType) {
  try {
    let member = guild.members.cache.get(memberId);
    
    if (!member) {
      try {
        // Attempt to fetch the member from the API if not cached.
        member = await guild.members.fetch(memberId);
        logger.debug(`Member '${username}' (ID: ${memberId}) fetched from API for ${kickType} kick.`);
      } catch (e) {
        logger.info(`Member '${username}' (ID: ${memberId}) not found (may have left). Removing from tracking.`, { error: e.message });
        await removeTrackedMember(memberId);
        return;
      }
    }
    
    await member.kick(KICK_REASON_TIMEOUT);
    await removeTrackedMember(memberId);
    logger.info(`Member '${username}' (ID: ${memberId}) kicked ${kickType === "immediate" ? "immediately" : "after scheduled delay"} due to mute timeout.`);
  } catch (e) {
    logger.warn(`Failed to kick member '${username}' (ID: ${memberId}) ${kickType}: ${e.message}`, { error: e });
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
    if (!client) {
      logger.error("Discord client is undefined. Cannot reschedule mute kicks without client instance.");
      return;
    }
    
    // Validate client has guilds.
    if (!client.guilds.cache.size) {
      logger.warn("Bot is not in any guilds; cannot reschedule mute kicks.");
      return;
    }
    
    const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours"), 10) || DEFAULT_MUTE_KICK_TIME_HOURS;
    const trackedMembers = await getAllTrackedMembers();
    
    if (!trackedMembers || trackedMembers.length === 0) {
      logger.debug("No tracked members found for mute kick rescheduling.");
      return;
    }
    
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
  } catch (e) {
    logger.error(`Error rescheduling mute kicks on startup: ${e.message}`, { error: e, stack: e.stack });
  }
}

module.exports = {
  scheduleMuteKick,
  rescheduleAllMuteKicks
};
