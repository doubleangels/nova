/**
 * Mute mode utilities module for handling user mute functionality.
 * Manages mute timeouts and kick operations.
 * @module utils/muteModeUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone, getValue, getAllTrackedMembers } = require('./database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MUTE_DEFAULT_KICK_TIME_HOURS = 4;

/**
 * Schedules a mute kick for a user.
 * @async
 * @function scheduleMuteKick
 * @param {string} memberId - The member ID to schedule kick for
 * @param {string} username - The username of the member
 * @param {number} joinTime - The timestamp when the member joined
 * @param {number} hours - Hours until kick
 * @param {string} guildId - The ID of the guild
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
 */
async function scheduleMuteKick(memberId, username, joinTime, hours, guildId, client) {
    try {
        const kickTime = dayjs().add(hours, 'hour');
        const kickTimestamp = kickTime.valueOf();
        
        logger.info(`Scheduling mute kick for ${username} (${memberId}) at ${kickTime.format()}`);
        
        // Store kick time in database
        await client.db.setValue(`mute_kick_${memberId}`, kickTimestamp);
        
        // Schedule the kick
        setTimeout(async () => {
            try {
                const storedKickTime = await client.db.getValue(`mute_kick_${memberId}`);
                
                if (storedKickTime && storedKickTime === kickTimestamp) {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) {
                        const member = await guild.members.fetch(memberId).catch(() => null);
                        if (member) {
                            try {
                                const embed = {
                                    color: 0xCD41FF,
                                    title: 'Kicked for Inactivity',
                                    description: 'You were kicked from Da Frens for not sending a message in time.',
                                    fields: [
                                        { name: 'Want to rejoin?', value: 'You can rejoin at https://dafrens.games.' }
                                    ]
                                };
                                await member.send({ embeds: [embed] });
                            } catch (dmError) {
                                logger.warn(`Failed to send DM to member ${member.user.tag} before mute kick:`, { error: dmError.message });
                            }
                            await member.kick("User did not send a message in time.");
                            logger.info(`Kicked ${username} (${memberId}) for not sending a message`);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error executing mute kick for ${username} (${memberId}):`, error);
            }
        }, hours * 60 * 60 * 1000);
        
    } catch (error) {
        logger.error(`Error scheduling mute kick for ${username} (${memberId}):`, error);
    }
}

/**
 * Cancels a scheduled mute kick for a user.
 * @async
 * @function cancelMuteKick
 * @param {string} memberId - The member ID to cancel kick for
 * @returns {Promise<void>}
 */
async function cancelMuteKick(memberId) {
    try {
        await member.client.db.deleteValue(`mute_kick_${memberId}`);
        logger.info(`Cancelled mute kick for member ${memberId}`);
    } catch (error) {
        logger.error(`Error cancelling mute kick for member ${memberId}:`, error);
    }
}

/**
 * Checks if a user is muted.
 * @async
 * @function isUserMuted
 * @param {string} memberId - The member ID to check
 * @returns {Promise<boolean>} Whether the user is muted
 */
async function isUserMuted(memberId) {
    try {
        const kickTime = await member.client.db.getValue(`mute_kick_${memberId}`);
        return !!kickTime;
    } catch (error) {
        logger.error(`Error checking mute status for member ${memberId}:`, error);
        return false;
    }
}

/**
 * Gets the remaining mute time for a user.
 * @async
 * @function getRemainingMuteTime
 * @param {string} memberId - The member ID to check
 * @returns {Promise<number|null>} Remaining time in milliseconds, or null if not muted
 */
async function getRemainingMuteTime(memberId) {
    try {
        const kickTime = await member.client.db.getValue(`mute_kick_${memberId}`);
        
        if (!kickTime) {
            return null;
        }
        
        const remaining = kickTime - Date.now();
        return remaining > 0 ? remaining : 0;
        
    } catch (error) {
        logger.error(`Error getting remaining mute time for member ${memberId}:`, error);
        return null;
    }
}

/**
 * Formats the remaining mute time for display.
 * @function formatRemainingTime
 * @param {number} remainingMs - Remaining time in milliseconds
 * @returns {string} Formatted time string
 */
function formatRemainingTime(remainingMs) {
    if (remainingMs <= 0) {
        return "0 minutes";
    }
    
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    
    if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
    
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
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
    cancelMuteKick,
    isUserMuted,
    getRemainingMuteTime,
    formatRemainingTime,
    rescheduleAllMuteKicks
};