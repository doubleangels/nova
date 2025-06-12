/**
 * Mute mode utilities module for handling user mute functionality.
 * Manages mute timeouts and kick operations.
 * @module utils/muteModeUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('./database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Schedules a mute kick for a user.
 * @async
 * @function scheduleMuteKick
 * @param {GuildMember} member - The member to schedule kick for
 * @param {number} [hours=4] - Hours until kick
 * @returns {Promise<void>}
 */
async function scheduleMuteKick(member, hours = 4) {
    try {
        const kickTime = dayjs().add(hours, 'hour');
        const kickTimestamp = kickTime.valueOf();
        
        logger.info(`Scheduling mute kick for ${member.user.tag} at ${kickTime.format()}`);
        
        // Store kick time in database
        await member.client.db.setValue(`mute_kick_${member.id}`, kickTimestamp);
        
        // Schedule the kick
        setTimeout(async () => {
            try {
                const storedKickTime = await member.client.db.getValue(`mute_kick_${member.id}`);
                
                if (storedKickTime && storedKickTime === kickTimestamp) {
                    await member.kick("User did not send a message in time.");
                    logger.info(`Kicked ${member.user.tag} for not sending a message`);
                }
            } catch (error) {
                logger.error(`Error executing mute kick for ${member.user.tag}:`, error);
            }
        }, hours * 60 * 60 * 1000);
        
    } catch (error) {
        logger.error(`Error scheduling mute kick for ${member.user.tag}:`, error);
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

module.exports = {
    scheduleMuteKick,
    cancelMuteKick,
    isUserMuted,
    getRemainingMuteTime,
    formatRemainingTime
};
