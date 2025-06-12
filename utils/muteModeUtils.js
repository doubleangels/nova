/**
 * Mute mode utilities module for handling user mute functionality.
 * Manages mute timeouts and kick operations.
 * @module utils/muteModeUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { 
  getAllMuteModeUsers,
  getValue
} = require('./database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Schedules a mute kick for a user based on join time and hours
 * @param {string} userId - The user's Discord ID
 * @param {string|Date} joinTime - The user's join time (ISO string or Date)
 * @param {number} hours - Number of hours until kick
 * @param {Client} client - The Discord client instance
 * @param {string} guildId - The guild ID
 */
async function scheduleMuteKick(userId, joinTime, hours, client, guildId) {
  const joinDate = (joinTime instanceof Date) ? joinTime : new Date(joinTime);
  const kickAt = new Date(joinDate.getTime() + hours * 60 * 60 * 1000);
  const delay = kickAt.getTime() - Date.now();
  if (delay <= 0) {
    // Kick immediately
    try {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await member.kick('User did not send a message in time.');
          logger.info(`Kicked user ${userId} immediately on reschedule.`);
        }
      }
    } catch (e) {
      logger.error(`Failed to kick user ${userId} on reschedule:`, e);
    }
    return;
  }
  setTimeout(async () => {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await member.kick('User did not send a message in time.');
          logger.info(`Kicked user ${userId} after timeout.`);
        }
      }
    } catch (e) {
      logger.error(`Failed to kick user ${userId} after timeout:`, e);
    }
  }, delay);
  logger.debug(`Scheduled mute kick for user ${userId} in ${Math.round(delay/1000/60)} minutes.`);
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
    const value = await getValue("mute_mode_kick_time_hours");
    const muteKickTime = Number.isFinite(parseInt(value, 10)) ? parseInt(value, 10) : 4;
    const muteModeUsers = await getAllMuteModeUsers();
    if (!muteModeUsers || muteModeUsers.length === 0) {
      logger.debug("No mute mode users found for mute kick rescheduling.");
      return;
    }
    const guildId = client.guilds.cache.first().id;
    for (const userData of muteModeUsers) {
      logger.debug(`Rescheduling mute kick for user: ${JSON.stringify(userData)}`);
      logger.debug(`Using muteKickTime: ${muteKickTime}`);
      await scheduleMuteKick(
        userData.user_id,
        userData.join_time,
        muteKickTime,
        client,
        guildId
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