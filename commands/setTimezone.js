const { SlashCommandBuilder, Interaction } = require('discord.js');
const path = require('path');
const { DateTime } = require('luxon');
const logger = require('../logger')(path.basename(__filename));
const { setUserTimezone } = require('../utils/database.js');

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
 * Module for the /settimezone command.
 * Allows users to set their preferred timezone using valid IANA identifiers.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('settimezone')
        .setDescription('Sets your timezone for use in auto-timezone features.')
        .addStringOption(option =>
            option.setName('timezone')
                .setDescription('What timezone do you want to set? (e.g., America/New_York, Europe/London)')
                .setRequired(true)
        ),

    /**
     * Executes the /settimezone command.
     * @param {Interaction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        await interaction.deferReply();
        try {
            const timezoneInput = interaction.options.getString('timezone', true).trim(); // Trim whitespace early
            const memberId = interaction.user.id;

            logger.debug(`/${this.data.name} command received`, {
                user: interaction.user.tag,
                userId: memberId,
                timezoneInput: timezoneInput
            });

            // Validate the timezone using Luxon
            if (!isValidTimezone(timezoneInput)) {
                 logger.warn(`Invalid timezone identifier provided by ${interaction.user.tag}: ${timezoneInput}`);
                 await interaction.editReply({
                    content: `⚠️ Invalid timezone identifier: \`${timezoneInput}\`. Please use a valid IANA timezone name (e.g., "America/New_York", "Europe/London", "Asia/Tokyo", "UTC").\n\nYou can find a list here: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>`,
                    ephemeral: true
                 });
                 return;
            }

            // Call the database function to save/update the timezone
            // Pass the already validated and trimmed timezoneInput
            await setUserTimezone(memberId, timezoneInput);

            logger.info(`Timezone set for ${interaction.user.tag} (ID: ${memberId}) to ${timezoneInput}`);

            // Inform the user of success
            await interaction.editReply({
                content: `✅ Your timezone has been successfully set to: \`${timezoneInput}\``,
            });

        } catch (error) {
            logger.error(`Error executing /${this.data.name} command for ${interaction.user.tag}:`, { error });
            await interaction.reply({
                content: '⚠️ An unexpected error occurred. Please try again later.',
                ephemeral: true
            });
        }
    }
};