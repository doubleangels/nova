const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone, getUserTimezone } = require('../utils/database.js');
const config = require('../config');
const { getGeocodingData, getTimezoneData, isValidTimezone, formatErrorMessage } = require('../utils/locationUtils');

/**
 * We handle the timezone command.
 * This function manages timezone settings for users in the server.
 *
 * We perform several tasks:
 * 1. Set timezone based on location input
 * 2. Validate timezone data
 * 3. Store timezone preferences
 * 4. Display current timezone settings
 *
 * @param {Interaction} interaction - The Discord interaction object
 */

module.exports = {
  // This defines the slash command structure using Discord.js builder.
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
   * Executes the timezone command, managing user timezone settings.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
      try {
          const subcommand = interaction.options.getSubcommand();
          logger.info("Timezone command initiated.", {
              userId: interaction.user.id,
              userTag: interaction.user.tag,
              subcommand
          });
          
          // We route to the appropriate subcommand handler based on the user's choice.
          if (subcommand === 'set') {
              await this.handleSetTimezone(interaction);
          } else if (subcommand === 'status') {
              await this.handleTimezoneStatus(interaction);
          }
      } catch (error) {
          // We handle any unexpected errors that occur during command execution.
          logger.error("Error executing timezone command.", {
              error: error.message,
              stack: error.stack,
              userId: interaction.user.id,
              userTag: interaction.user.tag
          });
          
          // We ensure we respond even if an error occurs to provide feedback.
          try {
              const replyMethod = interaction.deferred ? interaction.editReply : interaction.reply;
              await replyMethod.call(interaction, {
                  content: '⚠️ An unexpected error occurred. Please try again later.',
                  ephemeral: true
              });
          } catch (replyError) {
              logger.error("Failed to send error response for timezone command.", {
                  error: replyError.message,
                  originalError: error.message
              });
          }
      }
  },
  
  /**
   * Handles the 'set' subcommand to set a user's timezone.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async handleSetTimezone(interaction) {
      // We check if the Google API key is configured before proceeding.
      if (!config.googleApiKey) {
          logger.error("Google API key is not configured in the application.", {
              command: 'timezone',
              userId: interaction.user.id
          });
          
          await interaction.reply({
              content: '⚠️ Google API key is not configured. This command is currently unavailable.',
              ephemeral: true
          });
          return;
      }
      
      // We defer the reply to give time for API calls to complete.
      await interaction.deferReply();
      
      // We get the command options provided by the user.
      const place = interaction.options.getString('place', true).trim();
      const targetUser = interaction.options.getUser('user');
      
      // We check permissions and get target user info before proceeding.
      const targetUserInfo = await this.validateUserPermissions(interaction, targetUser);
      if (!targetUserInfo.valid) {
          await interaction.editReply({
              content: targetUserInfo.message,
              ephemeral: true
          });
          return;
      }
      
      const { memberId, memberTag, isAdminAction } = targetUserInfo;
      
      // We get the current timezone if it exists for reference.
      const currentTimezone = await getUserTimezone(memberId);
      
      // Step 1: We geocode the place name to coordinates using Google's API.
      const geocodeResult = await getGeocodingData(place);
      
      if (geocodeResult.error) {
          await interaction.editReply({ 
              content: formatErrorMessage(place, geocodeResult.type),
              ephemeral: true
          });
          return;
      }
      
      const { location, formattedAddress } = geocodeResult;
      
      // Step 2: We get the timezone for the coordinates from the API.
      const timezoneResult = await getTimezoneData(location);
      
      if (timezoneResult.error) {
          await interaction.editReply({ 
              content: formatErrorMessage(place, timezoneResult.type),
              ephemeral: true
          });
          return;
      }
      
      const { timezoneId } = timezoneResult;
      
      // Step 3: We validate that the timezone identifier is recognized by JavaScript.
      if (!isValidTimezone(timezoneId)) {
          logger.warn("Invalid timezone identifier returned by API.", {
              timezoneId,
              place,
              targetUserId: memberId
          });
          
          await interaction.editReply({
              content: `⚠️ The timezone identifier returned (${timezoneId}) is not valid. Please try a different location.`,
              ephemeral: true
          });
          return;
      }
      
      // Step 4: We store the timezone in the database for future use.
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
      
      // Step 5: We send a confirmation message to the user.
      let responseMessage;
      
      if (isAdminAction) {
          responseMessage = `✅ You have set ${targetUser}'s timezone to: \`${timezoneId}\` based on location: ${formattedAddress}`;
          if (currentTimezone) {
              responseMessage += `\n(Previous timezone was: \`${currentTimezone}\`)`;
          }
      } else {
          responseMessage = `✅ Your timezone has been successfully set to: \`${timezoneId}\` based on location: ${formattedAddress}`;
          if (currentTimezone) {
              responseMessage += `\n(Your previous timezone was: \`${currentTimezone}\`)`;
          }
      }
      
      await interaction.editReply({ content: responseMessage });
  },
  
  /**
   * Handles the 'status' subcommand to check a user's timezone.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async handleTimezoneStatus(interaction) {
      await interaction.deferReply();
      
      const targetUser = interaction.options.getUser('user');
      const isCheckingOther = targetUser !== null && targetUser.id !== interaction.user.id;
      
      const memberId = isCheckingOther ? targetUser.id : interaction.user.id;
      const memberTag = isCheckingOther ? targetUser.tag : interaction.user.tag;
      
      // We get the current timezone from the database.
      const currentTimezone = await getUserTimezone(memberId);
      
      logger.info("Timezone status check.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          targetUserId: memberId,
          targetUserTag: memberTag,
          currentTimezone
      });
      
      // We format a response message based on whether a timezone is set.
      let responseMessage;
      if (isCheckingOther) {
          responseMessage = currentTimezone 
              ? `📌 ${targetUser}'s timezone is set to: \`${currentTimezone}\``
              : `📌 ${targetUser} doesn't have a timezone set.`;
      } else {
          responseMessage = currentTimezone 
              ? `📌 Your timezone is currently set to: \`${currentTimezone}\``
              : `📌 You don't have a timezone set. Use \`/timezone set\` to set your timezone.`;
      }
      
      // We add the current time in that timezone if available for context.
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
              responseMessage += `\n\nCurrent local time: **${localTime}**`;
          } catch (error) {
              logger.error("Error formatting local time.", {
                  error: error.message,
                  timezone: currentTimezone
              });
          }
      }

      await interaction.editReply({ content: responseMessage });
  },
  
  /**
   * Validates user permissions for timezone operations.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {User|null} targetUser - The target user if specified.
   * @returns {Promise<Object>} Object with validation results.
   */
  async validateUserPermissions(interaction, targetUser) {
      const isAdminAction = targetUser !== null && targetUser.id !== interaction.user.id;
      
      // We check permissions if setting timezone for another user.
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
      
      // We determine the target user ID and tag for database operations.
      const memberId = isAdminAction ? targetUser.id : interaction.user.id;
      const memberTag = isAdminAction ? targetUser.tag : interaction.user.tag;
      
      return {
          valid: true,
          memberId,
          memberTag,
          isAdminAction
      };
  }
};