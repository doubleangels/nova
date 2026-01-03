const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for displaying the current server invite URL.
 * The invite URL is now configured via the SERVER_INVITE_URL environment variable.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('setinvite')
    .setDescription('Display the current server invite URL (configured via SERVER_INVITE_URL environment variable).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  /**
   * Executes the setinvite command.
   * Displays the current invite URL from environment variable.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      const config = require('../config');
      const inviteUrl = config.serverInviteUrl;
      
      logger.info(`/setinvite command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📋 Current Server Invite URL')
        .setDescription(`The server invite URL is configured via the \`SERVER_INVITE_URL\` environment variable.`)
        .addFields(
          { name: 'Current Invite URL', value: inviteUrl }
        )
        .setFooter({ text: 'To change this, update the SERVER_INVITE_URL environment variable and restart the bot.' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/setinvite command completed successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
    } catch (error) {
      logger.error("Error in setinvite command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });
      
      const errorMessage = "⚠️ An unexpected error occurred while retrieving the invite URL.";
      
      try {
        await interaction.editReply({ 
          content: errorMessage
        });
      } catch (followUpError) {
        logger.error("Failed to send error response for setinvite command:", {
          error: followUpError.message,
          originalError: error.message,
          userId: interaction.user?.id
        });
        
        await interaction.reply({ 
          content: errorMessage
        }).catch(() => {});
      }
    }
  }
};

