const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /source command.
 * This command provides users with links to the bot's resources.
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
      // Log the command execution.
      logger.debug(`/source command received from ${interaction.user.tag}`);
      
      // Create an embed with the bot's resource links.
      const embed = new EmbedBuilder()
        .setTitle("📜 **Bot Resources**")
        .setDescription("Here are the links for the bot's resources:")
        .setColor(0x00ff00)
        .addFields(
          { name: "🖥️ GitHub Repository", value: "[🔗 Click Here](https://github.com/doubleangels/Nova)", inline: false },
          { name: "🗄️ Supabase Database", value: "[🔗 Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)", inline: false }
        );

      // Log success of embed creation.
      logger.debug(`Bot resources embed created successfully for ${interaction.user.tag}`);
      
      // Reply to the interaction with the embed.
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      // Log any errors and notify the user.
      logger.error(`Error in /source command: ${error}`);
      await interaction.reply({ content: "⚠️ An error occurred while processing your request.", ephemeral: true });
    }
  }
};
