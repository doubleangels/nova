const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getAllMuteModeUsers, getValue, getUserJoinTime, getGuildName } = require('./database');
const dayjs = require('dayjs');
const config = require('../config');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/** @type {Map<string, NodeJS.Timeout>} Map of active mute kick timeouts */
const activeTimeouts = new Map();

/**
 * Cancels a scheduled mute kick for a user
 * @param {string} userId - The ID of the user to cancel the mute kick for
 * @returns {boolean} True if a timeout was cancelled, false otherwise
 */
function cancelMuteKick(userId) {
  if (activeTimeouts.has(userId)) {
    clearTimeout(activeTimeouts.get(userId));
    activeTimeouts.delete(userId);
    logger.debug('Cancelled mute kick timeout for user.', {
      userId: userId
    });
    return true;
  }
  return false;
}

/**
 * Schedules a mute kick for a user after a specified time period
 * @param {string} userId - The ID of the user to schedule the kick for
 * @param {Date|string} joinTime - When the user joined
 * @param {number} hours - Number of hours before the kick
 * @param {Client} client - The Discord client instance
 * @param {string} guildId - The ID of the guild
 * @returns {Promise<void>}
 */
async function scheduleMuteKick(userId, joinTime, hours, client, guildId) {
  cancelMuteKick(userId);

  const joinDate = (joinTime instanceof Date) ? joinTime : new Date(joinTime);
  const kickAt = new Date(joinDate.getTime() + hours * 60 * 60 * 1000);
  const delay = kickAt.getTime() - Date.now();
  if (delay <= 0) {
    try {
      // Check if user is still in mute mode before kicking
      const userJoinTime = await getUserJoinTime(userId);
      if (!userJoinTime) {
        logger.debug('User is no longer in mute mode, skipping immediate kick.', {
          userId: userId
        });
        return;
      }

      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          if (member.user.bot) {
            logger.debug('Skipping mute kick for bot user.', {
              userId: userId
            });
            return;
          }

          try {
            const inviteUrl = config.serverInviteUrl;
            const guildName = await getGuildName();
            const embed = {
              color: config.baseEmbedColor,
              title: 'Kicked for Inactivity',
              description: `You have been kicked from ${guildName} because you did not send a message within the required time limit.`,
              fields: [
                { name: 'Want to rejoin?', value: `You can rejoin at ${inviteUrl}.` }
              ]
            };
            await member.send({ embeds: [embed] });
          } catch (dmError) {
            logger.warn('Failed to send DM to member before mute kick.', {
              err: dmError,
              userTag: member.user.tag
            });
          }
          await member.kick('User did not send a message in time.');
          logger.info('Kicked user immediately on reschedule.', {
            userId: userId
          });
        }
      }
    } catch (e) {
      logger.error('Failed to kick user on reschedule.', {
        err: e,
        userId: userId
      });
    }
    return;
  }
  const timeoutId = setTimeout(async () => {
    try {
      // Check if user is still in mute mode before kicking
      const userJoinTime = await getUserJoinTime(userId);
      if (!userJoinTime) {
        logger.debug('User is no longer in mute mode, skipping kick.', {
          userId: userId
        });
        activeTimeouts.delete(userId);
        return;
      }

      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          if (member.user.bot) {
            logger.debug('Skipping mute kick for bot user.', {
              userId: userId
            });
            activeTimeouts.delete(userId);
            return;
          }

          try {
            const inviteUrl = config.serverInviteUrl;
            const guildName = await getGuildName();
            const embed = {
              color: config.baseEmbedColor,
              title: 'Kicked for Inactivity',
              description: `You have been kicked from ${guildName} because you did not send a message within the required time limit.`,
              fields: [
                { name: 'Want to rejoin?', value: `You can rejoin at ${inviteUrl}.` }
              ]
            };
            await member.send({ embeds: [embed] });
          } catch (dmError) {
            logger.warn('Failed to send DM to member before mute kick.', {
              err: dmError,
              userTag: member.user.tag
            });
          }
          await member.kick('User did not send a message in time.');
          logger.info('Kicked user after timeout.', {
            userId: userId
          });
        }
      }
    } catch (e) {
      logger.error('Failed to kick user after timeout.', {
        err: e,
        userId: userId
      });
    } finally {
      activeTimeouts.delete(userId);
    }
  }, delay);
  
  activeTimeouts.set(userId, timeoutId);
  logger.debug('Scheduled mute kick for user.', {
    userId: userId,
    delayMinutes: Math.round(delay/1000/60)
  });
}

/**
 * Reschedules all mute kicks for users in mute mode
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
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
      logger.debug('Rescheduling mute kick for user.', {
        userData: JSON.stringify(userData)
      });
      logger.debug('Using mute kick time.', {
        muteKickTime: muteKickTime
      });
      await scheduleMuteKick(
        userData.user_id,
        userData.join_time,
        muteKickTime,
        client,
        guildId
      );
    }
  } catch (e) {
    logger.error('Error occurred while rescheduling mute kicks on startup.', {
      err: e
    });
  }
}

module.exports = {
    scheduleMuteKick,
    rescheduleAllMuteKicks,
    cancelMuteKick
};