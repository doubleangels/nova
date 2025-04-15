const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone, getUserTimezone, removeUserTimezone } = require('../utils/database.js');
const config = require('../config');
const { getGeocodingData, getTimezoneData, isValidTimezone, formatErrorMessage } = require('../utils/locationUtils');

module.exports = {
  // Define the slash command using Discord.js builder.
  data: new SlashCommandBuilder()
      .setName('timezone')
      .setDescription('Manage timezone settings for auto-timezone features.')
      .addSubcommand(subcommand =>
          subcommand
              .setName('set')
              .setDescription('Set your timezone based on a location')
              .addStringOption(option =>
                  option.setName('place')
                      .setDescription('What place do you want to use for timezone? (e.g., Tokyo, London, New York)')
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
              .setName('remove')
              .setDescription('Remove your timezone setting')
              .addUserOption(option =>
                  option.setName('user')
                      .setDescription('What user do you want to remove the timezone for? (Admin only)')
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
          
          // Route to the appropriate subcommand handler
          if (subcommand === 'set') {
              await this.handleSetTimezone(interaction);
          } else if (subcommand === 'remove') {
              await this.handleRemoveTimezone(interaction);
          } else if (subcommand === 'status') {
              await this.handleTimezoneStatus(interaction);
          }
      } catch (error) {
          // Handle any unexpected errors.
          logger.error("Error executing timezone command.", {
              error: error.message,
              stack: error.stack,
              userId: interaction.user.id,
              userTag: interaction.user.tag
          });
          
          // Ensure we respond even if an error occurs
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
      // Check if Google API key is configured.
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
      
      // Defer the reply to give time for API calls to complete.
      await interaction.deferReply({ ephemeral: true });
      
      // Get command options.
      const place = interaction.options.getString('place', true).trim();
      const targetUser = interaction.options.getUser('user');
      
      // Check permissions and get target user info
      const targetUserInfo = await this.validateUserPermissions(interaction, targetUser);
      if (!targetUserInfo.valid) {
          await interaction.editReply({
              content: targetUserInfo.message
          });
          return;
      }
      
      const { memberId, memberTag, isAdminAction } = targetUserInfo;
      
      // Get the current timezone if it exists
      const currentTimezone = await getUserTimezone(memberId);
      
      // Step 1: Geocode the place name to coordinates.
      const geocodeResult = await getGeocodingData(place);
      
      if (geocodeResult.error) {
          await interaction.editReply({ 
              content: formatErrorMessage(place, geocodeResult.type) 
          });
          return;
      }
      
      const { location, formattedAddress } = geocodeResult;
      
      // Step 2: Get the timezone for the coordinates.
      const timezoneResult = await getTimezoneData(location);
      
      if (timezoneResult.error) {
          await interaction.editReply({ 
              content: formatErrorMessage(place, timezoneResult.type) 
          });
          return;
      }
      
      const { timezoneId } = timezoneResult;
      
      // Step 3: Validate the timezone identifier.
      if (!isValidTimezone(timezoneId)) {
          logger.warn("Invalid timezone identifier returned by API.", {
              timezoneId,
              place,
              targetUserId: memberId
          });
          
          await interaction.editReply({
              content: `⚠️ The timezone identifier returned (${timezoneId}) is not valid. Please try a different location.`
          });
          return;
      }
      
      // Step 4: Store the timezone in the database.
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
      
      // Step 5: Send confirmation message.
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
   * Handles the 'remove' subcommand to remove a user's timezone.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async handleRemoveTimezone(interaction) {
      await interaction.deferReply({ ephemeral: true });
      
      const targetUser = interaction.options.getUser('user');
      
      // Check permissions and get target user info
      const targetUserInfo = await this.validateUserPermissions(interaction, targetUser);
      if (!targetUserInfo.valid) {
          await interaction.editReply({
              content: targetUserInfo.message
          });
          return;
      }
      
      const { memberId, memberTag, isAdminAction } = targetUserInfo;
      
      // Get the current timezone
      const currentTimezone = await getUserTimezone(memberId);
      
      if (!currentTimezone) {
          const message = isAdminAction 
              ? `⚠️ ${targetUser.tag} doesn't have a timezone set.` 
              : "⚠️ You don't have a timezone set.";
          
          await interaction.editReply({ content: message });
          return;
      }
      
      // Remove the timezone
      await removeUserTimezone(memberId);
      
      logger.info("Timezone removed successfully.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          targetUserId: memberId,
          targetUserTag: memberTag,
          removedTimezone: currentTimezone
      });
      
      // Send confirmation message
      const responseMessage = isAdminAction
          ? `✅ You have removed ${targetUser}'s timezone setting. (Was: \`${currentTimezone}\`)`
          : `✅ Your timezone setting has been removed. (Was: \`${currentTimezone}\`)`;
      
      await interaction.editReply({ content: responseMessage });
  },
  
  /**
   * Handles the 'status' subcommand to check a user's timezone.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async handleTimezoneStatus(interaction) {
      await interaction.deferReply({ ephemeral: true });
      
      const targetUser = interaction.options.getUser('user');
      const isCheckingOther = targetUser !== null && targetUser.id !== interaction.user.id;
      
      const memberId = isCheckingOther ? targetUser.id : interaction.user.id;
      const memberTag = isCheckingOther ? targetUser.tag : interaction.user.tag;
      
      // Get the current timezone
      const currentTimezone = await getUserTimezone(memberId);
      
      logger.info("Timezone status check.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          targetUserId: memberId,
          targetUserTag: memberTag,
          currentTimezone
      });
      
      // Format response message
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
      
      // Add current time in that timezone if available
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
      
      // Check permissions if setting timezone for another user.
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
      
      // Determine the target user ID and tag.
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