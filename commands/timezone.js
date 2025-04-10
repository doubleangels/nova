/**
 * Timezone Command Module
 * 
 * This module implements a Discord slash command that allows users to set their timezone
 * for use with the bot's time conversion features. It uses Google's Geocoding and Timezone APIs
 * to convert a location name to a valid IANA timezone identifier. Administrators can also set
 * timezones for other users.
 * 
 * @module commands/timezone
 */

const { SlashCommandBuilder, Interaction, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const { DateTime } = require('luxon');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone } = require('../utils/database.js');
const axios = require('axios');
const config = require('../config');

/**
 * Validates if a timezone identifier is valid using Luxon.
 * 
 * This function checks if the provided string is a valid IANA timezone identifier
 * by attempting to create a DateTime object with the timezone and checking its validity.
 * 
 * @param {string} tz - The timezone identifier to validate
 * @returns {boolean} True if the timezone is valid, false otherwise
 */
const isValidTimezone = (tz) => {
    // Check if the input is a non-empty string
    if (typeof tz !== 'string' || tz.trim() === '') {
        return false;
    }
    
    // Try to create a DateTime object with the timezone
    const dt = DateTime.local().setZone(tz);
    
    // Check if the DateTime object is valid
    return dt.isValid && dt.invalidReason === null;
};

module.exports = {
    // Define the slash command using Discord.js builder
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
     * This function handles the timezone command execution flow:
     * 1. Validates permissions if setting timezone for another user
     * 2. Geocodes the provided place name to coordinates using Google's Geocoding API
     * 3. Converts the coordinates to a timezone using Google's Timezone API
     * 4. Validates the timezone and stores it in the database
     * 5. Responds to the user with confirmation
     * 
     * @param {Interaction} interaction - The Discord interaction object
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        // Defer the reply to give time for API calls to complete
        await interaction.deferReply({ ephemeral: true });
        
        try {
            // Get command options
            const place = interaction.options.getString('place', true).trim();
            const targetUser = interaction.options.getUser('user');
            const isAdminAction = targetUser !== null;
            
            // Check permissions if setting timezone for another user
            if (isAdminAction) {
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
            
            // Determine the target user ID and tag
            const memberId = isAdminAction ? targetUser.id : interaction.user.id;
            const memberTag = isAdminAction ? targetUser.tag : interaction.user.tag;
            
            logger.debug(`/${this.data.name} command received`, {
                user: interaction.user.tag,
                userId: interaction.user.id,
                targetUser: isAdminAction ? targetUser.tag : 'self',
                targetUserId: memberId,
                place: place
            });
            
            // Step 1: Geocode the place name to coordinates using Google's Geocoding API
            const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
            const geocodeParams = new URLSearchParams({
                address: place,
                key: config.googleApiKey
            });
            const geocodeRequestUrl = `${geocodeUrl}?${geocodeParams.toString()}`;
            
            logger.debug("Fetching geocoding data:", { requestUrl: geocodeRequestUrl });
            const geocodeResponse = await axios.get(geocodeRequestUrl);
            
            // Handle API errors
            if (geocodeResponse.status !== 200) {
                logger.warn("Google Geocoding API error:", { status: geocodeResponse.status });
                await interaction.editReply({ 
                    content: "⚠️ Google Geocoding API error. Try again later."
                });
                return;
            }
            
            // Process geocoding results
            const geoData = geocodeResponse.data;
            if (!geoData.results || geoData.results.length === 0) {
                logger.warn("No geocoding results found:", { place });
                await interaction.editReply({ 
                    content: `⚠️ Could not find the location '${place}'. Please check spelling and try again.`
                });
                return;
            }
            
            // Extract location information from geocoding results
            const formattedAddress = geoData.results[0].formatted_address;
            const location = geoData.results[0].geometry.location;
            const lat = location.lat;
            const lng = location.lng;
            
            logger.debug("Extracted coordinates:", { place, lat, lng });
            
            // Step 2: Get the timezone for the coordinates using Google's Timezone API
            const timestamp = Math.floor(Date.now() / 1000);
            const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
            const timezoneParams = new URLSearchParams({
                location: `${lat},${lng}`,
                timestamp: timestamp.toString(),
                key: config.googleApiKey
            });
            const timezoneRequestUrl = `${timezoneUrl}?${timezoneParams.toString()}`;
            
            logger.debug("Fetching timezone data:", { requestUrl: timezoneRequestUrl });
            const timezoneResponse = await axios.get(timezoneRequestUrl);
            
            // Handle API errors
            if (timezoneResponse.status !== 200) {
                logger.warn("Google Time Zone API error:", { status: timezoneResponse.status });
                await interaction.editReply({ 
                    content: "⚠️ Google Time Zone API error. Try again later."
                });
                return;
            }
            
            // Process timezone results
            const tzData = timezoneResponse.data;
            logger.debug("Received timezone data:", { tzData });
            
            if (tzData.status !== "OK") {
                logger.warn("Error retrieving timezone info:", { place, status: tzData.status });
                await interaction.editReply({ 
                    content: `⚠️ Error retrieving timezone information for '${place}'.`
                });
                return;
            }
            
            // Extract and validate the timezone identifier
            const timezoneId = tzData.timeZoneId;
            if (!isValidTimezone(timezoneId)) {
                logger.warn(`Invalid timezone identifier returned by API: ${timezoneId}`);
                await interaction.editReply({
                    content: `⚠️ The timezone identifier returned (${timezoneId}) is not valid. Please try a different location.`
                });
                return;
            }
            
            // Step 3: Store the timezone in the database
            await setUserTimezone(memberId, timezoneId);
            
            logger.info(`Timezone set for ${memberTag} (ID: ${memberId}) to ${timezoneId} by ${interaction.user.tag}`);
            
            // Step 4: Send confirmation message
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
            // Handle any unexpected errors
            logger.error(`Error executing /${this.data.name} command for ${interaction.user.tag}:`, { error });
            await interaction.editReply({
                content: '⚠️ An unexpected error occurred. Please try again later.',
                ephemeral: true,
            });
        }
    }
};
