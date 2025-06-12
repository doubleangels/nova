/**
 * Mute mode utilities module for handling user mute functionality.
 * Manages mute timeouts and kick operations.
 * @module utils/muteModeUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { 
  addMuteModeUser, 
  removeMuteModeUser, 
  getAllMuteModeUsers,
  setMuteModeRecoveryTime,
  getMuteModeRecoveryTime,
  deleteMuteModeRecoveryTime,
  getValue
} = require('./database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MUTE_DEFAULT_KICK_TIME_HOURS = 4;

/**
 * Schedules a mute kick for a user
 * @param {string} userId - The user's Discord ID
 * @param {number} hours - Number of hours until kick
 */
async function scheduleMuteKick(userId, hours = MUTE_DEFAULT_KICK_TIME_HOURS) {
  const kickAt = new Date(Date.now() + (hours * 60 * 60 * 1000));
  await setMuteModeRecoveryTime(userId, kickAt);
  logger.debug(`Scheduled mute kick for user ${userId} in ${hours} hours.`);
}

/**
 * Cancels a scheduled mute kick for a user
 * @param {string} userId - The user's Discord ID
 */
async function cancelMuteKick(userId) {
  await deleteMuteModeRecoveryTime(userId);
  logger.debug(`Cancelled mute kick for user ${userId}`);
}

/**
 * Checks if a user is currently muted
 * @param {string} userId - The user's Discord ID
 * @returns {Promise<boolean>} Whether the user is muted
 */
async function isUserMuted(userId) {
  const kickAt = await getMuteModeRecoveryTime(userId);
  return kickAt !== null;
}

/**
 * Gets the remaining mute time for a user
 * @param {string} userId - The user's Discord ID
 * @returns {Promise<number|null>} Remaining time in milliseconds, or null if not muted
 */
async function getRemainingMuteTime(userId) {
  const kickAt = await getMuteModeRecoveryTime(userId);
  if (!kickAt) return null;
  return Math.max(0, kickAt.getTime() - Date.now());
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
    const muteModeUsers = await getAllMuteModeUsers();
    
    if (!muteModeUsers || muteModeUsers.length === 0) {
      logger.debug("No mute mode users found for mute kick rescheduling.");
      return;
    }
    
    const guildId = client.guilds.cache.first().id;
    
    for (const userData of muteModeUsers) {
      logger.debug(`Rescheduling mute kick for user: ${JSON.stringify(userData)}`);
      await scheduleMuteKick(
        userData.user_id,
        muteKickTime
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