/**
 * Timezone command module for retrieving and displaying timezone information.
 * Handles Google API interactions, timezone lookups, and result formatting.
 * @module commands/timezone
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone, getUserTimezone } = require('../utils/database.js');
const config = require('../config');
const { getGeocodingData, getTimezoneData, isValidTimezone, formatErrorMessage } = require('../utils/locationUtils');
const { logError } = require('../errors');

/**
 * Error messages specific to the Timezone command.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    CONFIG_MISSING: "⚠️ This command is not properly configured. Please contact an administrator.",
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while managing timezone settings.",
    API_ERROR: "⚠️ Failed to retrieve timezone information. Please try again later.",
    API_RATE_LIMIT: "⚠️ API rate limit reached. Please try again in a few moments.",
    API_NETWORK_ERROR: "⚠️ Network error occurred. Please check your internet connection.",
    API_ACCESS_DENIED: "⚠️ API access denied. Please check API configuration.",
    REQUEST_TIMEOUT: "⚠️ The request timed out. Please try again.",
    RATE_LIMIT_EXCEEDED: "⚠️ Too many requests. Please try again later.",
    INVALID_TIMEZONE: "⚠️ Invalid timezone specified.",
    INVALID_LOCATION: "⚠️ Invalid location specified.",
    LOCATION_NOT_FOUND: "⚠️ Could not find the specified location.",
    TIMEZONE_NOT_FOUND: "⚠️ Could not determine timezone for the specified location.",
    PERMISSION_DENIED: "⚠️ You don't have permission to manage timezones for other users.",
    DATABASE_ERROR: "⚠️ Failed to save timezone settings. Please try again later."
};

/**
 * We handle the timezone command.
 * This function manages timezone settings for users in the server.
 *
 * We perform several tasks:
 * 1. We set timezone based on location input.
 * 2. We validate timezone data.
 * 3. We store timezone preferences.
 * 4. We display current timezone settings.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */

