const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Admin-only command that links to bot resources (source & infra)
module.exports = {
  data: new SlashCommandBuilder()
    .setName('source')
    .setDescription('Admin: Open important bot links (source & database).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  /**
   * Executes the source command.
   * @param {CommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      const neonUrl = 'https://console.neon.tech/app/projects/round-brook-90345203';
      const githubUrl = 'https://github.com/doubleangels/nova';

      const embed = new EmbedBuilder()
        .setColor(0x00A67E)
        .setTitle('🤖 Bot Resources')
        .setDescription(`• 🗄️ **Database Console:** [Open Neon Console](${neonUrl})\n• 🧩 **GitHub Repo:** [doubleangels/nova](${githubUrl})`)
        .setFooter({ text: 'Admin-only links' });

      await interaction.reply({ embeds: [embed], ephemeral: true });

      logger.info('/source command sent resource links', {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
    } catch (error) {
      logger.error('Error in source command:', {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });
      await interaction.reply({
        content: '⚠️ Failed to load bot links. Please try again later.',
        ephemeral: true
      }).catch(() => {});
    }
  }
};


