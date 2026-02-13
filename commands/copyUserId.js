const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for copying a user's ID (user context menu).
 * @type {Object}
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Copy User ID')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(null),

  /**
   * Executes the Copy User ID context menu command.
   * @param {UserContextMenuCommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    const targetUser = interaction.targetUser;

    logger.info('Copy User ID context menu command used.', {
      userId: interaction.user.id,
      targetUserId: targetUser.id
    });

    try {
      await interaction.reply({
        content: `User ID: \`${targetUser.id}\``,
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      logger.error('Error in Copy User ID context menu command.', {
        err: error,
        userId: interaction.user?.id,
        targetUserId: targetUser.id
      });
      try {
        await interaction.reply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      } catch (e) {
        logger.error('Failed to send error reply.', { err: e });
      }
    }
  }
};
