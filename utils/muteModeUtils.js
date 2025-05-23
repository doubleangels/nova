const logger = require('../logger')('muteModeUtils.js');
const dayjs = require('dayjs');
const { getValue, getAllTrackedMembers, removeTrackedMember, getTrackedMember } = require('../utils/database');
const { EmbedBuilder } = require('discord.js');
const { logError, ERROR_MESSAGES } = require('../errors');

// We define these configuration constants for consistent mute mode behavior.
const DEFAULT_MUTE_KICK_TIME_HOURS = 4;
const KICK_REASON_TIMEOUT = "User did not send a message in time.";
const IMMEDIATE_TIMEOUT_MS = 0;

/**
 * We schedule a mute kick for a member if they do not send a message within the allowed mute time.
 * This function handles the timing and execution of mute mode kicks.
 *
 * We calculate the remaining time based on the member's join time and the allowed mute time.
 * If the remaining time is less than or equal to zero, we kick the member immediately.
 * Otherwise, we schedule a delayed kick for the appropriate time.
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
    
    // We validate the client existence first to avoid unnecessary calculations.
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
    
    // We calculate the remaining time (in seconds) before the kick should occur.
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Remaining time before kick for member '${username}': ${remainingTime.toFixed(2)} second(s).`);
    
    // We get the guild object from the client to perform guild operations.
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) {
      logger.warn(`Guild with ID ${guildId} not found. Removing tracked member '${username}' (ID: ${memberId}).`);
      await removeTrackedMember(memberId);
      return;
    }
    
    // We kick immediately if the remaining time is less than or equal to 0.
    if (remainingTime <= 0) {
      await performKick(guildObj, memberId, username, "immediate");
      return;
    }
    
    // We schedule the delayed kick to run asynchronously.
    setTimeout(() => delayedKick(remainingTime), IMMEDIATE_TIMEOUT_MS);
    logger.debug(`Delayed kick for member '${username}' (ID: ${memberId}) scheduled successfully.`);
  } catch (e) {
    logger.error(`Error scheduling mute kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
  }
  
  /**
   * We perform the delayed kick after the scheduled time has passed.
   * This function maintains context of the member information for the delayed operation.
   * 
   * @param {number} delaySeconds - The delay in seconds before executing the kick.
   */
  async function delayedKick(delaySeconds) {
    try {
      logger.debug(
        `Delayed kick initiated for member '${username}' (ID: ${memberId}). Scheduled in ${delaySeconds.toFixed(2)} second(s).`
      );
      
      // We wait for the remaining time (converted to milliseconds).
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      
      // We check if the member is still being tracked before proceeding.
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
 * We perform the actual kick operation for a member.
 * This function centralizes the kick logic to avoid code duplication.
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
        // We attempt to fetch the member from the API if not in cache.
        member = await guild.members.fetch(memberId);
        logger.debug(`Member '${username}' (ID: ${memberId}) fetched from API for ${kickType} kick.`);
      } catch (e) {
        logger.info(`Member '${username}' (ID: ${memberId}) not found (may have left). Removing from tracking.`, { error: e.message });
        await removeTrackedMember(memberId);
        return;
      }
    }
    
    // We send a DM to the user before kicking them.
    try {
      const embed = new EmbedBuilder()
        .setColor(0xCD41FF)
        .setTitle('Mute Mode Kick')
        .setDescription('You have been kicked from Da Frens because you did not send a message within the required time limit.')
        .addFields(
          { name: 'Want to rejoin?', value: 'You can rejoin at [dafrens.games](https://dafrens.games).' }
        );
      await member.send({ embeds: [embed] });
    } catch (dmError) {
      logger.warn(`Failed to send DM to member '${username}' (ID: ${memberId}) before kick:`, { error: dmError.message });
    }
    
    await member.kick(KICK_REASON_TIMEOUT);
    await removeTrackedMember(memberId);
    logger.info(`Member '${username}' (ID: ${memberId}) kicked ${kickType === "immediate" ? "immediately" : "after scheduled delay"} due to mute timeout.`);
  } catch (e) {
    logger.warn(`Failed to kick member '${username}' (ID: ${memberId}) ${kickType}: ${e.message}`, { error: e });
  }
}

/**
 * We reschedule mute kicks for all tracked members.
 * This function ensures no members escape moderation due to bot downtime.
 *
 * We retrieve all tracked members from the database and schedule a mute kick for each
 * based on the configured mute kick time. This is typically used after a bot restart
 * to ensure no members escape moderation due to downtime.
 *
 * @param {Client} client - The Discord client instance.
 */
async function rescheduleAllMuteKicks(client) {
  try {
    if (!client) {
      logger.error("Discord client is undefined. Cannot reschedule mute kicks without client instance.");
      return;
    }
    
    // We validate that the client has guilds before proceeding.
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
    
    // We use the first guild's ID (assuming a single-guild scenario).
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

/**
 * We export the mute mode utility functions for use throughout the application.
 * This module provides consistent mute mode management capabilities.
 */
module.exports = {
  scheduleMuteKick,
  performKick,
  rescheduleAllMuteKicks
};

async function setMuteMode(userId, isMuted) {
    try {
        // ... existing code ...
    } catch (error) {
        logError('Failed to set mute mode', error);
        throw new Error(ERROR_MESSAGES.MUTE_MODE_UPDATE_FAILED);
    }
}

async function getMuteMode(userId) {
    try {
        // ... existing code ...
    } catch (error) {
        logError('Failed to get mute mode', error);
        throw new Error(ERROR_MESSAGES.MUTE_MODE_QUERY_FAILED);
    }
}

async function toggleMuteMode(userId) {
    try {
        // ... existing code ...
    } catch (error) {
        logError('Failed to toggle mute mode', error);
        throw new Error(ERROR_MESSAGES.MUTE_MODE_TOGGLE_FAILED);
    }
}
