const logger = require('../logger')('guildMemberRemove.js');
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
      // Log the start of the removal process with the member's ID.
      logger.debug("Processing guildMemberRemove event:", { memberId: member.id });
      
      // Log details about the member and guild.
      logger.debug("Member left:", { username: member.user.username, guildName: member.guild.name });
      
      // Remove the member from the mute tracking database.
      await removeTrackedMember(member.id);
      
      // Log successful removal.
      logger.debug("Successfully removed tracking data for member:", { memberId: member.id, username: member.user.username });
    } catch (error) {
      // Log any errors encountered during removal.
      logger.error("Error processing guildMemberRemove event:", { memberId: member.id, error });
    }
  }
};
