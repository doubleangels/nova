const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for linking to the project's website.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('website')
    .setDescription('Get the official website link.'),

  /**
   * Executes the website command.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      const embed = new EmbedBuilder()
        .setColor(0xcd41ff)
        .setTitle('🌐 Official Website')
        .setDescription('Visit our website: https://dafrens.games')
        .setURL('https://dafrens.games');

      await interaction.reply({ embeds: [embed] });

      logger.info('/website command responded with site link', {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
    } catch (error) {
      logger.error('Error in website command:', {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });

      await interaction.reply({
        content: '⚠️ Failed to load the website link. Please try again later.',
        ephemeral: true
      }).catch(() => {});
    }
  }
};


