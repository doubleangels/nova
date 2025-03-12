const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

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
            option.setName('rolename')
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
        // Defer reply since this might take a moment
        await interaction.deferReply();
        logger.debug("/giveperms command received:", { user: interaction.user.tag });
        
        try {
            // Extract command options
            const roleName = interaction.options.getString('rolename');
            const colorHex = interaction.options.getString('color');
            const targetUser = interaction.options.getUser('user');
            
            logger.debug("Command options:", { 
                roleName, 
                colorHex, 
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag 
            });
            
            // Fetch the target member from the guild
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            logger.debug("Target member fetched:", { 
                id: targetMember.id, 
                tag: targetMember.user.tag 
            });
            
            // Get reference role IDs from config
            const POSITION_ABOVE_ROLE_ID = config.givePermsPositionAboveRoleId;
            const FREN_ROLE_ID = config.givePermsFrenRoleId;
            
            logger.debug("Using configuration:", { 
                positionAboveRoleId: POSITION_ABOVE_ROLE_ID, 
                frenRoleId: FREN_ROLE_ID 
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
                return await interaction.editReply('Invalid color format. Please use the format #RRGGBB or RRGGBB.');
            }

            // Convert hex to decimal for Discord's color system
            const colorDecimal = parseInt(normalizedColorHex.replace('#', ''), 16);
            logger.debug("Color converted to decimal:", { hex: normalizedColorHex, decimal: colorDecimal });
            
            // Get the reference role for positioning
            const positionRole = interaction.guild.roles.cache.get(POSITION_ABOVE_ROLE_ID);
            if (!positionRole) {
                logger.error("Reference role not found:", { roleId: POSITION_ABOVE_ROLE_ID });
                return await interaction.editReply('Reference role for positioning not found. Please check the hardcoded role ID.');
            }
            logger.debug("Reference role found:", { 
                roleId: positionRole.id, 
                roleName: positionRole.name, 
                position: positionRole.position 
            });
            
            // Create the new role
            const newRole = await interaction.guild.roles.create({
                name: roleName,
                color: colorDecimal,
                position: positionRole.position + 1,
                reason: `Role created by ${interaction.user.tag} using giveperms command`
            });
            logger.info("New role created:", { 
                roleId: newRole.id, 
                roleName: newRole.name, 
                position: newRole.position,
                createdBy: interaction.user.tag
            });
            
            // Get the additional role to assign
            const additionalRole = interaction.guild.roles.cache.get(FREN_ROLE_ID);
            if (!additionalRole) {
                logger.error("Additional role not found:", { roleId: FREN_ROLE_ID });
                return await interaction.editReply('Additional role not found. Please check the Fren role ID.');
            }
            logger.debug("Additional role found:", { 
                roleId: additionalRole.id, 
                roleName: additionalRole.name 
            });
            
            // Assign both roles to the user
            await targetMember.roles.add(newRole);
            logger.debug("New role assigned to user:", { 
                userId: targetUser.id, 
                roleId: newRole.id 
            });
            
            await targetMember.roles.add(additionalRole);
            logger.debug("Additional role assigned to user:", { 
                userId: targetUser.id, 
                roleId: additionalRole.id 
            });
            
            logger.info("Permissions successfully given to user:", { 
                userId: targetUser.id, 
                userTag: targetUser.tag,
                roles: [newRole.id, additionalRole.id] 
            });
            
            await interaction.editReply({
                content: `Successfully gave ${targetUser.tag} permissions in the server!`
            });
            
        } catch (error) {
            // Log the full error with stack trace
            logger.error("Error in /giveperms command:", { 
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
