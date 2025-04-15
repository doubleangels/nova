const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');
const { MessageFlags } = require('discord.js');

/**
 * Handles command execution and error reporting for both slash commands and context menu commands.
 * We use this function to centralize error handling and logging for all interaction types.
 * 
 * @param {Interaction} interaction - The Discord interaction object.
 * @param {string} commandType - The type of command being executed.
 * @param {Function} executeCommand - The command execution function.
 */
async function handleCommandExecution(interaction, commandType, executeCommand) {
  try {
    // We log the start of command execution for debugging purposes.
    logger.debug(`Executing ${commandType}:`, { 
      command: interaction.commandName, 
      user: interaction.user.tag 
    });
    
    // We execute the command and await its completion.
    await executeCommand();
    
    // We log successful command execution for monitoring.
    logger.debug(`${commandType} executed successfully:`, { 
      command: interaction.commandName 
    });
  } catch (error) {
    // We capture the error in Sentry for monitoring and troubleshooting.
    Sentry.captureException(error, {
      extra: {
        commandType,
        commandName: interaction.commandName,
        userId: interaction.user.id,
        userName: interaction.user.tag,
        guildId: interaction.guildId
      }
    });
    
    // We log the error locally for immediate visibility.
    logger.error(`Error executing ${commandType}:`, { 
      command: interaction.commandName, 
      error 
    });
    
    try {
      // We prepare an ephemeral error message to inform the user without cluttering the channel.
      const errorMessage = { 
        content: 'There was an error executing that command!', 
        flags: MessageFlags.Ephemeral 
      };
      
      // We handle the response differently based on the interaction's current state.
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
      // We track any follow-up errors that occur during error handling.
      Sentry.captureException(replyError, {
        extra: { 
          originalError: error.message,
          commandName: interaction.commandName,
          commandType
        }
      });
      logger.error("Error sending error response:", { error: replyError });
    }
  }
}

/**
 * Event handler for Discord interaction events.
 * We process all interactions to route them to the appropriate command handlers.
 * This includes both slash commands and context menu commands.
 */
module.exports = {
  name: 'interactionCreate',
  once: false,
  execute: async (interaction, client) => {
    // We handle slash commands by retrieving the command from the client's collection.
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn("Unknown slash command:", { command: interaction.commandName });
        return;
      }
      
      // We delegate execution to our centralized handler for consistent error management.
      await handleCommandExecution(
        interaction, 
        'slashCommand',
        () => command.execute(interaction)
      );
    }
    
    // We handle context menu commands similarly to slash commands.
    else if (interaction.isContextMenuCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn("Unknown context menu command:", { command: interaction.commandName });
        return;
      }
      
      // We use the same execution handler for consistency across command types.
      await handleCommandExecution(
        interaction, 
        'contextMenu',
        () => command.execute(interaction)
      );
    }
  }
};