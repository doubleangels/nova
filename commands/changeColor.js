const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

/**
 * We handle the changecolor command.
 * This function changes the color of a specified role to the provided hex color.
 *
 * We perform several tasks:
 * 1. We validate the provided hex color.
 * 2. We check if the role exists and is editable.
 * 3. We update the role's color.
 * 4. We notify the user of the change.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('changecolor')
        .setDescription('Change the color of a specified role to the provided hex color.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('What role do you want to change the color of?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('What color do you want to change the role to? (e.g., #RRGGBB, RRGGBB)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    /**
     * We execute the /changecolor command.
     * This function processes the role color change request.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        await interaction.deferReply();
        try {
            logger.info("Change color command initiated:", { 
                userId: interaction.user.id, 
                guildId: interaction.guild.id 
            });

            // We get the role and color from the command options.
            const role = interaction.options.getRole('role');
            const color = interaction.options.getString('color');
            
            // We validate the role and color.
            if (!this.isValidRole(role)) {
                await interaction.editReply({
                    content: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS,
                    ephemeral: true
                });
                return;
            }

            if (!this.isValidHexColor(color)) {
                await interaction.editReply({
                    content: ERROR_MESSAGES.INVALID_COLOR,
                    ephemeral: true
                });
                return;
            }
            
            // We store the old color before changing it for the response message.
            const oldColor = role.hexColor;
            
            // We update the role's color.
            await role.setColor(this.normalizeColor(color));
            
            await interaction.editReply({
                content: `✅ Successfully changed the color of ${role} from \`${oldColor}\` to \`${this.normalizeColor(color)}\`.`
            });

            logger.info("Role color changed successfully:", { 
                roleId: role.id, 
                oldColor: oldColor,
                newColor: color,
                userId: interaction.user.id,
                guildId: interaction.guild.id
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * We validate if the role can be edited by the bot.
     * This function checks if the role is manageable and not managed.
     *
     * @param {Role} role - The role to validate.
     * @returns {boolean} True if the role is valid, false otherwise.
     */
    isValidRole(role) {
        return role.editable && !role.managed;
    },

    /**
     * We validate if the provided string is a valid hex color code.
     * This function checks if the color matches the hex color format.
     *
     * @param {string} color - The color code to validate.
     * @returns {boolean} True if the color is valid, false otherwise.
     */
    isValidHexColor(color) {
        // We remove the # prefix if present and check if it's a valid 6-digit hex color.
        const cleanColor = color.startsWith('#') ? color.slice(1) : color;
        return /^[A-Fa-f0-9]{6}$/.test(cleanColor);
    },

    /**
     * We normalize a hex color code to include the # prefix.
     * This function ensures consistent color format.
     *
     * @param {string} color - The color code to normalize.
     * @returns {string} The normalized color code with # prefix.
     */
    normalizeColor(color) {
        return color.startsWith('#') ? color : `#${color}`;
    },

    /**
     * We handle errors that occur during command execution.
     * This function logs the error and attempts to notify the user.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Error} error - The error that occurred.
     */
    async handleError(interaction, error) {
        logError(error, 'changecolor', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
        
        if (error.message === "INSUFFICIENT_PERMISSIONS") {
            errorMessage = ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS;
        } else if (error.message === "INVALID_COLOR") {
            errorMessage = ERROR_MESSAGES.INVALID_COLOR;
        } else if (error.message === "MANAGED_ROLE") {
            errorMessage = ERROR_MESSAGES.MANAGED_ROLE;
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for changecolor command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                ephemeral: true 
            }).catch(() => {
                // We silently catch if all error handling attempts fail.
            });
        }
    }
};