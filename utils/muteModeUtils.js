/**
 * Mute mode utilities module for handling server mute mode functionality.
 * Manages mute timeouts, member tracking, and automatic kicks.
 * @module utils/muteModeUtils
 */

const logger = require('../logger')('muteModeUtils.js');
const dayjs = require('dayjs');
const { getValue, getAllTrackedMembers, removeTrackedMember, getTrackedMember } = require('../utils/database');
const { EmbedBuilder } = require('discord.js');
const { logError } = require('../errors');

const MUTE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing mute mode.";
const MUTE_ERROR_KICK_SCHEDULE = "⚠️ Failed to schedule mute kick.";
const MUTE_ERROR_KICK_EXECUTION = "⚠️ Failed to execute mute kick.";
const MUTE_ERROR_KICK_RESCEDULE = "⚠️ Failed to reschedule mute kicks.";
const MUTE_ERROR_MEMBER_NOT_FOUND = "⚠️ Member not found.";
const MUTE_ERROR_GUILD_NOT_FOUND = "⚠️ Guild not found.";
const MUTE_ERROR_DM_FAILED = "⚠️ Failed to send DM to member.";
const MUTE_ERROR_KICK_FAILED = "⚠️ Failed to kick member.";
const MUTE_ERROR_TRACKING_REMOVAL = "⚠️ Failed to remove member from tracking.";
const MUTE_ERROR_INVALID_MEMBER_ID = "⚠️ Invalid member ID provided.";
const MUTE_ERROR_INVALID_GUILD_ID = "⚠️ Invalid guild ID provided.";
const MUTE_ERROR_INVALID_JOIN_TIME = "⚠️ Invalid join time provided.";
const MUTE_ERROR_INVALID_MUTE_TIME = "⚠️ Invalid mute time provided.";
const MUTE_ERROR_CLIENT_NOT_FOUND = "⚠️ Discord client not found.";

const MUTE_DEFAULT_KICK_TIME_HOURS = 4;
const MUTE_KICK_REASON = "User did not send a message in time.";
const MUTE_IMMEDIATE_TIMEOUT_MS = 0;

/**
 * Schedules a mute kick for a member if they don't send a message within the time limit.
 * @async
 * @function scheduleMuteKick
 * @param {string} memberId - The ID of the member to schedule kick for
 * @param {string} username - The username of the member
 * @param {string} joinTime - The time the member joined
 * @param {number} muteKickTime - The time limit in hours
 * @param {string} guildId - The ID of the guild
 * @param {Client} client - The Discord client instance
 * @throws {Error} If scheduling fails
 */
async function scheduleMuteKick(memberId, username, joinTime, muteKickTime, guildId, client) {
  try {
    logger.debug(
      `Scheduling mute kick for member '${username}' (ID: ${memberId}) in guild ${guildId}. Join time: ${joinTime}, allowed mute time: ${muteKickTime} hour(s).`
    );
    
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
    
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Remaining time before kick for member '${username}': ${remainingTime.toFixed(2)} second(s).`);
    
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) {
      logger.warn(`Guild with ID ${guildId} not found. Removing tracked member '${username}' (ID: ${memberId}).`);
      await removeTrackedMember(memberId);
      return;
    }
    
    if (remainingTime <= 0) {
      await performKick(guildObj, memberId, username, "immediate");
      return;
    }
    
    setTimeout(() => delayedKick(remainingTime), MUTE_IMMEDIATE_TIMEOUT_MS);
    logger.debug(`Delayed kick for member '${username}' (ID: ${memberId}) scheduled successfully.`);
  } catch (e) {
    logger.error(`Error scheduling mute kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
  }
  
  async function delayedKick(delaySeconds) {
    try {
      logger.debug(
        `Delayed kick initiated for member '${username}' (ID: ${memberId}). Scheduled in ${delaySeconds.toFixed(2)} second(s).`
      );
      
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      
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
 * Performs the kick operation on a member.
 * @async
 * @function performKick
 * @param {Guild} guild - The guild to kick from
 * @param {string} memberId - The ID of the member to kick
 * @param {string} username - The username of the member
 * @param {string} kickType - The type of kick ('immediate' or 'delayed')
 * @throws {Error} If kick operation fails
 */
async function performKick(guild, memberId, username, kickType) {
  try {
    let member = guild.members.cache.get(memberId);
    
    if (!member) {
      try {
        member = await guild.members.fetch(memberId);
        logger.debug(`Member '${username}' (ID: ${memberId}) fetched from API for ${kickType} kick.`);
      } catch (e) {
        logger.info(`Member '${username}' (ID: ${memberId}) not found (may have left). Removing from tracking.`, { error: e.message });
        await removeTrackedMember(memberId);
        return;
      }
    }
    
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
    
    await member.kick(MUTE_KICK_REASON);
    await removeTrackedMember(memberId);
    logger.info(`Member '${username}' (ID: ${memberId}) kicked ${kickType === "immediate" ? "immediately" : "after scheduled delay"} due to mute timeout.`);
  } catch (e) {
    logger.warn(`Failed to kick member '${username}' (ID: ${memberId}) ${kickType}: ${e.message}`, { error: e });
  }
}

/**
 * Reschedules all mute kicks on bot startup.
 * @async
 * @function rescheduleAllMuteKicks
 * @param {Client} client - The Discord client instance
 * @throws {Error} If rescheduling fails
 */
async function rescheduleAllMuteKicks(client) {
  try {
    if (!client) {
      logger.error("Discord client is undefined. Cannot reschedule mute kicks without client instance.");
      return;
    }
    
    if (!client.guilds.cache.size) {
      logger.warn("Bot is not in any guilds; cannot reschedule mute kicks.");
      return;
    }
    
    const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours"), 10) || MUTE_DEFAULT_KICK_TIME_HOURS;
    const trackedMembers = await getAllTrackedMembers();
    
    if (!trackedMembers || trackedMembers.length === 0) {
      logger.debug("No tracked members found for mute kick rescheduling.");
      return;
    }
    
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
  performKick,
  rescheduleAllMuteKicks
};
