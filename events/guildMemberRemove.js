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

const MEMBER_REMOVE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing member departure.";
const MEMBER_REMOVE_ERROR_LEAVE_FAILED = "⚠️ Failed to process member departure.";
const MEMBER_REMOVE_ERROR_TRACKING = "⚠️ Failed to remove member tracking data.";
const MEMBER_REMOVE_ERROR_DATABASE = "⚠️ Database error occurred while processing member departure.";
const MEMBER_REMOVE_ERROR_PERMISSION = "⚠️ Insufficient permissions to process member departure.";
const MEMBER_REMOVE_ERROR_INVALID = "⚠️ Invalid member data received.";
const MEMBER_REMOVE_ERROR_BOT = "⚠️ Cannot process bot member departure.";

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

      let errorMessage = MEMBER_REMOVE_ERROR_UNEXPECTED;
      
      if (error.message === MEMBER_REMOVE_ERROR_TRACKING) {
        errorMessage = MEMBER_REMOVE_ERROR_TRACKING;
      } else if (error.message === MEMBER_REMOVE_ERROR_DATABASE) {
        errorMessage = MEMBER_REMOVE_ERROR_DATABASE;
      } else if (error.message === MEMBER_REMOVE_ERROR_PERMISSION) {
        errorMessage = MEMBER_REMOVE_ERROR_PERMISSION;
      } else if (error.message === MEMBER_REMOVE_ERROR_INVALID) {
        errorMessage = MEMBER_REMOVE_ERROR_INVALID;
      } else if (error.message === MEMBER_REMOVE_ERROR_BOT) {
        errorMessage = MEMBER_REMOVE_ERROR_BOT;
      }
      
      throw new Error(errorMessage);
    }
  }
};