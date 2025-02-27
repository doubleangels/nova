const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('source')
    .setDescription("Get links for the bot's resources."),
  async execute(interaction) {
    try {
      logger.debug(`/source command received from ${interaction.user.tag}`);
      
      const embed = new EmbedBuilder()
        .setTitle("📜 **Bot Resources**")
        .setDescription("Here are the links for the bot's resources:")
        .setColor(0x00ff00)
        .addFields(
          { name: "🖥️ GitHub Repository", value: "[🔗 Click Here](https://github.com/doubleangels/Nova)", inline: false },
          { name: "🗄️ Supabase Database", value: "[🔗 Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)", inline: false }
        );

      logger.debug(`Bot resources embed created successfully for ${interaction.user.tag}`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Error in /source command: ${error}`);
      await interaction.reply({ content: "⚠️ An error occurred while processing your request.", ephemeral: true });
    }
  }
};