module.exports = {
  data: new SlashCommandBuilder()
      .setName('timezone')
      .setDescription('Manage timezone settings for auto-timezone features.')
      .addSubcommand(subcommand =>
          subcommand
              .setName('set')
              .setDescription('Set your timezone based on a location.')
              .addStringOption(option =>
                  option.setName('place')
                      .setDescription('What place do you want to to set your timezone? (e.g., Tokyo, London, New York)')
                      .setRequired(true)
              )
              .addUserOption(option =>
                  option.setName('user')
                      .setDescription('What user do you want to set the timezone for? (Admin only)')
                      .setRequired(false)
              )
      )
      .addSubcommand(subcommand =>
          subcommand
              .setName('status')
              .setDescription('Check your current timezone setting')
              .addUserOption(option =>
                  option.setName('user')
                      .setDescription('What user do you want to check the timezone for?')
                      .setRequired(false)
              )
      ),
  
  /**
   * We execute the /timezone command.
   * This function manages user timezone settings and routes to subcommands.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>} Resolves when the command is complete.
   */
  async execute(interaction) {
      try {
          const subcommand = interaction.options.getSubcommand();
          logger.info("/timezone command initiated:", {
              userId: interaction.user.id,
              guildId: interaction.guildId
          });
          
          if (subcommand === 'set') {
              await this.handleSetTimezone(interaction);
          } else if (subcommand === 'status') {
              await this.handleTimezoneStatus(interaction);
          }
      } catch (error) {
          await this.handleError(interaction, error);
      }
  },
  
  /**
   * We handle the 'set' subcommand to set a user's timezone.
   * This function sets the timezone for a user based on a location.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>} Resolves when the timezone is set.
   */
  async handleSetTimezone(interaction) {
      if (!config.googleApiKey) {
          logger.error("Google API key is not configured in the application.", {
              command: 'timezone',
              userId: interaction.user.id
          });
          
          await interaction.reply({
              content: ERROR_MESSAGES.CONFIG_MISSING,
              ephemeral: true
          });
          return;
      }
      
      await interaction.deferReply();
      
      const place = interaction.options.getString('place', true).trim();
      const targetUser = interaction.options.getUser('user');
      
      const targetUserInfo = await this.validateUserPermissions(interaction, targetUser);
      if (!targetUserInfo.valid) {
          await interaction.editReply({
              content: targetUserInfo.message,
              ephemeral: true
          });
          return;
      }
      
      const { memberId, memberTag, isAdminAction } = targetUserInfo;
      
      const currentTimezone = await getUserTimezone(memberId);
      
      const geocodeResult = await getGeocodingData(place);
      
      if (geocodeResult.error) {
          await interaction.editReply({ 
              content: formatErrorMessage(place, geocodeResult.type),
              ephemeral: true
          });
          return;
      }
      
      const { location, formattedAddress } = geocodeResult;
      
      const timezoneResult = await getTimezoneData(location);
      
      if (timezoneResult.error) {
          await interaction.editReply({ 
              content: formatErrorMessage(place, timezoneResult.type),
              ephemeral: true
          });
          return;
      }
      
      const { timezoneId } = timezoneResult;
      
      if (!isValidTimezone(timezoneId)) {
          logger.warn("Invalid timezone identifier returned by API.", {
              timezoneId,
              place,
              targetUserId: memberId
          });
          
          await interaction.editReply({
              content: ERROR_MESSAGES.INVALID_TIMEZONE,
              ephemeral: true
          });
          return;
      }
      
      await setUserTimezone(memberId, timezoneId);
      
      logger.info("Timezone set successfully.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          targetUserId: memberId,
          targetUserTag: memberTag,
          timezoneId,
          previousTimezone: currentTimezone,
          place
      });
      
      const embed = new EmbedBuilder()
        .setColor('#cd41ff')
        .setTitle('✅ Timezone Updated')
        .setDescription(isAdminAction 
          ? `You have set ${targetUser}'s timezone to: \`${timezoneId}\` based on location: ${formattedAddress}`
          : `Your timezone has been successfully set to: \`${timezoneId}\` based on location: ${formattedAddress}`
        )
        .setFooter({ text: `Updated by ${interaction.user.tag}` })
        .setTimestamp();

      if (currentTimezone) {
        embed.addFields({ 
          name: 'Previous Timezone', 
          value: `\`${currentTimezone}\`` 
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
  },
  
  /**
   * We handle the 'status' subcommand to check a user's timezone.
   * This function checks and displays the current timezone for a user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>} Resolves when the status is displayed.
   */
  async handleTimezoneStatus(interaction) {
      await interaction.deferReply();
      
      const targetUser = interaction.options.getUser('user');
      const isCheckingOther = targetUser !== null && targetUser.id !== interaction.user.id;
      
      const memberId = isCheckingOther ? targetUser.id : interaction.user.id;
      const memberTag = isCheckingOther ? targetUser.tag : interaction.user.tag;
      
      const currentTimezone = await getUserTimezone(memberId);
      
      logger.info("Timezone status check.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          targetUserId: memberId,
          targetUserTag: memberTag,
          currentTimezone
      });
      
      const embed = new EmbedBuilder()
        .setColor('#cd41ff')
        .setTitle('📌 Timezone Status')
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      if (isCheckingOther) {
        embed.setDescription(currentTimezone 
          ? `${targetUser}'s timezone is set to: \`${currentTimezone}\``
          : `${targetUser} doesn't have a timezone set.`
        );
      } else {
        embed.setDescription(currentTimezone 
          ? `Your timezone is currently set to: \`${currentTimezone}\``
          : `You don't have a timezone set. Use \`/timezone set\` to set your timezone.`
        );
      }
      
      if (currentTimezone) {
        try {
          const now = new Date();
          const options = { 
            timeZone: currentTimezone, 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          };
          const localTime = now.toLocaleString('en-US', options);
          embed.addFields({ name: 'Current Local Time', value: localTime });
        } catch (error) {
          logger.error("Error formatting local time.", {
            error: error.message,
            timezone: currentTimezone
          });
        }
      }

      await interaction.editReply({ embeds: [embed] });
  },
  
  /**
   * We validate user permissions for timezone operations.
   * This function checks if the user can set the timezone for another user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {User|null} targetUser - The target user if specified.
   * @returns {Promise<Object>} Object with validation results.
   */
  async validateUserPermissions(interaction, targetUser) {
      const isAdminAction = targetUser !== null && targetUser.id !== interaction.user.id;
      
      if (isAdminAction) {
          const member = interaction.member;
          const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator);
          
          if (!hasPermission) {
              logger.warn("Unauthorized timezone operation attempt for another user.", {
                  userId: interaction.user.id,
                  userTag: interaction.user.tag,
                  targetUserId: targetUser.id,
                  targetUserTag: targetUser.tag
              });
              
              return {
                  valid: false,
                  message: '⚠️ You do not have permission to manage timezones for other users.'
              };
          }
      }
      
      const memberId = isAdminAction ? targetUser.id : interaction.user.id;
      const memberTag = isAdminAction ? targetUser.tag : interaction.user.tag;
      
      return {
          valid: true,
          memberId,
          memberTag,
          isAdminAction
      };
  },
  
  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
      logError(error, 'timezone', {
          userId: interaction.user?.id,
          guildId: interaction.guild?.id
      });
      
      let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
      
      if (error.message === "API_ERROR") {
          errorMessage = ERROR_MESSAGES.API_ERROR;
      } else if (error.code === 'ECONNABORTED') {
          errorMessage = ERROR_MESSAGES.REQUEST_TIMEOUT;
      } else if (error.response?.status === 403) {
          errorMessage = ERROR_MESSAGES.API_ACCESS_DENIED;
      } else if (error.response?.status === 429) {
          errorMessage = ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
      } else if (error.response?.status >= 500) {
          errorMessage = ERROR_MESSAGES.API_ERROR;
      }
      
      try {
          const replyMethod = interaction.deferred ? interaction.editReply : interaction.reply;
          await replyMethod.call(interaction, { 
              content: errorMessage,
              ephemeral: true 
          });
      } catch (followUpError) {
          logger.error("Failed to send error response for timezone command:", {
              error: followUpError.message,
              originalError: error.message,
              userId: interaction.user?.id
          });
          
          await interaction.reply({ 
              content: errorMessage,
              ephemeral: true 
          }).catch(() => {
          });
      }
  }
};