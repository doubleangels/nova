const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

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
                .setDescription('what role would you like to change the color for?')
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
        // Defer reply since this might take a moment
        await interaction.deferReply();
        logger.debug("/changecolor command received:", { user: interaction.user.tag });
        
        try {
            // Extract command options
            const role = interaction.options.getRole('role');
            const colorHex = interaction.options.getString('color');
            
            logger.debug("Command options:", { 
                roleId: role.id,
                roleName: role.name,
                colorHex
            });
            
            // Store the original color before changing
            const originalColor = role.hexColor;
            
            // Validate and normalize color format
            let normalizedColorHex = colorHex;
            if (colorHex.match(/^[0-9A-Fa-f]{6}$/)) {
                // If it's just RRGGBB without #, add the #
                normalizedColorHex = `#${colorHex}`;
                logger.debug("Color format normalized:", { original: colorHex, normalized: normalizedColorHex });
            } else if (!colorHex.match(/^#[0-9A-Fa-f]{6}$/)) {
                // If it doesn't match either format, it's invalid
                logger.warn("Invalid color format:", { colorHex });
                return await interaction.editReply({
                    content: "⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB.",
                    flags: MessageFlags.Ephemeral
                });
            }
            
            // Convert hex to decimal for Discord's color system
            const colorDecimal = parseInt(normalizedColorHex.replace('#', ''), 16);
            logger.debug("Color converted to decimal:", { hex: normalizedColorHex, decimal: colorDecimal });
            
            // Change the role color
            await role.setColor(colorDecimal, `Color changed by ${interaction.user.tag} using changecolor command.`);
            
            logger.info("Role color successfully changed:", { 
                roleId: role.id, 
                roleName: role.name,
                oldColor: originalColor,
                newColor: normalizedColorHex,
                changedBy: interaction.user.tag
            });
            
            await interaction.editReply({
                content: `✅ Successfully changed the color of ${role} from ${originalColor} to ${normalizedColorHex}!`
            });
            
        } catch (error) {
            // Log the full error with stack trace
            logger.error("Error in /changecolor command:", { 
                error: error.message,
                stack: error.stack 
            });
            await interaction.editReply({
                content: "⚠️ An unexpected error occurred. Please try again later.",
                flags: MessageFlags.Ephemeral
            });
        }
    },
};