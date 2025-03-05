const path = require('path')
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');

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
        if (!command) return;
  
        try {
          logger.debug("Executing command:", { command: interaction.commandName, user: interaction.user.tag });
          await command.execute(interaction);
        } catch (error) {
          // Add Sentry error tracking
          Sentry.captureException(error, {
            extra: {
              commandName: interaction.commandName,
              userId: interaction.user.id,
              userName: interaction.user.tag,
              guildId: interaction.guildId
            }
          });
          
          logger.error("Error executing command:", { command: interaction.commandName, error });
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ content: 'There was an error executing that command!', ephemeral: true });
            } else {
              await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
            }
          } catch (replyError) {
            // Track the follow-up error as well
            Sentry.captureException(replyError, {
              extra: { 
                originalError: error.message,
                commandName: interaction.commandName
              }
            });
            logger.error("Error sending error response:", { error: replyError });
          }
        }
      }
      
      // Handle context menu commands
      if (interaction.isContextMenuCommand()) {
        logger.debug("Executing context menu command:", { 
          command: interaction.commandName, 
          user: interaction.user.tag 
        });
  
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          logger.warn("Unknown context menu command:", { command: interaction.commandName });
          return;
        }
  
        try {
          await command.execute(interaction);
          logger.debug("Context menu command executed successfully:", { command: interaction.commandName });
        } catch (error) {
          // Add Sentry error tracking
          Sentry.captureException(error, {
            extra: {
              commandType: 'contextMenu',
              commandName: interaction.commandName,
              userId: interaction.user.id,
              userName: interaction.user.tag,
              guildId: interaction.guildId
            }
          });
          
          logger.error("Error executing context menu command:", { 
            command: interaction.commandName, 
            error 
          });
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ content: 'There was an error executing that command!', ephemeral: true });
            } else {
              await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
            }
          } catch (replyError) {
            // Track the follow-up error as well
            Sentry.captureException(replyError, {
              extra: { 
                originalError: error.message,
                commandName: interaction.commandName,
                commandType: 'contextMenu'
              }
            });
            logger.error("Error sending error response:", { error: replyError });
          }
        }
      }
    }
  };
  