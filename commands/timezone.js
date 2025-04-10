const { SlashCommandBuilder, Interaction, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const { DateTime } = require('luxon');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone } = require('../utils/database.js');
const axios = require('axios');
const config = require('../config');

/**
 * Validates if a string is a valid IANA timezone identifier using Luxon.
 * @param {string} tz - The timezone string to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
const isValidTimezone = (tz) => {
    if (typeof tz !== 'string' || tz.trim() === '') {
        return false; // Basic check: must be a non-empty string
    }
    // Try creating a DateTime object and setting the zone.
    // If the zone is invalid, the resulting object's isValid flag will be false.
    const dt = DateTime.local().setZone(tz);
    // Additionally check the invalidReason in case setZone succeeds but with issues (less common for zones)
    return dt.isValid && dt.invalidReason === null;
};

/**
 * Module for the /timezone command.
 * Allows users to set their preferred timezone by providing a location name.
 * Admins can also set timezones for other users.
 */
module.exports = {
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
     * Executes the /timezone command.
     * @param {Interaction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const place = interaction.options.getString('place', true).trim();
            const targetUser = interaction.options.getUser('user');
            
            // Determine if this is an admin setting someone else's timezone
            const isAdminAction = targetUser !== null;
            
            // If trying to set someone else's timezone, check admin permissions
            if (isAdminAction) {
                // Check if user has admin permissions
                const member = interaction.member;
                const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator);
                
                if (!hasPermission) {
                    logger.warn(`User ${interaction.user.tag} attempted to set timezone for another user without permission`);
                    await interaction.editReply({
                        content: '⚠️ You do not have permission to set timezones for other users.'
                    });
                    return;
                }
            }
            
            // Determine whose timezone we're setting
            const memberId = isAdminAction ? targetUser.id : interaction.user.id;
            const memberTag = isAdminAction ? targetUser.tag : interaction.user.tag;

            logger.debug(`/${this.data.name} command received`, {
                user: interaction.user.tag,
                userId: interaction.user.id,
                targetUser: isAdminAction ? targetUser.tag : 'self',
                targetUserId: memberId,
                place: place
            });

            // Geocode the location to get coordinates
            const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
            const geocodeParams = new URLSearchParams({
                address: place,
                key: config.googleApiKey
            });
            const geocodeRequestUrl = `${geocodeUrl}?${geocodeParams.toString()}`;
            logger.debug("Fetching geocoding data:", { requestUrl: geocodeRequestUrl });
            
            const geocodeResponse = await axios.get(geocodeRequestUrl);
            
            // Check if the Geocoding API response is successful
            if (geocodeResponse.status !== 200) {
                logger.warn("Google Geocoding API error:", { status: geocodeResponse.status });
                await interaction.editReply({ 
                    content: "⚠️ Google Geocoding API error. Try again later."
                });
                return;
            }
            
            // Parse the geocoding data
            const geoData = geocodeResponse.data;
            
            // Ensure that at least one result was returned
            if (!geoData.results || geoData.results.length === 0) {
                logger.warn("No geocoding results found:", { place });
                await interaction.editReply({ 
                    content: `⚠️ Could not find the location '${place}'. Please check spelling and try again.`
                });
                return;
            }
            
            // Get the formatted address for better user feedback
            const formattedAddress = geoData.results[0].formatted_address;
            
            // Extract latitude and longitude from the first result
            const location = geoData.results[0].geometry.location;
            const lat = location.lat;
            const lng = location.lng;
            logger.debug("Extracted coordinates:", { place, lat, lng });

            // Get the current timestamp in seconds
            const timestamp = Math.floor(Date.now() / 1000);
            
            // Get timezone for the coordinates
            const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
            const timezoneParams = new URLSearchParams({
                location: `${lat},${lng}`,
                timestamp: timestamp.toString(),
                key: config.googleApiKey
            });
            const timezoneRequestUrl = `${timezoneUrl}?${timezoneParams.toString()}`;
            logger.debug("Fetching timezone data:", { requestUrl: timezoneRequestUrl });
            
            const timezoneResponse = await axios.get(timezoneRequestUrl);
            
            // Check if the Time Zone API response is successful
            if (timezoneResponse.status !== 200) {
                logger.warn("Google Time Zone API error:", { status: timezoneResponse.status });
                await interaction.editReply({ 
                    content: "⚠️ Google Time Zone API error. Try again later."
                });
                return;
            }
            
            // Parse the timezone data
            const tzData = timezoneResponse.data;
            logger.debug("Received timezone data:", { tzData });
            
            // Check if the API returned a valid timezone
            if (tzData.status !== "OK") {
                logger.warn("Error retrieving timezone info:", { place, status: tzData.status });
                await interaction.editReply({ 
                    content: `⚠️ Error retrieving timezone information for '${place}'.`
                });
                return;
            }
            
            // Extract the timezone ID
            const timezoneId = tzData.timeZoneId;
            
            // Validate the timezone using Luxon as a double-check
            if (!isValidTimezone(timezoneId)) {
                logger.warn(`Invalid timezone identifier returned by API: ${timezoneId}`);
                await interaction.editReply({
                    content: `⚠️ The timezone identifier returned (${timezoneId}) is not valid. Please try a different location.`
                });
                return;
            }

            // Call the database function to save/update the timezone
            await setUserTimezone(memberId, timezoneId);

            logger.info(`Timezone set for ${memberTag} (ID: ${memberId}) to ${timezoneId} by ${interaction.user.tag}`);

            // Inform the user of success
            if (isAdminAction) {
                await interaction.editReply({
                    content: `✅ You have set ${targetUser}'s timezone to: \`${timezoneId}\` based on location: ${formattedAddress}`
                });
            } else {
                await interaction.editReply({
                    content: `✅ Your timezone has been successfully set to: \`${timezoneId}\` based on location: ${formattedAddress}`
                });
            }

        } catch (error) {
            logger.error(`Error executing /${this.data.name} command for ${interaction.user.tag}:`, { error });
            await interaction.editReply({
                content: '⚠️ An unexpected error occurred. Please try again later.',
                ephemeral: true,
            });
        }
    }
};
