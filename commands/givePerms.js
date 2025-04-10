const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

// Configuration constants.
const COMMAND_CONFIG = {
    POSITION_ABOVE_ROLE_ID: config.givePermsPositionAboveRoleId,
    FREN_ROLE_ID: config.givePermsFrenRoleId,
    MAX_ROLE_NAME_LENGTH: 100 // Discord's maximum role name length.
};

// Validate required configuration.
if (!COMMAND_CONFIG.POSITION_ABOVE_ROLE_ID || !COMMAND_CONFIG.FREN_ROLE_ID) {
    logger.error("Missing required configuration for /giveperms command.", {
        positionAboveRoleId: COMMAND_CONFIG.POSITION_ABOVE_ROLE_ID,
        frenRoleId: COMMAND_CONFIG.FREN_ROLE_ID
    });
}

/**
 * Module for the /giveperms command.
 * Creates a custom role with specified name and color for a user,
 * and assigns them both this role and a predefined "fren" role.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveperms')
        .setDescription('Gives user permissions in the server.')
        .addStringOption(option =>
            option.setName('role')
                .setDescription("What do you want the name of the user's role to be?")
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription("What color should the user's role be? (#RRGGBB or RRGGBB)")
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user should receive the role?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the /giveperms command.
     * @param {Interaction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // Check if required configuration is available.
        if (!COMMAND_CONFIG.POSITION_ABOVE_ROLE_ID || !COMMAND_CONFIG.FREN_ROLE_ID) {
            logger.error("Command execution failed due to missing configuration.", {
                commandName: 'giveperms',
                guildId: interaction.guildId
            });
            return await interaction.reply({
                content: "⚠️ This command is not properly configured. Please contact an administrator.",
                ephemeral: true
            });
        }
        
        // Defer reply since this might take a moment.
        await interaction.deferReply({ ephemeral: true });
        logger.info("/giveperms command initiated.", { 
            userId: interaction.user.id, 
            guildId: interaction.guildId 
        });
        
        try {
            // Extract command options.
            const roleName = interaction.options.getString('role');
            const colorHex = interaction.options.getString('color');
            const targetUser = interaction.options.getUser('user');
            
            // Validate role name.
            if (!roleName || roleName.trim().length === 0) {
                logger.warn("Invalid role name provided.", { roleName });
                return await interaction.editReply({
                    content: "Please provide a valid role name.",
                    ephemeral: true
                });
            }
            
            if (roleName.length > COMMAND_CONFIG.MAX_ROLE_NAME_LENGTH) {
                logger.warn("Role name exceeds maximum length.", { 
                    roleName, 
                    maxLength: COMMAND_CONFIG.MAX_ROLE_NAME_LENGTH 
                });
                return await interaction.editReply({
                    content: `Role name must be ${COMMAND_CONFIG.MAX_ROLE_NAME_LENGTH} characters or less.`,
                    ephemeral: true
                });
            }
            
            logger.debug("Processing command options.", { 
                roleName, 
                colorHex, 
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag 
            });
            
            // Fetch the target member from the guild.
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            if (!targetMember) {
                logger.warn("Target user not found in guild.", { targetUserId: targetUser.id });
                return await interaction.editReply({
                    content: "The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            // Validate and normalize color format.
            let normalizedColorHex = colorHex;
            if (colorHex.match(/^[0-9A-Fa-f]{6}$/)) {
                // If it's just RRGGBB without #, add the #.
                normalizedColorHex = `#${colorHex}`;
                logger.debug("Color format normalized.", { original: colorHex, normalized: normalizedColorHex });
            } else if (!colorHex.match(/^#[0-9A-Fa-f]{6}$/)) {
                // If it doesn't match either format, it's invalid.
                logger.warn("Invalid color format provided.", { colorHex });
                return await interaction.editReply({
                    content: "Invalid color format. Please use the format #RRGGBB or RRGGBB.",
                    ephemeral: true
                });
            }

            // Convert hex to decimal for Discord's color system.
            const colorDecimal = parseInt(normalizedColorHex.replace('#', ''), 16);
            
            // Get the reference role for positioning.
            const positionRole = interaction.guild.roles.cache.get(COMMAND_CONFIG.POSITION_ABOVE_ROLE_ID);
            if (!positionRole) {
                logger.error("Reference role not found.", { roleId: COMMAND_CONFIG.POSITION_ABOVE_ROLE_ID });
                return await interaction.editReply({
                    content: "⚠️ Reference role for positioning not found. Please check the positioning role ID.",
                    ephemeral: true
                });
            }
            
            // Get the additional role to assign.
            const additionalRole = interaction.guild.roles.cache.get(COMMAND_CONFIG.FREN_ROLE_ID);
            if (!additionalRole) {
                logger.error("Additional role not found.", { roleId: COMMAND_CONFIG.FREN_ROLE_ID });
                return await interaction.editReply({
                    content: "⚠️ Additional role not found. Please check the Fren role ID.",
                    ephemeral: true
                });
            }
            
            // Create the new role.
            const newRole = await interaction.guild.roles.create({
                name: roleName.trim(),
                color: colorDecimal,
                position: positionRole.position + 1,
                reason: `Role created by ${interaction.user.tag} using giveperms command`
            });
            logger.info("New role created.", { 
                roleId: newRole.id, 
                roleName: newRole.name, 
                position: newRole.position,
                createdBy: interaction.user.tag
            });
            
            // Assign both roles to the user.
            await targetMember.roles.add([newRole.id, additionalRole.id], 
                `Roles assigned by ${interaction.user.tag} using giveperms command`);
            
            logger.info("Permissions successfully granted to user.", { 
                userId: targetUser.id, 
                userTag: targetUser.tag,
                roles: [newRole.name, additionalRole.name],
                roleIds: [newRole.id, additionalRole.id]
            });
            
            await interaction.editReply({
                content: `✅ Successfully gave <@${targetUser.id}> permissions in the server!`,
                ephemeral: true
            });
                        
        } catch (error) {
            // Log the full error with stack trace.
            logger.error("Error executing /giveperms command.", { 
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
            await interaction.editReply({
                content: "⚠️ An unexpected error occurred. Please try again later.",
                ephemeral: true
            });
        }
    },
};
