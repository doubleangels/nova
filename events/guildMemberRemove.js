/**
 * Event handler for when a member leaves the guild.
 * Handles cleanup of member tracking data.
 * @module events/guildMemberRemove
 */

const path = require('path');
const logger = require('../logger')('guildMemberRemove.js');
const { removeTrackedMember } = require('../utils/database');
const Sentry = require('../sentry');
const { logError } = require('../errors');

/**
 * Error messages specific to the guild member remove event.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while processing member departure.",
    MEMBER_LEAVE_FAILED: "⚠️ Failed to process member departure.",
    TRACKING_REMOVAL_FAILED: "⚠️ Failed to remove member tracking data.",
    DATABASE_ERROR: "⚠️ Database error occurred while processing member departure.",
    PERMISSION_DENIED: "⚠️ Insufficient permissions to process member departure.",
    INVALID_MEMBER: "⚠️ Invalid member data received.",
    BOT_MEMBER: "⚠️ Cannot process bot member departure."
};

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

      let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
      
      if (error.message === "TRACKING_REMOVAL_FAILED") {
        errorMessage = ERROR_MESSAGES.TRACKING_REMOVAL_FAILED;
      } else if (error.message === "DATABASE_ERROR") {
        errorMessage = ERROR_MESSAGES.DATABASE_ERROR;
      } else if (error.message === "PERMISSION_DENIED") {
        errorMessage = ERROR_MESSAGES.PERMISSION_DENIED;
      } else if (error.message === "INVALID_MEMBER") {
        errorMessage = ERROR_MESSAGES.INVALID_MEMBER;
      } else if (error.message === "BOT_MEMBER") {
        errorMessage = ERROR_MESSAGES.BOT_MEMBER;
      }
      
      throw new Error(errorMessage);
    }
  }
};