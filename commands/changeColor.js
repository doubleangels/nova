const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { validateAndNormalizeColor, hexToDecimal } = require('../utils/colorUtils');

/**
 * Module for the /changecolor command.
 * Changes the color of a specified role to the provided hex color.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('changecolor')
        .setDescription('Changes the color of a role.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('What role would you like to change the color for?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('What color should the role have? (#RRGGBB or RRGGBB)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the /changecolor command.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // Defer reply since this might take a moment.
        await interaction.deferReply();
        logger.info("Color change command initiated.", { userId: interaction.user.id });
        
        try {
            // Extract command options.
            const role = interaction.options.getRole('role');
            const colorHex = interaction.options.getString('color');
            
            logger.debug("Received command options.", { 
                roleId: role.id,
                roleName: role.name,
                colorHex: colorHex
            });
            
            // Validate permissions and role hierarchy
            const permissionCheckResult = await this.checkPermissions(interaction, role);
            if (!permissionCheckResult.success) {
                return await interaction.editReply({
                    content: permissionCheckResult.message
                });
            }
            
            // Store the original color before changing.
            const originalColor = role.hexColor;
            
            // Validate and normalize color format using the utility function.
            const colorValidationResult = validateAndNormalizeColor(colorHex, logger);
            if (!colorValidationResult.success) {
                logger.warn("Invalid color format provided.", { 
                    colorHex: colorHex,
                    userId: interaction.user.id 
                });
                
                return await interaction.editReply({
                    content: "⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB."
                });
            }
            
            const normalizedColorHex = colorValidationResult.normalizedColor;
            // Convert hex to decimal for Discord's color system using the utility function.
            const colorDecimal = hexToDecimal(normalizedColorHex);
            logger.debug("Color converted to decimal for Discord API.", { 
                hex: normalizedColorHex, 
                decimal: colorDecimal 
            });
            
            // Attempt to change the role color.
            const auditReason = `Color changed by ${interaction.user.tag} (ID: ${interaction.user.id}) using changecolor command.`;
            await role.setColor(colorDecimal, auditReason);
            
            logger.info("Role color successfully changed.", { 
                roleId: role.id, 
                roleName: role.name,
                oldColor: originalColor,
                newColor: normalizedColorHex,
                changedBy: interaction.user.id
            });
            
            await interaction.editReply({
                content: `✅ Successfully changed the color of ${role} from ${originalColor} to ${normalizedColorHex}!`
            });
            
        } catch (error) {
            // Log the full error with stack trace.
            logger.error("Failed to change role color.", { 
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id
            });
            
            await interaction.editReply({
                content: this.getErrorMessage(error)
            });
        }
    },

    /**
     * Checks if the user and bot have permission to modify the role.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Role} role - The role to check permissions for.
     * @returns {Object} An object with success status and message.
     */
    async checkPermissions(interaction, role) {
        // Check if bot has permission to manage this role.
        if (!role.editable) {
            logger.warn("Permission denied: Role cannot be modified by the bot.", {
                roleId: role.id,
                roleName: role.name,
                userId: interaction.user.id
            });
            
            return {
                success: false,
                message: "⚠️ I don't have permission to modify this role. Please check that the role is below my highest role."
            };
        }

        // Check user's role hierarchy (unless they're the server owner)
        if (interaction.guild.ownerId !== interaction.user.id) {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const memberHighestRole = member.roles.highest;
            
            if (memberHighestRole.position <= role.position) {
                logger.warn("Permission denied: User cannot modify a role equal to or higher than their highest role.", {
                    roleId: role.id,
                    roleName: role.name,
                    userId: interaction.user.id,
                    userHighestRoleId: memberHighestRole.id,
                    userHighestRolePosition: memberHighestRole.position,
                    targetRolePosition: role.position
                });
                
                return {
                    success: false,
                    message: "⚠️ You don't have permission to modify a role that is equal to or higher than your highest role."
                };
            }
        }
        
        return { success: true };
    },

    /**
     * Gets a user-friendly error message based on the error.
     * @param {Error} error - The error object.
     * @returns {string} A user-friendly error message.
     */
    getErrorMessage(error) {
        if (error.code === 50013) {
            return "⚠️ I don't have permission to modify this role. Please check role hierarchy and permissions.";
        } else if (error.message.includes('rate limit')) {
            return "⚠️ Discord is currently rate limiting this action. Please try again in a few moments.";
        } else if (error.message.includes('Maximum number of server roles reached')) {
            return "⚠️ This server has reached the maximum number of roles allowed by Discord.";
        } else if (error.message.includes('Invalid color')) {
            return "⚠️ The color provided is invalid. Please use a valid hex color code.";
        }
        return "⚠️ An unexpected error occurred. Please try again later.";
    }
};