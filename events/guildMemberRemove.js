const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeTrackedMember } = require('../utils/database');
const Sentry = require('../sentry');

/**
 * We handle members leaving the server.
 * This function manages cleanup tasks when a member leaves.
 *
 * We perform several tasks when a member leaves:
 * 1. We remove the member from tracking if they were being monitored for mute mode.
 * 2. We log the member's departure information for monitoring purposes.
 *
 * @param {GuildMember} member - The member that left the server.
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
      
      // We log the member's departure information for monitoring and debugging.
      logger.info(`Member left: ${member.user.tag} (ID: ${member.id})`);
      
      // We remove the member from tracking if they were being monitored for mute mode.
      const wasTracked = await removeTrackedMember(member.id);
      if (wasTracked) {
        logger.info(`Removed tracked member: ${member.user.tag}`);
      }

      // We log successful processing of the member's departure.
      logger.info(`Successfully processed member departure: ${member.user.tag}`);
    } catch (error) {
      // We capture the error in Sentry for monitoring and debugging.
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