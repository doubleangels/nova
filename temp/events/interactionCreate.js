const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { MessageFlags, Events } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,

  /**
   * Handles the event when a new interaction is created.
   * This function:
   * 1. Processes chat input commands
   * 2. Handles command execution with error handling
   * 3. Manages cooldowns and permissions
   * 
   * @param {Interaction} interaction - The interaction that was created
   * @throws {Error} If there's an error processing the interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error executing ${interaction.commandName}:`, {
        error: error.stack,
        message: error.message,
        user: interaction.user.tag
      });

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ 
            content: 'There was an error executing this command!', 
            flags: [MessageFlags.Ephemeral] 
          });
        } else {
          await interaction.reply({ 
            content: 'There was an error executing this command!', 
            flags: [MessageFlags.Ephemeral] 
          });
        }
      } catch (replyError) {
        logger.error('Error sending error response:', {
          error: replyError.stack,
          message: replyError.message,
          originalError: error.message
        });
      }
    }
  }
};

