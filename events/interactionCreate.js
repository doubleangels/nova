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
    // Handle autocomplete interactions
      if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn('No command matching the requested command name was found for autocomplete.', {
          commandName: interaction.commandName
        });
        return;
      }

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        logger.error('Error occurred while handling autocomplete request.', {
          err: error,
          commandName: interaction.commandName
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn('No command matching the requested command name was found.', {
        commandName: interaction.commandName
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error('Error occurred while executing command.', {
        err: error,
        commandName: interaction.commandName,
        user: interaction.user.tag
      });

      // Only send generic error if the command hasn't already replied (e.g. with its own error message)
      if (interaction.replied) return;

      try {
        if (interaction.deferred) {
          await interaction.followUp({
            content: 'There was an error executing this command!',
            flags: MessageFlags.Ephemeral
          });
        } else {
          await interaction.reply({
            content: 'There was an error executing this command!',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        logger.error('Error sending error response', {
          err: replyError,
          originalError: error.message
        });
      }
    }
  }
};

