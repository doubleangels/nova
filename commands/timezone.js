const { SlashCommandBuilder, Interaction, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const { DateTime } = require('luxon');
const logger = require('../logger.js')(path.basename(__filename));
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
 * Module for the /timezone command.
 * Allows users to set their preferred timezone using valid IANA identifiers.
 * Admins can also set timezones for other users.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Sets your timezone for use in auto-timezone features.')
        .addStringOption(option =>
            option.setName('timezone')
                .setDescription('What timezone do you want to set? (e.g., America/New_York, Europe/London)')
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
            const timezoneInput = interaction.options.getString('timezone', true).trim(); // Trim whitespace early
            const targetUser = interaction.options.getUser('user');
            
            // Determine if this is an admin setting someone else's timezone
            const isAdminAction = targetUser !== null;
            
            // If trying to set someone else's timezone, check admin permissions
            if (isAdminAction) {
                // Check if user has admin permissions
                const member = interaction.member;
                const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator)
                
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
                timezoneInput: timezoneInput
            });

            // Validate the timezone using Luxon
            if (!isValidTimezone(timezoneInput)) {
                 logger.warn(`Invalid timezone identifier provided by ${interaction.user.tag}: ${timezoneInput}`);
                 await interaction.editReply({
                    content: [
                        `⚠️ Invalid timezone identifier: \`${timezoneInput}\``,
                        '',
                        'Please use a valid timezone name such as:',
                        '• America/New_York',
                        '• Europe/London',
                        '• Asia/Tokyo',
                        '• UTC',
                        '',
                        'Not sure what your timezone is? Try running `/currenttime` with your city name to find your timezone.',
                        '',
                        'You can find a complete list here: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>'
                    ].join('\n')
                 });
                 return;
            }

            // Call the database function to save/update the timezone
            await setUserTimezone(memberId, timezoneInput);

            logger.info(`Timezone set for ${memberTag} (ID: ${memberId}) to ${timezoneInput} by ${interaction.user.tag}`);

            // Inform the user of success
            if (isAdminAction) {
                await interaction.editReply({
                    content: `✅ You have set ${targetUser}'s timezone to: \`${timezoneInput}\``
                });
            } else {
                await interaction.editReply({
                    content: `✅ Your timezone has been successfully set to: \`${timezoneInput}\``
                });
            }

        } catch (error) {
            logger.error(`Error executing /${this.data.name} command for ${interaction.user.tag}:`, { error });
            await interaction.editReply({
                content: '⚠️ An unexpected error occurred. Please try again later.'
            });
        }
    }
};
