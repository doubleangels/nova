const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /giverole command.
 * Assigns a specified role to a specified user.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giverole')
        .setDescription('Gives a specified role to a user.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('What role would you like to assign?')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Which user should receive this role?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the /giverole command.
     * @param {Interaction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // Defer reply since this might take a moment
        await interaction.deferReply();
        logger.debug("/giverole command received:", { user: interaction.user.tag });
        
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
            
            // Check if the user already has the role
            const hasRole = targetMember.roles.cache.has(role.id);
            
            if (hasRole) {
                logger.debug("User already has the role:", {
                    userId: targetUser.id,
                    roleId: role.id
                });
                return await interaction.editReply({ content: "⚠️ ${targetUser} already has the ${role} role.", ephemeral: true });
            }
            
            // Add the role to the user
            await targetMember.roles.add(role, `Role assigned by ${interaction.user.tag} using giverole command.`);
            
            logger.info("Role successfully assigned:", { 
                roleId: role.id, 
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag,
                assignedBy: interaction.user.tag
            });
            
            await interaction.editReply({
                content: `✅ Successfully gave the ${role} role to ${targetUser}!`
            });
            
        } catch (error) {
            // Log the full error with stack trace
            logger.error("Error in /giverole command:", { 
                error: error.message,
                stack: error.stack 
            });
            
            await interaction.editReply({
                content: "⚠️ There was an error while executing this command.",
                flags: MessageFlags.Ephemeral
            });
        }
    },
};
