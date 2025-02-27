const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeTrackedMember } = require('../utils/supabase');

/**
 * Event handler for the 'guildMemberRemove' event.
 * This function is called when a member leaves or is removed from the guild.
 * It removes the member from the mute tracking database.
 *
 * @param {GuildMember} member - The guild member that has left.
 */
module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      // Log the beginning of the removal process with the member's ID.
      logger.debug(`Processing guildMemberRemove event for member ID ${member.id}.`);
      
      const guild = member.guild;
      // Log that the member has left along with the guild name.
      logger.debug(`Member left: ${member.user.username} from Guild ${guild.name}. Removing from mute tracking.`);
      
      // Remove the member from the mute tracking database.
      await removeTrackedMember(member.id);
      
      // Log successful processing of the member removal.
      logger.debug(`Successfully processed removal for ${member.user.username}.`);
    } catch (error) {
      // Log any errors encountered during the removal process.
      logger.error(`Error during guildMemberRemove event: ${error}`);
    }
  }
};
