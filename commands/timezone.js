const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone, getUserTimezone } = require('../utils/database.js');
const config = require('../config');
const { getGeocodingData, getTimezoneData, isValidTimezone, formatErrorMessage } = require('../utils/locationUtils');

/**
 * Command module for managing user timezone settings.
 * Handles setting and checking timezones based on location names.
 * @type {Object}
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
   * Executes the timezone command.
   * This function:
   * 1. Processes the subcommand (set or status)
   * 2. Handles timezone setting or status checking
   * 3. Manages any errors that occur
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the command
   * @returns {Promise<void>}
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
   * Handles the set timezone subcommand.
   * This function:
   * 1. Validates API configuration
   * 2. Processes location input
   * 3. Gets timezone data
   * 4. Updates user's timezone
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error setting the timezone
   * @returns {Promise<void>}
   */
  async handleSetTimezone(interaction) {
      if (!config.googleApiKey) {
          logger.error("Google API key is not configured in the application.", {
              command: 'timezone',
              userId: interaction.user.id
          });
          
          await interaction.reply({
              content: "⚠️ This command is not properly configured. Please contact an administrator.",
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
              content: "⚠️ Invalid timezone specified.",
              ephemeral: true
          });
          return;
      }
      
      await setUserTimezone(memberId, timezoneId);
      
      logger.info("/timezone command completed successfully:", {
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
        .setTitle('✅ Timezone Setup Complete')
        .setDescription(isAdminAction 
          ? `You have set ${targetUser}'s timezone to: \`${timezoneId}\` based on location: ${formattedAddress}`
          : `Your timezone has been successfully set to: \`${timezoneId}\` based on location: ${formattedAddress}`
        )
        .setFooter({ text: 'Updated by ' + interaction.user.tag })
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
   * Handles the timezone status subcommand.
   * This function:
   * 1. Gets user's current timezone
   * 2. Displays timezone information
   * 3. Shows current local time if timezone is set
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error checking timezone status
   * @returns {Promise<void>}
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
        .setFooter({ text: 'Requested by ' + interaction.user.tag })
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
   * Validates user permissions for timezone operations.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {User|null} targetUser - The user to set timezone for (if admin action)
   * @returns {Promise<Object>} Object containing validation result and user info
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
                  message: "⚠️ You don't have permission to manage timezones for other users."
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
   * Handles errors that occur during command execution.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in timezone command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while managing timezone settings.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to retrieve timezone information. Please try again later.";
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "⚠️ The request timed out. Please try again.";
    } else if (error.response?.status === 403) {
      errorMessage = "⚠️ API access denied. Please check API configuration.";
    } else if (error.response?.status === 429) {
      errorMessage = "⚠️ Too many requests. Please try again later.";
    } else if (error.response?.status >= 500) {
      errorMessage = "⚠️ Failed to retrieve timezone information. Please try again later.";
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
      }).catch(() => {});
    }
  }
};