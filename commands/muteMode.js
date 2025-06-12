const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, getValue } = require('../utils/database');

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
            .setDescription('Time limit in hours before a silent user is kicked (1-72)')
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

  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("/mutemode command initiated:", {
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
  
  async handleStatusSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const embed = this.formatStatusMessage(currentSettings, interaction);
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/mutemode command completed successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        settings: currentSettings
      });
    } catch (error) {
      throw error;
    }
  },
  
  async handleSetSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      let timeLimit = interaction.options.getInteger('time') ?? currentSettings.timeLimit;
      
      if (timeLimit < 1 || timeLimit > 72) {
        logger.warn("Invalid time limit specified:", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = 2;
      }
      
      logger.debug("Processing mutemode update:", {
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
      
      logger.info("/mutemode command completed successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
    } catch (error) {
      throw error;
    }
  },
  
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
      logger.error("Failed to retrieve current mute mode settings:", {
        error: error.message,
        stack: error.stack
      });

      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  async updateSettings(isEnabled, timeLimit) {
    try {
      await Promise.all([
        setValue("mute_mode_enabled", isEnabled),
        setValue("mute_mode_kick_time_hours", timeLimit)
      ]);
    } catch (error) {
      logger.error("Database operation failed during mute mode update:", { 
        error: error.message, 
        stack: error.stack
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },
  
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.isEnabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🔇 Mute Mode Status')
      .setTimestamp();

    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `${statusEmoji} **${statusText}**` },
      { name: 'Time Limit', value: `**${settings.timeLimit}** hours` }
    )
    .setFooter({ text: `Requested by ${interaction.user.tag}` });
    
    if (settings.isEnabled) {
      embed.setDescription(`New users must send a message within **${settings.timeLimit}** hours or they will be kicked.`);
    }

    return embed;
  },
  
  formatUpdateMessage(oldEnabled, newEnabled, oldTimeLimit, newTimeLimit, interaction) {
    const embed = new EmbedBuilder()
      .setColor(newEnabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🔇 Mute Mode Updated')
      .setTimestamp();

    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `${statusEmoji} **${statusText}**` }
    )
    .setFooter({ text: `Updated by ${interaction.user.tag}` });
    
    if (oldTimeLimit !== newTimeLimit) {
      embed.addFields({ 
        name: 'Time Limit', 
        value: `**${oldTimeLimit}** → **${newTimeLimit}** hours` 
      });
    } else {
      embed.addFields({ 
        name: 'Time Limit', 
        value: `**${newTimeLimit}** hours` 
      });
    }
    
    if (newEnabled) {
      embed.setDescription(`New users must send a message within **${newTimeLimit}** hours or they will be kicked.`);
    }

    return embed;
  },
  
  async handleError(interaction, error) {
    logger.error("Error in mutemode command:", {
      error: error.message,
      stack: error.stack,
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
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for mutemode command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {});
    }
  }
};