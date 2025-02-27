const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /dev command.
 * This command maintains the developer tag.
 * Only users with Administrator permissions are allowed to run this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Maintain developer tag.'),
    
  /**
   * Executes the /dev command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Check if the user has Administrator permissions.
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn(`Unauthorized /dev attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }
    
    try {
      // Log the receipt of the /dev command.
      logger.debug(`/dev command received from ${interaction.user.tag}`);
      // Perform developer tag maintenance (logic can be expanded as needed).
      logger.debug("Developer tag maintenance completed.");
      
      // Inform the user that the developer tag has been maintained.
      await interaction.reply("🛠️ Developer tag maintained!");
    } catch (error) {
      // Log any errors encountered during execution.
      logger.error(`Error in /dev command: ${error}`);
      // Inform the user of the error.
      await interaction.reply({ content: "⚠️ An error occurred while maintaining the developer tag. Please try again later.", ephemeral: true });
    }
  }
};
