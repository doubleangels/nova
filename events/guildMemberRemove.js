const logger = require('../logger');

module.exports = {
  name: 'guildMemberRemove',
  execute(member) {
    logger.info(`GuildMemberRemove event: Member left: ${member.user.tag}`);
  }
};