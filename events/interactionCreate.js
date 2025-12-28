const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { MessageFlags, Events } = require('discord.js');

const COOLDOWN_CACHE = new Map();
const PERMISSION_CACHE = new Map();

/**
 * Handles the execution of a command with error handling and logging
 * @param {CommandInteraction} interaction - The interaction object
 * @param {string} commandType - The type of command being executed
 * @param {Function} executeCommand - The function to execute the command
 * @returns {Promise<void>}
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
    logger.error(`Error executing ${commandType}:`, { 
      command: interaction.commandName, 
      error 
    });
    
    try {
      const errorMessage = { 
        content: "⚠️ An unexpected error occurred while processing your request.", 
        flags: MessageFlags.Ephemeral 
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
      logger.error("Error sending error response:", { error: replyError });
    }
  }
}

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
        logger.warn(`No command matching ${interaction.commandName} was found for autocomplete.`);
        return;
      }

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        logger.error(`Error handling autocomplete for ${interaction.commandName}:`, {
          error: error.stack,
          message: error.message
        });
      }
      return;
    }

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

/**
 * Handles a command interaction with cooldown and permission checks
 * @param {CommandInteraction} interaction - The interaction object
 * @param {string} commandType - The type of command being handled
 * @returns {Promise<void>}
 */
async function handleCommand(interaction, commandType) {
  const command = interaction.client[commandType]?.get(interaction.commandName);
  
  if (!command) {
    logger.warn(`Command not found: ${interaction.commandName}.`);
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

    const errorMessage = {
      content: "⚠️ Failed to execute the command.",
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
 * Checks if a user is on cooldown for a specific command
 * @param {CommandInteraction} interaction - The interaction object
 * @param {Command} command - The command being checked
 * @returns {Promise<boolean>} True if the user is on cooldown, false otherwise
 */
async function isOnCooldown(interaction, command) {
  const cooldownAmount = command.cooldown || 3000;
  const key = `${interaction.user.id}-${interaction.commandName}`;
  const now = Date.now();
  
  if (COOLDOWN_CACHE.has(key)) {
    const expirationTime = COOLDOWN_CACHE.get(key);
    if (now < expirationTime) {
      const remainingTime = Math.ceil((expirationTime - now) / 1000);
      await interaction.reply({
        content: "⚠️ Please wait before using this command again.",
        ephemeral: true
      });
      return true;
    }
  }
  
  COOLDOWN_CACHE.set(key, now + cooldownAmount);
  return false;
}

/**
 * Checks if a user has the required permissions for a command
 * @param {CommandInteraction} interaction - The interaction object
 * @param {Command} command - The command being checked
 * @returns {Promise<boolean>} True if the user has permissions, false otherwise
 */
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
    expiresAt: now + 60000
  });
  
  if (!hasPermission) {
    await interaction.reply({
      content: "⚠️ You don't have permission to use this command.",
      ephemeral: true
    });
  }
  
  return hasPermission;
}

/**
 * Checks if a user has the required permissions for a command with caching
 * @param {CommandInteraction} interaction - The interaction object
 * @param {Command} command - The command being checked
 * @returns {Promise<boolean>} True if the user has permissions, false otherwise
 */
async function checkPermissions(interaction, command) {
  const key = `${interaction.user.id}-${command.data.name}`;
  const cached = PERMISSION_CACHE.get(key);
  
  if (cached && Date.now() - cached.timestamp < 60000) {
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

/**
 * Handles errors that occur during interaction processing
 * @param {Error} error - The error that occurred
 * @param {CommandInteraction} interaction - The interaction object
 * @returns {Promise<void>}
 */
async function handleError(error, interaction) {
  logger.error('Error in interaction:', {
    error: error.message,
    stack: error.stack,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    commandName: interaction.commandName
  });

  let errorMessage = "⚠️ An unexpected error occurred while processing your command.";
  
  if (error.message === "INSUFFICIENT_PERMISSIONS") {
    errorMessage = "⚠️ I don't have the required permissions to execute this command.";
  } else if (error.message === "COMMAND_NOT_FOUND") {
    errorMessage = "⚠️ This command is not available.";
  } else if (error.message === "INVALID_INTERACTION") {
    errorMessage = "⚠️ Invalid interaction received.";
  } else if (error.message === "COMMAND_TIMEOUT") {
    errorMessage = "⚠️ Command execution timed out.";
  }

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: errorMessage });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  } catch (replyError) {
    logger.error('Failed to send error message:', {
      error: replyError.message,
      stack: replyError.stack
    });
  }
}