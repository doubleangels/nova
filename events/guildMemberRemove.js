const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeMuteMember } = require('../utils/database');
const Sentry = require('../sentry');

/**
 * Event handler for the 'guildMemberRemove' event.
 * We clean up any tracking data when a member leaves the server.
 * 
 * @param {GuildMember} member - The member that left the server.
 */
module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      logger.debug("Member left server:", { 
        userId: member.id, 
        username: member.user.tag 
      });

      // We remove any mute tracking data for the member
      const wasRemoved = await removeMuteMember(member.id);
      
      if (wasRemoved) {
        logger.info("Removed mute tracking data for member:", { 
          userId: member.id, 
          username: member.user.tag 
        });
      }
    } catch (error) {
      logger.error("Error in guildMemberRemove event:", { error });
      Sentry.captureException(error, {
        extra: {
          userId: member.id,
          username: member.user.tag
        }
      });
    }
  }
};