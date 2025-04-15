const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeTrackedMember } = require('../utils/database');
const Sentry = require('../sentry');

/**
 * Event handler for the 'guildMemberRemove' event.
 * We handle members leaving or being removed from the guild by cleaning up their data.
 * This removes the member from the mute tracking database to prevent unnecessary checks.
 *
 * @param {GuildMember} member - The guild member that has left.
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
      
      // We log the start of the removal process with the member's details for tracking.
      logger.debug("Processing guildMemberRemove event:", { 
        memberId: member.id,
        username: member.user.username,
        guildName: member.guild.name 
      });
      
      // We remove the member from the mute tracking database to keep our data clean.
      const wasRemoved = await removeTrackedMember(member.id);
      
      // We log the outcome differently based on whether the member was being tracked.
      if (wasRemoved) {
        logger.debug("Successfully removed tracking data for member:", { 
          memberId: member.id, 
          username: member.user.username 
        });
      } else {
        logger.debug("Member was not being tracked in mute system:", { 
          memberId: member.id, 
          username: member.user.username 
        });
      }
    } catch (error) {
      // Add Sentry error tracking
      Sentry.captureException(error, {
        extra: {
          event: 'guildMemberRemove',
          memberId: member.id,
          username: member.user?.username || "Unknown",
        }
      });
      logger.error("Error processing guildMemberRemove event:", { 
        memberId: member.id, 
        username: member.user?.username || "Unknown",
        error 
      });
    }
  }
};