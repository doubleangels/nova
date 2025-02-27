const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');
// Import additional functions from supabase for member tracking.
const { getValue, getAllTrackedMembers, removeTrackedMember, getTrackedMember } = require('../utils/supabase');

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
    logger.debug(`Scheduling mute kick for member '${username}' (ID: ${memberId}) in guild ${guildId}. Join time: ${joinTime}, allowed mute time: ${muteKickTime} hours.`);
    
    const now = new Date();
    const joinTimeDt = new Date(joinTime);
    const elapsedTime = (now - joinTimeDt) / 1000; // Elapsed time in seconds.
    logger.debug(`Current time: ${now.toISOString()}, Join time: ${joinTimeDt.toISOString()}, Elapsed time: ${elapsedTime.toFixed(2)} seconds.`);
    
    // Calculate remaining time (in seconds) before the kick should occur.
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Calculated remaining time before kick: ${remainingTime.toFixed(2)} seconds.`);
    
    // Ensure the client is defined.
    if (!client) {
      logger.error("Discord client is undefined. Ensure that you pass the client instance.");
      return;
    }
    
    // Get the guild object from the client.
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) {
      logger.warning(`Guild ${guildId} not found.`);
      await removeTrackedMember(memberId);
      return;
    }
    
    // If remaining time is less than or equal to 0, attempt an immediate kick.
    if (remainingTime <= 0) {
      let member = guildObj.members.cache.get(memberId);
      if (!member) {
        try {
          // Attempt to fetch the member from the API if not cached.
          member = await guildObj.members.fetch(memberId);
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
    
    // Define an async function to perform the delayed kick.
    async function delayedKick() {
      logger.debug(`Delayed kick scheduled to occur in ${remainingTime.toFixed(2)} seconds for member '${username}' (ID: ${memberId}).`);
      // Wait for the remaining time (converted to milliseconds).
      await new Promise(resolve => setTimeout(resolve, remainingTime * 1000));
      
      // Check if the member is still being tracked.
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
            // Attempt to fetch the member if not available in the cache.
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
    
    // Schedule the delayed kick to run immediately (setTimeout with 0 delay).
    setTimeout(() => { delayedKick(); }, 0);
    logger.debug(`Scheduled delayed kick for member '${username}' in ${remainingTime.toFixed(2)} seconds.`);
  } catch (e) {
    logger.error(`Error scheduling mute mode kick for member '${username}' (ID: ${memberId}): ${e}`);
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
    // Retrieve the mute kick time (in hours) from the database.
    const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours")) || 4;
    // Get all members currently tracked for mute mode.
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
