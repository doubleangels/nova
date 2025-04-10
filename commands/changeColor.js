const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Configuration constants
const COLOR_PATTERN_HEX_WITH_HASH = /^#[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_WITHOUT_HASH = /^[0-9A-Fa-f]{6}$/;

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
     * @param {Interaction} interaction - The Discord interaction object.
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
            
            // Check if bot has permission to manage this role.
            if (!role.editable) {
                logger.warn("Permission denied: Role cannot be modified by the bot.", {
                    roleId: role.id,
                    roleName: role.name,
                    userId: interaction.user.id
                });
                
                return await interaction.editReply({
                    content: "⚠️ I don't have permission to modify this role. Please check that the role is below my highest role.",
                    ephemeral: true
                });
            }
            
            // Store the original color before changing.
            const originalColor = role.hexColor;
            
            // Validate and normalize color format.
            let normalizedColorHex = colorHex;
            
            if (COLOR_PATTERN_HEX_WITHOUT_HASH.test(colorHex)) {
                // If it's just RRGGBB without #, add the #.
                normalizedColorHex = `#${colorHex}`;
                logger.debug("Color format normalized.", { 
                    original: colorHex, 
                    normalized: normalizedColorHex 
                });
            } else if (!COLOR_PATTERN_HEX_WITH_HASH.test(colorHex)) {
                // If it doesn't match either format, it's invalid.
                logger.warn("Invalid color format provided.", { 
                    colorHex: colorHex,
                    userId: interaction.user.id 
                });
                
                return await interaction.editReply({
                    content: "⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB.",
                    ephemeral: true
                });
            }
            
            // Convert hex to decimal for Discord's color system.
            const colorDecimal = parseInt(normalizedColorHex.replace('#', ''), 16);
            logger.debug("Color converted to decimal for Discord API.", { 
                hex: normalizedColorHex, 
                decimal: colorDecimal 
            });
            
            // Attempt to change the role color.
            await role.setColor(colorDecimal, `Color changed by ${interaction.user.tag} using changecolor command.`);
            
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
            
            // Determine the appropriate error message.
            let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
            
            if (error.code === 50013) {
                errorMessage = "⚠️ I don't have permission to modify this role. Please check role hierarchy and permissions.";
            } else if (error.message.includes('rate limit')) {
                errorMessage = "⚠️ Discord is currently rate limiting this action. Please try again in a few moments.";
            }
            
            await interaction.editReply({
                content: errorMessage,
                ephemeral: true
            });
        }
    },
};
