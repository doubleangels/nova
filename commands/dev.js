const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
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
    .setDescription('Maintain developer tag.')
    .setDefaultMemberPermissions(PermissionsBitField.Administrator),
    
  /**
   * Executes the /dev command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      logger.debug("/dev command received:", { user: interaction.user.tag });
      // Placeholder for developer tag maintenance.
      logger.debug("Developer tag maintenance executed successfully.");
      
      // Inform the user that the developer tag has been maintained.
      await interaction.reply("🛠️ Developer tag maintained!");
    } catch (error) {
      logger.error("Error in /dev command:", { error });
      await interaction.reply({ content: "⚠️ An error occurred while maintaining the developer tag. Please try again later.", flags: MessageFlags.Ephemeral });
    }
  }
};
