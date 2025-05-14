const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');
const { MessageFlags } = require('discord.js');

// We use these configuration constants for command cooldowns.
const DEFAULT_COOLDOWN = 3000; // 3 seconds default cooldown
const COOLDOWN_CACHE = new Map(); // We store cooldowns in memory
const PERMISSION_CACHE = new Map(); // We store permission checks in memory
const CACHE_DURATION = 60000; // 1 minute cache duration

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
 * We implement command cooldowns and permission caching for better performance.
 *
 * @param {Interaction} interaction - The interaction object from Discord.
 */
module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    try {
      // We handle command execution and error reporting for both slash commands and context menu commands.
      if (interaction.isCommand()) {
        await handleCommand(interaction, 'commands');
      } else if (interaction.isContextMenu()) {
        await handleCommand(interaction, 'contextMenus');
      }
    } catch (error) {
      // We log the error and report it to Sentry.
      logger.error("Error in interactionCreate event:", { error });
      Sentry.captureException(error, {
        extra: {
          event: 'interactionCreate',
          interactionId: interaction.id,
          userId: interaction.user?.id || 'unknown'
        }
      });
    }
  }
};

/**
 * We handle command execution with cooldowns and permission caching.
 * @param {Interaction} interaction - The interaction to handle.
 * @param {string} commandType - The type of command ('commands' or 'contextMenus').
 */
async function handleCommand(interaction, commandType) {
  const command = interaction.client[commandType]?.get(interaction.commandName);
  
  if (!command) {
    logger.warn(`Command not found: ${interaction.commandName}`);
    return;
  }

  // We check for command cooldown.
  if (await isOnCooldown(interaction, command)) {
    return;
  }

  // We check for permissions with caching.
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
      content: 'We encountered an error while executing this command.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}

/**
 * We check if a command is on cooldown.
 * @param {Interaction} interaction - The interaction to check.
 * @param {Command} command - The command to check.
 * @returns {Promise<boolean>} True if the command is on cooldown.
 */
async function isOnCooldown(interaction, command) {
  const cooldownAmount = command.cooldown || DEFAULT_COOLDOWN;
  const key = `${interaction.user.id}-${interaction.commandName}`;
  const now = Date.now();
  
  if (COOLDOWN_CACHE.has(key)) {
    const expirationTime = COOLDOWN_CACHE.get(key);
    if (now < expirationTime) {
      const remainingTime = Math.ceil((expirationTime - now) / 1000);
      await interaction.reply({
        content: `We're still processing your previous request. Please wait ${remainingTime} seconds.`,
        ephemeral: true
      });
      return true;
    }
  }
  
  COOLDOWN_CACHE.set(key, now + cooldownAmount);
  return false;
}

/**
 * We check if a user has the required permissions for a command.
 * @param {Interaction} interaction - The interaction to check.
 * @param {Command} command - The command to check.
 * @returns {Promise<boolean>} True if the user has the required permissions.
 */
async function hasRequiredPermissions(interaction, command) {
  if (!command.permissions) return true;
  
  const key = `${interaction.guild.id}-${interaction.user.id}-${interaction.commandName}`;
  const now = Date.now();
  
  // We check the permission cache first.
  if (PERMISSION_CACHE.has(key)) {
    const { hasPermission, expiresAt } = PERMISSION_CACHE.get(key);
    if (now < expiresAt) {
      return hasPermission;
    }
  }
  
  // We check the actual permissions.
  const member = interaction.member;
  const hasPermission = command.permissions.every(permission => 
    member.permissions.has(permission)
  );
  
  // We cache the result.
  PERMISSION_CACHE.set(key, {
    hasPermission,
    expiresAt: now + CACHE_DURATION
  });
  
  if (!hasPermission) {
    await interaction.reply({
      content: 'We cannot execute this command because you lack the required permissions.',
      ephemeral: true
    });
  }
  
  return hasPermission;
}