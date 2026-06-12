const path = require('path');
const { serializeError } = require('../utils/logSanitize.js');
const logger = require('../logger')(path.basename(__filename));
const { captureError } = require('../instrument');
const { removeMuteModeUser, removeSpamModeJoinTime, setFormerMember, deleteMessageCount } = require('../utils/database');
const { cancelMuteKick } = require('../utils/muteModeUtils');
const { consumePendingAgeKick } = require('../utils/ageKickTracking');
const { Events } = require('discord.js');

module.exports = {
  name: Events.GuildMemberRemove,

  /**
   * Handles the event when a member leaves the guild.
   * This function:
   * 1. Skips processing if the leaving member is a bot
   * 2. Removes the member from mute mode tracking
   * 3. Removes the member from spam mode tracking
   * 
   * @param {GuildMember} member - The member that left the guild
   * @throws {Error} If there's an error processing the member departure, with specific error messages for different failure cases
   * @returns {Promise<void>}
   */
  async execute(member) {
    try {
      if (member.user.bot) {
        logger.debug('Bot member left the guild, skipping tracking removal.', { botTag: member.user.tag });
        return;
      }
      logger.info('Member left the guild.', {
        userTag: member.user.tag,
        userId: member.id
      });
      
      cancelMuteKick(member.id);
      const skippedFormerMember = consumePendingAgeKick(member.id);
      const departureTasks = [
        removeMuteModeUser(member.id),
        removeSpamModeJoinTime(member.id),
        deleteMessageCount(member.id)
      ];
      if (!skippedFormerMember) {
        departureTasks.push(setFormerMember(member.id));
      } else {
        logger.debug('Skipping former-member record for age-kicked user.', {
          userId: member.id,
          userTag: member.user.tag
        });
      }
      const results = await Promise.allSettled(departureTasks);
      for (const result of results) {
        if (result.status === 'rejected') {
          captureError(result.reason, { event: 'guildMemberRemove', handler: 'departureCleanup' });
          logger.error('Error occurred while processing member leave cleanup task.', {
            ...serializeError(result.reason, { includeStack: true }),
            userId: member.id
          });
        }
      }

      logger.info('Successfully processed member departure.', {
        userTag: member.user.tag
      });
    } catch (error) {
      captureError(error, { event: 'guildMemberRemove' });
      logger.error('Error occurred while processing member leave.', { ...serializeError(error, { includeStack: true }),
        userId: member.user?.id
      });
      // Log only; do not rethrow so the event handler does not propagate the error
    }
  }
};