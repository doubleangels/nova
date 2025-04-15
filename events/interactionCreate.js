const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');
const { MessageFlags } = require('discord.js');

/**
 * Handles command execution and error reporting for both slash commands and context menu commands.
 * 
 * @param {Interaction} interaction - The Discord interaction object
 * @param {string} commandType - The type of command being executed
 * @param {Function} executeCommand - The command execution function
 */
async function handleCommandExecution(interaction, commandType, executeCommand) {
  try {
    logger.debug(`Executing ${commandType}:`, { 
      command: interaction.commandName, 
      user: interaction.user.tag 
    });
    
    await executeCommand();
    
    logger.debug(`${commandType} executed successfully:`, { 
      command: interaction.commandName 
    });
  } catch (error) {
    // Add Sentry error tracking
    Sentry.captureException(error, {
      extra: {
        commandType,
        commandName: interaction.commandName,
        userId: interaction.user.id,
        userName: interaction.user.tag,
        guildId: interaction.guildId
      }
    });
    
    logger.error(`Error executing ${commandType}:`, { 
      command: interaction.commandName, 
      error 
    });
    
    try {
      const errorMessage = { 
        content: 'There was an error executing that command!', 
        flags: MessageFlags.Ephemeral 
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
      // Track the follow-up error as well
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
 * Handles both slash commands and context menu commands.
 */
module.exports = {
  name: 'interactionCreate',
  once: false,
  execute: async (interaction, client) => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn("Unknown slash command:", { command: interaction.commandName });
        return;
      }
      
      await handleCommandExecution(
        interaction, 
        'slashCommand',
        () => command.execute(interaction)
      );
    }
    
    // Handle context menu commands
    else if (interaction.isContextMenuCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn("Unknown context menu command:", { command: interaction.commandName });
        return;
      }
      
      await handleCommandExecution(
        interaction, 
        'contextMenu',
        () => command.execute(interaction)
      );
    }
  }
};