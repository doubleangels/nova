const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
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
        // Defer reply since this might take a moment.
        await interaction.deferReply({ ephemeral: true });
        logger.info(`/giverole command initiated.`, { 
            userId: interaction.user.id, 
            guildId: interaction.guild.id 
        });
        
        try {
            // Extract command options.
            const role = interaction.options.getRole('role');
            const targetUser = interaction.options.getUser('user');
            
            logger.debug("Processing command options.", { 
                roleId: role.id,
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag
            });
            
            // Check if the bot has permission to manage roles.
            const botMember = await interaction.guild.members.fetchMe();
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                logger.warn("Bot lacks ManageRoles permission.", { 
                    guildId: interaction.guild.id
                });
                return await interaction.editReply({
                    content: "⚠️ I don't have permission to manage roles in this server.",
                    ephemeral: true
                });
            }
            
            // Check role hierarchy for the user issuing the command.
            const issuerMember = await interaction.guild.members.fetch(interaction.user.id);
            const issuerHighestRole = issuerMember.roles.highest;
            if (role.position >= issuerHighestRole.position && interaction.guild.ownerId !== interaction.user.id) {
                logger.warn("User attempted to assign a role higher than their highest role.", {
                    userId: interaction.user.id,
                    roleId: role.id,
                    userHighestRoleId: issuerHighestRole.id
                });
                return await interaction.editReply({
                    content: "⚠️ You don't have permission to assign a role higher than your highest role.",
                    ephemeral: true
                });
            }
            
            // Fetch the target member from the guild.
            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(targetUser.id);
            } catch (e) {
                logger.warn("Target user not found in guild.", { 
                    targetUserId: targetUser.id
                });
                return await interaction.editReply({
                    content: "⚠️ The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            // Check if the user already has the role.
            const hasRole = targetMember.roles.cache.has(role.id);
            if (hasRole) {
                logger.debug("User already has the role.", {
                    userId: targetUser.id,
                    roleId: role.id
                });
                return await interaction.editReply({
                    content: `⚠️ ${targetUser} already has the ${role} role.`,
                    ephemeral: true
                });
            }
            
            // Add the role to the user.
            await targetMember.roles.add(role, `Role assigned by ${interaction.user.tag} using giverole command.`);
            
            logger.info("Role successfully assigned.", { 
                roleId: role.id, 
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag,
                assignedBy: interaction.user.id,
                assignedByTag: interaction.user.tag,
                guildId: interaction.guild.id
            });
            
            await interaction.editReply({
                content: `✅ Successfully gave the ${role} role to ${targetUser}!`,
                ephemeral: true
            });
            
        } catch (error) {
            // Log the full error with stack trace.
            logger.error("Error executing /giverole command.", { 
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guild.id
            });
            await interaction.editReply({
                content: "⚠️ An unexpected error occurred. Please try again later.",
                ephemeral: true
            });
        }
    },
};
