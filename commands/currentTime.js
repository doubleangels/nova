const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const advancedFormat = require('dayjs/plugin/advancedFormat');
const config = require('../config');
const { getGeocodingData, getTimezoneData, formatErrorMessage } = require('../utils/locationUtils');

// This is the color used for the time information embed.
const EMBED_COLOR = 0x1D4ED8;

// We extend dayjs with plugins to support timezone operations.
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

/**
 * We handle the currenttime command.
 * This function displays the current time in a specified timezone or UTC by default.
 *
 * We perform several tasks:
 * 1. Parse the timezone input from the user
 * 2. Validate the timezone
 * 3. Get the current time in the specified timezone
 * 4. Send the formatted time to the user
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('currenttime')
    .setDescription('We display the current time in a specified timezone or UTC by default.')
    .addStringOption(option =>
      option.setName('timezone')
        .setDescription('The IANA timezone name (e.g., America/New_York)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      logger.info("Current time command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

      // We get the timezone from the command options, defaulting to UTC.
      const tzInput = interaction.options.getString('timezone') || 'UTC';
      logger.debug("Timezone input received.", { tzInput });

      // We validate the timezone.
      if (!this.isValidTimezone(tzInput)) {
        await interaction.editReply({
          content: `⚠️ Invalid timezone. Please provide a valid IANA timezone (e.g., America/New_York).`,
          ephemeral: true
        });
        return;
      }

      // We get the current time in the specified timezone.
      const now = dayjs().tz(tzInput);
      const formatted = now.format('YYYY-MM-DD HH:mm:ss z');

      await interaction.editReply({
        content: `🕒 The current time in **${tzInput}** is: 

	t${formatted}`
      });

      logger.info("Current time sent successfully.", {
        timezone: tzInput,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * We validate if the provided string is a valid IANA timezone.
   * This function checks if the timezone is recognized by dayjs.
   *
   * @param {string} tz - The timezone string to validate
   * @returns {boolean} True if the timezone is valid, false otherwise
   */
  isValidTimezone(tz) {
    try {
      return !!dayjs.tz.zone(tz);
    } catch {
      return false;
    }
  },

  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logger.error("Error in /currenttime command execution.", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });

    let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";

    try {
      await interaction.editReply({
        content: errorMessage,
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for currenttime command.", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });

      await interaction.reply({
        content: errorMessage,
        ephemeral: true
      }).catch(() => {
        // Silent catch if everything fails.
      });
    }
  }
};