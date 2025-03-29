const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /source command.
 * Provides users with links to the bot's resources.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('source')
    .setDescription("Get links for the bot's resources."),
    
  /**
   * Executes the /source command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Log that the /source command was received.
      logger.debug("/source command received:", { user: interaction.user.tag });
      
      // Create an embed with the bot's resource links.
      const embed = new EmbedBuilder()
        .setTitle("📜 **Bot Resources**")
        .setDescription("Here are the links for the bot's resources:")
        .setColor(0xD3D3D3)
        .addFields(
          { name: "🖥️ GitHub Repository", value: "[🔗 Click Here](https://github.com/doubleangels/Nova)", inline: false },
          { name: "🗄️ Supabase Database", value: "[🔗 Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)", inline: false }
        );

      // Log that the embed was created successfully.
      logger.debug("Bot resources embed created:", { user: interaction.user.tag });
      
      // Reply to the interaction with the embed.
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      // Log any errors that occur during command execution.
      logger.error("Error in /source command:", { error });
      await interaction.editReply({ 
        content: "⚠️ An unexpected error occurred. Please try again later.", 
        flags: MessageFlags.Ephemeral 
      });
    }
  }
};
