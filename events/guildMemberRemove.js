const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeTrackedMember } = require('../utils/database');
const Sentry = require('../sentry');

/**
 * We handle members leaving the server.
 * This function manages cleanup tasks when a member leaves.
 *
 * We perform several tasks when a member leaves:
 * 1. Remove the member from tracking if they were being monitored
 * 2. Log the member's departure information
 *
 * @param {GuildMember} member - The member that left the server
 */
module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      // We skip processing for bot accounts since they aren't tracked in the mute system.
      if (member.user.bot) {
        logger.debug("Bot member left; skipping tracking removal:", { botTag: member.user.tag });
        return;
      }
      
      // We log the member's departure information.
      logger.info(`Member left: ${member.user.tag} (ID: ${member.id})`);
      
      // We remove the member from tracking if they were being monitored.
      const wasTracked = await removeTrackedMember(member.id);
      if (wasTracked) {
        logger.info(`Removed tracked member: ${member.user.tag}`);
      }

      logger.info(`Successfully processed member departure: ${member.user.tag}`);
    } catch (error) {
      // Add Sentry error tracking
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
    }
  }
};