const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeTrackedMember } = require('../utils/supabase');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      logger.debug(`Processing guildMemberRemove event for member ID ${member.id}.`);
      
      const guild = member.guild;
      logger.debug(`Member left: ${member.user.username} from Guild ${guild.name}. Removing from mute tracking.`);
      
      await removeTrackedMember(member.id);
      
      logger.debug(`Successfully processed removal for ${member.user.username}.`);
    } catch (error) {
      logger.error(`Error during guildMemberRemove event: ${error}`);
    }
  }
};
