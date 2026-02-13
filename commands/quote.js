const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for quoting a message (reply with embed).
 * @type {Object}
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Quote')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(null),

  /**
   * Executes the quote command.
   * @param {MessageContextMenuCommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();

      const targetMessage = interaction.targetMessage;
      const content = targetMessage.content?.trim() ?? '';

      logger.info('Quote context menu command initiated.', {
        userId: interaction.user.id,
        guildId: interaction.guild?.id,
        targetMessageId: targetMessage.id
      });

      if (!content) {
        return await interaction.editReply({
          content: '⚠️ The selected message has no text content to quote.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (content.length > 4096) {
        return await interaction.editReply({
          content: '⚠️ The message is too long to quote.',
          flags: MessageFlags.Ephemeral
        });
      }

      const embed = new EmbedBuilder()
        .setDescription(content)
        .setAuthor({
          name: targetMessage.author.tag,
          iconURL: targetMessage.author.displayAvatarURL()
        })
        .setTimestamp(targetMessage.createdAt)
        .setFooter({ text: `Quoted by ${interaction.user.tag}` });

      await interaction.editReply({ embeds: [embed] });

      logger.info('Quote context menu command completed.', {
        userId: interaction.user.id,
        targetMessageId: targetMessage.id
      });
    } catch (error) {
      logger.error('Error in Quote context menu command.', {
        err: error,
        userId: interaction.user?.id,
        targetMessageId: interaction.targetMessage?.id
      });
      try {
        await interaction.editReply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      } catch (e) {
        await interaction.reply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    }
  }
};
