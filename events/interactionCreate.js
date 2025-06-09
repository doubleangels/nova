/**
 * Event handler for Discord interactions (slash commands, buttons, etc.).
 * Manages command execution, permission checking, and cooldowns.
 * @module events/interactionCreate
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');
const { MessageFlags } = require('discord.js');
const { Collection } = require('discord.js');
const { logError } = require('../errors');

const INTERACTION_DEFAULT_COOLDOWN = 3000;
const INTERACTION_CACHE_DURATION = 60000;

const INTERACTION_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing your request.";
const INTERACTION_ERROR_COMMAND_NOT_FOUND = "⚠️ The requested command could not be found.";
const INTERACTION_ERROR_EXECUTION = "⚠️ Failed to execute the command.";
const INTERACTION_ERROR_BUTTON = "⚠️ Failed to process the button interaction.";
const INTERACTION_ERROR_SELECT_MENU = "⚠️ Failed to process the select menu interaction.";
const INTERACTION_ERROR_COOLDOWN = "⚠️ Please wait before using this command again.";
const INTERACTION_ERROR_PERMISSION = "⚠️ You don't have permission to use this command.";
const INTERACTION_ERROR_INVALID = "⚠️ Invalid interaction received.";
const INTERACTION_ERROR_REPLY = "⚠️ Failed to send response to interaction.";
const INTERACTION_ERROR_FOLLOW_UP = "⚠️ Failed to send follow-up response.";

const COOLDOWN_CACHE = new Map();
const PERMISSION_CACHE = new Map();

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
        content: INTERACTION_ERROR_UNEXPECTED, 
        flags: MessageFlags.Ephemeral 
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
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
 * Event handler for Discord interactions.
 * @type {Object}
 */
module.exports = {
  name: 'interactionCreate',
  /**
   * Executes when an interaction is created.
   * @async
   * @function execute
   * @param {Interaction} interaction - The interaction that was created
   * @throws {Error} If interaction handling fails
   */
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
          logger.warn(`No command matching ${interaction.commandName} was found.`);
          return;
        }

        try {
          await command.execute(interaction);
          logger.debug(`Executed command ${interaction.commandName} for user ${interaction.user.tag}.`);
        } catch (error) {
          logger.error(`Error executing command ${interaction.commandName}:`, {
            error: error.message,
            stack: error.stack
          });
          
          const errorMessage = INTERACTION_ERROR_EXECUTION;
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
          } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          }
        }
      }
      else if (interaction.isButton()) {
        const [action, ...params] = interaction.customId.split('_');
        const buttonHandler = interaction.client.buttonHandlers.get(action);
        
        if (buttonHandler) {
          try {
            await buttonHandler(interaction, params);
            logger.debug(`Handled button interaction ${action} for user ${interaction.user.tag}.`);
          } catch (error) {
            logger.error(`Error handling button interaction ${action}:`, {
              error: error.message,
              stack: error.stack
            });
            await interaction.reply({ content: INTERACTION_ERROR_BUTTON, ephemeral: true });
          }
        }
      }
      else if (interaction.isStringSelectMenu()) {
        const [action, ...params] = interaction.customId.split('_');
        const selectHandler = interaction.client.selectHandlers.get(action);
        
        if (selectHandler) {
          try {
            await selectHandler(interaction, params);
            logger.debug(`Handled select menu interaction ${action} for user ${interaction.user.tag}.`);
          } catch (error) {
            logger.error(`Error handling select menu interaction ${action}:`, {
              error: error.message,
              stack: error.stack
            });
            await interaction.reply({ content: INTERACTION_ERROR_SELECT_MENU, ephemeral: true });
          }
        }
      }
    } catch (error) {
      logger.error('Error in interactionCreate event:', {
        error: error.message,
        stack: error.stack
      });
    }
  }
};

async function handleCommand(interaction, commandType) {
  const command = interaction.client[commandType]?.get(interaction.commandName);
  
  if (!command) {
    logger.warn(`Command not found: ${interaction.commandName}`);
    return;
  }

  if (await isOnCooldown(interaction, command)) {
    return;
  }

  if (!await hasRequiredPermissions(interaction, command)) {
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing ${commandType} ${interaction.commandName}:`, { error });
    Sentry.captureException(error, {
      extra: {
        command: interaction.commandName,
        type: commandType,
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      }
    });

    const errorMessage = {
      content: INTERACTION_ERROR_EXECUTION,
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}

async function isOnCooldown(interaction, command) {
  const cooldownAmount = command.cooldown || INTERACTION_DEFAULT_COOLDOWN;
  const key = `${interaction.user.id}-${interaction.commandName}`;
  const now = Date.now();
  
  if (COOLDOWN_CACHE.has(key)) {
    const expirationTime = COOLDOWN_CACHE.get(key);
    if (now < expirationTime) {
      const remainingTime = Math.ceil((expirationTime - now) / 1000);
      await interaction.reply({
        content: INTERACTION_ERROR_COOLDOWN.replace('{time}', remainingTime),
        ephemeral: true
      });
      return true;
    }
  }
  
  COOLDOWN_CACHE.set(key, now + cooldownAmount);
  return false;
}

async function hasRequiredPermissions(interaction, command) {
  if (!command.permissions) return true;
  
  const key = `${interaction.guild.id}-${interaction.user.id}-${interaction.commandName}`;
  const now = Date.now();
  
  if (PERMISSION_CACHE.has(key)) {
    const { hasPermission, expiresAt } = PERMISSION_CACHE.get(key);
    if (now < expiresAt) {
      return hasPermission;
    }
  }
  
  const member = interaction.member;
  const hasPermission = command.permissions.every(permission => 
    member.permissions.has(permission)
  );
  
  PERMISSION_CACHE.set(key, {
    hasPermission,
    expiresAt: now + INTERACTION_CACHE_DURATION
  });
  
  if (!hasPermission) {
    await interaction.reply({
      content: INTERACTION_ERROR_PERMISSION,
      ephemeral: true
    });
  }
  
  return hasPermission;
}

/**
 * Checks if a user has permission to use a command.
 * @async
 * @function checkPermissions
 * @param {Interaction} interaction - The interaction to check permissions for
 * @param {Command} command - The command to check permissions against
 * @returns {Promise<boolean>} Whether the user has permission
 */
async function checkPermissions(interaction, command) {
  const key = `${interaction.user.id}-${command.data.name}`;
  const cached = PERMISSION_CACHE.get(key);
  
  if (cached && Date.now() - cached.timestamp < INTERACTION_CACHE_DURATION) {
    return cached.hasPermission;
  }

  try {
    const hasPermission = await command.checkPermissions(interaction);
    PERMISSION_CACHE.set(key, {
      hasPermission,
      timestamp: Date.now()
    });
    return hasPermission;
  } catch (error) {
    logger.error('Error checking permissions:', error);
    return false;
  }
}