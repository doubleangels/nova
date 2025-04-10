const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone } = require('../utils/database.js');
const config = require('../config');
const { getGeocodingData, getTimezoneData, isValidTimezone, formatErrorMessage } = require('../utils/locationUtils');

module.exports = {
  // Define the slash command using Discord.js builder.
  data: new SlashCommandBuilder()
      .setName('timezone')
      .setDescription('Sets your timezone for use in auto-timezone features.')
      .addStringOption(option =>
          option.setName('place')
              .setDescription('What place do you want to use for timezone? (e.g., Tokyo, London, New York)')
              .setRequired(true)
      )
      .addUserOption(option =>
          option.setName('user')
              .setDescription('What user do you want to set the timezone for?')
              .setRequired(false)
      ),
  
  /**
   * Executes the timezone command, setting a user's timezone based on a location name.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
      try {
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
          const isAdminAction = targetUser !== null;
          
          // Check permissions if setting timezone for another user.
          if (isAdminAction) {
              const member = interaction.member;
              const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator);
              
              if (!hasPermission) {
                  logger.warn("Unauthorized timezone set attempt for another user.", {
                      userId: interaction.user.id,
                      userTag: interaction.user.tag,
                      targetUserId: targetUser.id,
                      targetUserTag: targetUser.tag
                  });
                  
                  await interaction.editReply({
                      content: '⚠️ You do not have permission to set timezones for other users.'
                  });
                  return;
              }
          }
          
          // Determine the target user ID and tag.
          const memberId = isAdminAction ? targetUser.id : interaction.user.id;
          const memberTag = isAdminAction ? targetUser.tag : interaction.user.tag;
          
          logger.info("Timezone command initiated.", {
              userId: interaction.user.id,
              userTag: interaction.user.tag,
              targetUserId: memberId,
              targetUserTag: memberTag,
              place: place
          });
          
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
              place
          });
          
          // Step 5: Send confirmation message.
          let responseMessage;
          
          if (isAdminAction) {
              responseMessage = `✅ You have set ${targetUser}'s timezone to: \`${timezoneId}\` based on location: ${formattedAddress}`;
          } else {
              responseMessage = `✅ Your timezone has been successfully set to: \`${timezoneId}\` based on location: ${formattedAddress}`;
          }
          
          await interaction.editReply({ content: responseMessage });
          
      } catch (error) {
          // Handle any unexpected errors.
          logger.error("Error executing timezone command.", {
              error: error.message,
              stack: error.stack,
              userId: interaction.user.id,
              userTag: interaction.user.tag
          });
          
          await interaction.editReply({
              content: '⚠️ An unexpected error occurred. Please try again later.'
          });
      }
  }
};
