/**
 * Module for the /trollmode command.
 * 
 * This command toggles kicking of accounts younger than a specified age threshold.
 * Only users with Administrator permissions can execute this command.
 */

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/database');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'trollmode',
  DESCRIPTION: 'Toggle kicking of accounts younger than a specified age.',
  OPTIONS: {
    ENABLED: {
      NAME: 'enabled',
      DESCRIPTION: 'Do you want to enable or disable troll mode?',
      CHOICES: [
        { name: 'Enabled', value: 'enabled' },
        { name: 'Disabled', value: 'disabled' }
      ]
    },
    AGE: {
      NAME: 'age',
      DESCRIPTION: 'Minimum account age in days (Default: 30)'
    }
  },
  DATABASE: {
    ENABLED_KEY: 'troll_mode_enabled',
    AGE_KEY: 'troll_mode_account_age'
  },
  DEFAULTS: {
    AGE_DAYS: 30
  },
  RESPONSES: {
    ENABLED: '👹 Troll mode has been ✅ **enabled**. Minimum account age: **%s** days.',
    DISABLED: '👹 Troll mode has been ❌ **disabled**.',
    ERROR: '⚠️ An unexpected error occurred. Please try again later.'
  }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription(COMMAND_CONFIG.DESCRIPTION)
    .addStringOption(option =>
      option
        .setName(COMMAND_CONFIG.OPTIONS.ENABLED.NAME)
        .setDescription(COMMAND_CONFIG.OPTIONS.ENABLED.DESCRIPTION)
        .setRequired(true)
        .addChoices(...COMMAND_CONFIG.OPTIONS.ENABLED.CHOICES)
    )
    .addIntegerOption(option =>
      option
        .setName(COMMAND_CONFIG.OPTIONS.AGE.NAME)
        .setDescription(COMMAND_CONFIG.OPTIONS.AGE.DESCRIPTION)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the trollmode command to toggle account-age-based kicking.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Verify the user has administrator permissions.
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        logger.warn("Unauthorized trollmode command attempt.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          guildId: interaction.guildId
        });
        
        await interaction.reply({
          content: "⚠️ You need Administrator permissions to use this command.",
          ephemeral: true
        });
        return;
      }
      
      // Defer the reply to allow time for database operations.
      await interaction.deferReply();
      
      logger.info("Trollmode command received.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId
      });
      
      // Retrieve the command options.
      const enabledInput = interaction.options.getString(COMMAND_CONFIG.OPTIONS.ENABLED.NAME);
      const age = interaction.options.getInteger(COMMAND_CONFIG.OPTIONS.AGE.NAME) ?? COMMAND_CONFIG.DEFAULTS.AGE_DAYS;
      const isEnabled = enabledInput.toLowerCase() === 'enabled';
      
      logger.debug("Parsed trollmode command parameters.", {
        isEnabled,
        age,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Validate the age parameter.
      if (age <= 0) {
        logger.warn("Invalid age parameter for trollmode.", {
          age,
          userId: interaction.user.id
        });
        
        await interaction.editReply({
          content: "⚠️ Age must be a positive number of days."
        });
        return;
      }

      // Save the troll mode settings in the database.
      await setValue(COMMAND_CONFIG.DATABASE.ENABLED_KEY, isEnabled);
      await setValue(COMMAND_CONFIG.DATABASE.AGE_KEY, age);
      
      logger.debug("Trollmode settings saved to database.", {
        isEnabled,
        age,
        enabledKey: COMMAND_CONFIG.DATABASE.ENABLED_KEY,
        ageKey: COMMAND_CONFIG.DATABASE.AGE_KEY
      });

      // Prepare the response message.
      const responseMessage = isEnabled
        ? COMMAND_CONFIG.RESPONSES.ENABLED.replace('%s', age)
        : COMMAND_CONFIG.RESPONSES.DISABLED;

      // Reply to the interaction.
      await interaction.editReply(responseMessage);
      
      logger.info("Trollmode command executed successfully.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId,
        isEnabled,
        age
      });
      
    } catch (error) {
      logger.error("Error executing trollmode command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // If the reply hasn't been sent yet, send it. Otherwise, edit it.
      if (interaction.deferred) {
        await interaction.editReply({
          content: COMMAND_CONFIG.RESPONSES.ERROR,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: COMMAND_CONFIG.RESPONSES.ERROR,
          ephemeral: true
        });
      }
    }
  }
};
