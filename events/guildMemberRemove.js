const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeMuteModeUser, removeSpamModeJoinTime, setFormerMember } = require('../utils/database');
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
      
      // Parallelize database writes (record as former member so on re-join they get "been in server before" role)
      await Promise.all([
        removeMuteModeUser(member.id),
        removeSpamModeJoinTime(member.id),
        setFormerMember(member.id)
      ]);

      logger.info('Successfully processed member departure.', {
        userTag: member.user.tag
      });
    } catch (error) {
      logger.error('Error processing member leave', {
        err: error,
        userId: member.user?.id
      });
      // Log only; do not rethrow so the event handler does not propagate the error
    }
  }
};