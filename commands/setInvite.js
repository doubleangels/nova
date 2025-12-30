const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

/**
 * Command module for setting/updating the server invite link.
 * Stores the invite URL in the database for use in troll mode kick messages.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('setinvite')
    .setDescription('Set or update the server invite link stored in the database.')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('The Discord invite URL (e.g., https://discord.gg/xxxxx)')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  /**
   * Executes the setinvite command.
   * This function:
   * 1. Validates the invite URL format
   * 2. Stores the invite URL in the database
   * 3. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      const inviteUrl = interaction.options.getString('url');
      
      logger.info(`/setinvite command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        url: inviteUrl
      });

      // Validate invite URL format
      const inviteUrlPattern = /^(https?:\/\/)?(www\.)?(discord\.(gg|com\/invite)|discordapp\.com\/invite)\/.+$/i;
      if (!inviteUrlPattern.test(inviteUrl)) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Invalid Invite URL')
          .setDescription('Please provide a valid Discord invite URL.\n\n**Examples:**\n- `https://discord.gg/xxxxx`\n- `discord.gg/xxxxx`\n- `https://discord.com/invite/xxxxx`');
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Store the invite URL in the database
      await setValue('server_invite_url', inviteUrl);
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Invite URL Updated')
        .setDescription(`The server invite URL has been successfully updated.`)
        .addFields(
          { name: 'Invite URL', value: inviteUrl }
        )
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/setinvite command completed successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        url: inviteUrl
      });
      
    } catch (error) {
      logger.error("Error in setinvite command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });
      
      let errorMessage = "⚠️ An unexpected error occurred while setting the invite URL.";
      
      if (error.message === "DATABASE_WRITE_ERROR") {
        errorMessage = "⚠️ Failed to update the invite URL in the database. Please try again later.";
      }
      
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

