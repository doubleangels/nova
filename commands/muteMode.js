const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, getValue } = require('../utils/database');

/**
 * @typedef {Object} MuteModeSettings
 * @property {boolean} isEnabled - Whether mute mode is enabled
 * @property {number} timeLimit - Time limit in hours before kicking silent users
 */

/**
 * Command module for managing mute mode settings.
 * Controls automatic kicking of users who don't send messages within a time limit.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutemode')
    .setDescription("Toggle auto-kicking of users who don't send a message within a time limit.")
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Configure mute mode settings.')
        .addStringOption(option =>
          option
            .setName('enabled')
            .setDescription('Do you want to enable or disable mute mode?')
            .setRequired(true)
            .addChoices(
              { name: 'Enabled', value: 'enabled' },
              { name: 'Disabled', value: 'disabled' }
            )
        )
        .addIntegerOption(option =>
          option
            .setName('time')
            .setDescription('How many hours a user must be silent before they are kicked? (1-72)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(72)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current mute mode status.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * Executes the mute mode command.
   * This function:
   * 1. Processes the selected subcommand
   * 2. Handles status check or settings update
   * 3. Sends appropriate response embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error managing mute mode
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("/mutemode command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });
      
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'status') {
        await this.handleStatusSubcommand(interaction);
      } else if (subcommand === 'set') {
        await this.handleSetSubcommand(interaction);
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Handles the status subcommand.
   * Retrieves and displays current mute mode settings.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error retrieving settings
   * @returns {Promise<void>}
   */
  async handleStatusSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const embed = this.formatStatusMessage(currentSettings, interaction);
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/mutemode command completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        settings: currentSettings
      });
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Handles the set subcommand.
   * Updates mute mode settings based on user input.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error updating settings
   * @returns {Promise<void>}
   */
  async handleSetSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      let timeLimit = interaction.options.getInteger('time') ?? currentSettings.timeLimit;
      
      if (timeLimit < 1 || timeLimit > 72) {
        logger.warn("Invalid time limit specified.", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = 2;
      }
      
      logger.debug("Processing mutemode update.", {
        currentEnabled: currentSettings.isEnabled,
        newEnabled: isEnabled,
        currentTimeLimit: currentSettings.timeLimit,
        newTimeLimit: timeLimit,
        guildId: interaction.guildId
      });

      await this.updateSettings(isEnabled, timeLimit);

      const embed = this.formatUpdateMessage(
        currentSettings.isEnabled, isEnabled,
        currentSettings.timeLimit, timeLimit,
        interaction
      );

      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/mutemode command completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Retrieves current mute mode settings from the database.
   * 
   * @returns {Promise<MuteModeSettings>} Current mute mode settings
   * @throws {Error} If there's an error reading from the database
   */
  async getCurrentSettings() {
    try {
      const [isEnabled, timeLimit] = await Promise.all([
        getValue("mute_mode_enabled"),
        getValue("mute_mode_kick_time_hours")
      ]);
      
      return {
        isEnabled: isEnabled === true,
        timeLimit: timeLimit ? Number(timeLimit) : 2
      };
    } catch (error) {
      logger.error("Failed to retrieve current mute mode settings.", {
        err: error
      });

      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * Updates mute mode settings in the database.
   * 
   * @param {boolean} isEnabled - Whether mute mode should be enabled
   * @param {number} timeLimit - Time limit in hours
   * @throws {Error} If there's an error writing to the database
   * @returns {Promise<void>}
   */
  async updateSettings(isEnabled, timeLimit) {
    try {
      await Promise.all([
        setValue("mute_mode_enabled", isEnabled),
        setValue("mute_mode_kick_time_hours", timeLimit)
      ]);
    } catch (error) {
      logger.error("Database operation failed during mute mode update.", { 
        err: error
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },
  
  /**
   * Creates an embed showing current mute mode status.
   * 
   * @param {MuteModeSettings} settings - Current mute mode settings
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} Discord embed with status information
   */
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.isEnabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🔇 Mute Mode Status');

    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `${statusEmoji} **${statusText}**` },
      { name: 'Time Limit', value: `${settings.timeLimit} ${settings.timeLimit === 1 ? 'hour' : 'hours'}` }
    );
    
    if (settings.isEnabled) {
      const hourText = settings.timeLimit === 1 ? 'hour' : 'hours';
      embed.setDescription(`New users must send a message within **${settings.timeLimit}** ${hourText} or they will be kicked.\n\n*Note: Bot accounts are exempt from this tracking.*`);
    }

    return embed;
  },
  
  /**
   * Creates an embed showing mute mode settings update.
   * 
   * @param {boolean} oldEnabled - Previous enabled state
   * @param {boolean} newEnabled - New enabled state
   * @param {number} oldTimeLimit - Previous time limit
   * @param {number} newTimeLimit - New time limit
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} Discord embed with update information
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldTimeLimit, newTimeLimit, interaction) {
    const embed = new EmbedBuilder()
      .setColor(newEnabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🔇 Mute Mode Updated');

    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `${statusEmoji} **${statusText}**` }
    );
    
    if (oldTimeLimit !== newTimeLimit) {
      const oldHourText = oldTimeLimit === 1 ? 'hour' : 'hours';
      const newHourText = newTimeLimit === 1 ? 'hour' : 'hours';
      embed.addFields({ 
        name: 'Time Limit', 
        value: `${oldTimeLimit} ${oldHourText} → ${newTimeLimit} ${newHourText}` 
      });
    } else {
      embed.addFields({ 
        name: 'Time Limit', 
        value: `${newTimeLimit} ${newTimeLimit === 1 ? 'hour' : 'hours'}` 
      });
    }
    
    if (newEnabled) {
      const hourText = newTimeLimit === 1 ? 'hour' : 'hours';
      embed.setDescription(`New users must send a message within **${newTimeLimit}** ${hourText} or they will be kicked.\n\n*Note: Bot accounts are exempt from this tracking.*`);
    }

    return embed;
  },
  
  /**
   * Handles errors that occur during command execution.
   * Logs the error and sends an appropriate error message to the user.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error occurred in mutemode command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while managing mute mode.";
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve mute mode settings. Please try again later.";
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to update mute mode settings. Please try again later.";
    } else if (error.message === "INVALID_TIME_LIMIT") {
      errorMessage = "⚠️ Invalid time limit specified. Using default value.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for mutemode command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};