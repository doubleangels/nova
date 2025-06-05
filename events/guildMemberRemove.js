/**
 * Event handler for when a member leaves the guild.
 * Handles cleanup of member tracking data.
 * @module events/guildMemberRemove
 */

const path = require('path');
const logger = require('../logger')('guildMemberRemove.js');
const { removeTrackedMember } = require('../utils/database');
const Sentry = require('../sentry');
const { logError, ERROR_MESSAGES } = require('../errors');

/**
 * Event handler for guild member leave events.
 * @type {Object}
 */
module.exports = {
  name: 'guildMemberRemove',
  /**
   * Executes when a member leaves the guild.
   * @async
   * @function execute
   * @param {GuildMember} member - The member that left
   * @throws {Error} If member tracking removal fails
   */
  async execute(member) {
    try {
      if (member.user.bot) {
        logger.debug("Bot member left; skipping tracking removal:", { botTag: member.user.tag });
        return;
      }
      logger.info(`Member left: ${member.user.tag} (ID: ${member.id})`);
      
      const wasTracked = await removeTrackedMember(member.id);
      if (wasTracked) {
        logger.info(`Removed tracked member: ${member.user.tag}`);
      }

      logger.info(`Successfully processed member departure: ${member.user.tag}.`);
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          event: 'guildMemberRemove',
          memberId: member.id,
          username: member.user?.username || "Unknown",
        }
      });
      logger.error(`Error processing member departure ${member.user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
      
      logError(error, 'guildMemberRemove', {
        memberId: member.id,
        memberTag: member.user.tag,
        guildId: member.guild.id
      });
      throw new Error(ERROR_MESSAGES.MEMBER_LEAVE_FAILED);
    }
  }
};