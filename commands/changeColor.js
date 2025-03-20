const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /changecolor command.
 * Changes the color of a specified role to the provided hex color.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('changecolor')
        .setDescription('Changes the color of a role')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to change the color of')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('The new color in #RRGGBB or RRGGBB format')
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
            
            // Validate and normalize color format
            let normalizedColorHex = colorHex;
            if (colorHex.match(/^[0-9A-Fa-f]{6}$/)) {
                // If it's just RRGGBB without #, add the #
                normalizedColorHex = `#${colorHex}`;
                logger.debug("Color format normalized:", { original: colorHex, normalized: normalizedColorHex });
            } else if (!colorHex.match(/^#[0-9A-Fa-f]{6}$/)) {
                // If it doesn't match either format, it's invalid
                logger.warn("Invalid color format:", { colorHex });
                return await interaction.editReply('⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB.');
            }
            
            // Convert hex to decimal for Discord's color system
            const colorDecimal = parseInt(normalizedColorHex.replace('#', ''), 16);
            logger.debug("Color converted to decimal:", { hex: normalizedColorHex, decimal: colorDecimal });
            
            // Change the role color
            await role.setColor(colorDecimal, `Color changed by ${interaction.user.tag} using changecolor command.`);
            
            logger.info("Role color successfully changed:", { 
                roleId: role.id, 
                roleName: role.name,
                newColor: normalizedColorHex,
                changedBy: interaction.user.tag
            });
            
            await interaction.editReply({
                content: `✅ Successfully changed the color of ${role.name} to ${normalizedColorHex}!`
            });
            
        } catch (error) {
            // Log the full error with stack trace
            logger.error("Error in /changecolor command:", { 
                error: error.message,
                stack: error.stack 
            });
            
            // Provide a user-friendly error message
            let errorMessage = 'There was an error while executing this command.';
            
            await interaction.editReply({
                content: `⚠️ ${errorMessage}`
            });
        }
    },
};