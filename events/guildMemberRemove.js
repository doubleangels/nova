const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeTrackedMember } = require('../utils/database');

/**
 * Event handler for the 'guildMemberRemove' event.
 * Called when a member leaves or is removed from the guild.
 * It removes the member from the mute tracking database.
 *
 * @param {GuildMember} member - The guild member that has left.
 */
module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      // Skip processing for bot accounts
      if (member.user.bot) {
        logger.debug("Bot member left; skipping tracking removal:", { botTag: member.user.tag });
        return;
      }
      
      // Log the start of the removal process with the member's ID.
      logger.debug("Processing guildMemberRemove event:", { 
        memberId: member.id,
        username: member.user.username,
        guildName: member.guild.name 
      });
      
      // Remove the member from the mute tracking database.
      const wasRemoved = await removeTrackedMember(member.id);
      
      // Log successful removal only if the member was actually being tracked
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
      // Log any errors encountered during removal.
      logger.error("Error processing guildMemberRemove event:", { 
        memberId: member.id, 
        username: member.user?.username || "Unknown",
        error 
      });
    }
  }
};