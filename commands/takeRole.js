const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /takerole command.
 * Removes a specified role from a specified user.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('takerole')
        .setDescription('Removes a specified role from a user.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('What role would you like to remove?')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Which user should have this role removed?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the /takerole command.
     * @param {Interaction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // Defer reply since this might take a moment
        await interaction.deferReply();
        logger.debug("/takerole command received:", { user: interaction.user.tag });
        
        try {
            // Extract command options
            const role = interaction.options.getRole('role');
            const targetUser = interaction.options.getUser('user');
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            logger.debug("Command options:", { 
                roleId: role.id,
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag
            });
            
            // Check if the user has the role
            const hasRole = targetMember.roles.cache.has(role.id);
            
            if (!hasRole) {
                logger.debug("User doesn't have the role:", {
                    userId: targetUser.id,
                    roleId: role.id
                });
                return await interaction.editReply({ content: `⚠️ ${targetUser} doesn't have the ${role} role.`, flags: MessageFlags.Ephemeral });
            }
            
            // Remove the role from the user
            await targetMember.roles.remove(role, `Role removed by ${interaction.user.tag} using takerole command.`);
            
            logger.info("Role successfully removed:", { 
                roleId: role.id, 
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag,
                removedBy: interaction.user.tag
            });
            
            await interaction.editReply({
                content: `✅ Successfully removed the ${role} role from ${targetUser}!`
            });
            
        } catch (error) {
            // Log the full error with stack trace
            logger.error("Error in /takerole command:", { 
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
