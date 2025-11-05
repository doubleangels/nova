const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue } = require('../utils/database');

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Whether the validation was successful
 * @property {string} [message] - Error message if validation failed
 */

/**
 * @typedef {Object} RoleUpdateResult
 * @property {boolean} success - Whether the role update was successful
 * @property {string} [message] - Error message if role update failed
 */

/**
 * Command module for granting moderator permissions to a role.
 * Gives all permissions except Administrator to the specified role.
 * @type {Object}
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('givemod')
        .setDescription('Give a user\'s role all permissions except Administrator and assign the help role.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user should receive moderator permissions?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    /**
     * Executes the give mod command.
     * This function:
     * 1. Gets the target user
     * 2. Finds the user's role above the configured position
     * 3. Updates that role with all permissions except Administrator
     * 4. Assigns the help role to the user
     * 5. Sends a confirmation embed
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error updating the role
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        await interaction.deferReply();
        logger.info("/givemod command initiated:", { 
            userId: interaction.user.id, 
            guildId: interaction.guildId 
        });
        
        try {
            const targetUser = interaction.options.getUser('user');
            
            if (!targetUser) {
                return await interaction.editReply({
                    content: "⚠️ Please provide a valid user.",
                    ephemeral: true
                });
            }
            
            // Fetch the target member
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            
            if (!targetMember) {
                return await interaction.editReply({
                    content: "⚠️ The specified user was not found in this server.",
                    ephemeral: true
                });
            }
            
            // Get the position above role ID from the database
            const positionAboveRoleId = await getValue('perms_position_above_role');
            
            if (!positionAboveRoleId) {
                return await interaction.editReply({
                    content: "⚠️ The position reference role is not configured. Please set 'perms_position_above_role' in the database.",
                    ephemeral: true
                });
            }
            
            const positionRole = await interaction.guild.roles.fetch(positionAboveRoleId).catch(() => null);
            if (!positionRole) {
                return await interaction.editReply({
                    content: `⚠️ The reference role (ID: ${positionAboveRoleId}) was not found in this server.`,
                    ephemeral: true
                });
            }
            
            // Find the user's role that is positioned above the reference role
            const userRoleAbovePosition = targetMember.roles.cache
                .filter(role => role.position > positionRole.position)
                .sort((a, b) => b.position - a.position)
                .first();
            
            if (!userRoleAbovePosition) {
                return await interaction.editReply({
                    content: `⚠️ The user doesn't have a role positioned above the reference role (${positionRole.name}).`,
                    ephemeral: true
                });
            }
            
            // Get the help role ID from the database
            const helpRoleId = await getValue('help_role');
            
            if (!helpRoleId) {
                return await interaction.editReply({
                    content: "⚠️ The help role is not configured. Please set 'help_role' in the database.",
                    ephemeral: true
                });
            }
            
            // Fetch the help role
            const helpRole = await interaction.guild.roles.fetch(helpRoleId).catch(() => null);
            
            if (!helpRole) {
                return await interaction.editReply({
                    content: `⚠️ The help role (ID: ${helpRoleId}) was not found in this server.`,
                    ephemeral: true
                });
            }
            
            logger.debug("Processing command:", { 
                targetUserId: targetUser.id,
                userRoleId: userRoleAbovePosition.id, 
                userRoleName: userRoleAbovePosition.name,
                helpRoleId: helpRoleId,
                helpRoleName: helpRole.name
            });
            
            // Update the user's role with all permissions except Administrator
            const roleUpdateResult = await this.updateRolePermissions(interaction, userRoleAbovePosition);
            if (!roleUpdateResult.success) {
                return await interaction.editReply({
                    content: roleUpdateResult.message,
                    ephemeral: true
                });
            }
            
            // Assign the help role to the user
            if (!targetMember.roles.cache.has(helpRole.id)) {
                const auditReason = `Help role assigned by ${interaction.user.tag} (ID: ${interaction.user.id}) using givemod command`;
                await targetMember.roles.add(helpRole.id, auditReason);
                
                logger.info("Help role assigned to user:", {
                    userId: targetUser.id,
                    helpRoleId: helpRole.id,
                    helpRoleName: helpRole.name
                });
            }
            
            const embed = new EmbedBuilder()
                .setColor(userRoleAbovePosition.color)
                .setTitle('🔒 Moderator Permissions Granted')
                .setDescription(`Successfully gave <@${targetUser.id}> moderator permissions!`)
                .addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Role Updated', value: userRoleAbovePosition.name, inline: true },
                    { name: 'Help Role', value: helpRole.name, inline: true },
                    { name: 'Permissions', value: 'All permissions except Administrator', inline: false }
                );
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/givemod command completed successfully:", {
              userId: interaction.user.id,
              targetUserId: targetUser.id,
              roleId: userRoleAbovePosition.id,
              roleName: userRoleAbovePosition.name,
              helpRoleId: helpRole.id
            });
                        
        } catch (error) {
            await this.handleError(error, interaction);
        }
    },
    
    /**
     * Validates the command inputs.
     * Checks if role is provided and valid.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Role} role - The role to be updated
     * @returns {ValidationResult} Object containing validation result
     */
    validateInputs(interaction, role) {
        if (!role) {
            logger.warn("Invalid role provided.");
            return {
                success: false,
                message: "⚠️ Please provide a valid role."
            };
        }
        
        return { success: true };
    },
    
    /**
     * Gets all permissions except Administrator.
     * 
     * @returns {bigint} Combined permissions value
     */
    getAllPermissionsExceptAdmin() {
        const adminPermission = PermissionFlagsBits.Administrator;
        let permissions = BigInt(0);
        
        // Iterate through all PermissionFlagsBits entries and combine all except Administrator
        for (const [key, value] of Object.entries(PermissionFlagsBits)) {
            // Skip Administrator permission and include all valid bigint permissions
            if (key !== 'Administrator' && typeof value === 'bigint' && value !== adminPermission && value !== BigInt(0)) {
                permissions |= value;
            }
        }
        
        // Ensure SetVoiceChannelStatus is included (may be missing in older Discord.js versions)
        // This permission allows members to create and edit voice channel status
        if (PermissionFlagsBits.SetVoiceChannelStatus && typeof PermissionFlagsBits.SetVoiceChannelStatus === 'bigint') {
            permissions |= PermissionFlagsBits.SetVoiceChannelStatus;
        }
        
        return permissions;
    },
    
    /**
     * Updates the role with all permissions except Administrator.
     * Checks bot permissions and role hierarchy before updating.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Role} role - The role to be updated
     * @returns {Promise<RoleUpdateResult>} Object containing role update result
     */
    async updateRolePermissions(interaction, role) {
        const botMember = await interaction.guild.members.fetchMe();
        
        // Check if bot can manage this role
        if (botMember.roles.highest.position <= role.position) {
            logger.warn("Bot's highest role is not high enough to modify the specified role.", {
                botHighestRolePosition: botMember.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: "⚠️ I don't have permission to modify this role. The role must be below my highest role."
            };
        }
        
        // Check if the user can manage this role
        if (interaction.member.roles.highest.position <= role.position && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            logger.warn("User's highest role is not high enough to modify the specified role.", {
                userHighestRolePosition: interaction.member.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: "⚠️ You don't have permission to modify this role. The role must be below your highest role."
            };
        }
        
        const allPermissionsExceptAdmin = this.getAllPermissionsExceptAdmin();
        const auditReason = `Moderator permissions granted by ${interaction.user.tag} (ID: ${interaction.user.id}) using givemod command`;
        
        await role.edit({
            permissions: allPermissionsExceptAdmin,
            reason: auditReason
        });
        
        logger.info("/givemod role updated successfully:", { 
            roleId: role.id, 
            roleName: role.name,
            updatedBy: interaction.user.tag
        });
        
        return { success: true };
    },
    
    /**
     * Handles errors that occur during command execution.
     * Logs the error and sends an appropriate error message to the user.
     * 
     * @param {Error} error - The error that occurred
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @returns {Promise<void>}
     */
    async handleError(error, interaction) {
        logger.error('Error in givemod command:', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });

        let errorMessage = "⚠️ An unexpected error occurred while updating the role permissions.";
        
        if (error.message === "INSUFFICIENT_PERMISSIONS") {
            errorMessage = "⚠️ I don't have permission to manage roles.";
        } else if (error.message === "INVALID_ROLE") {
            errorMessage = "⚠️ The specified role is invalid or doesn't exist.";
        } else if (error.message.includes("Missing Permissions")) {
            errorMessage = "⚠️ I don't have permission to modify this role.";
        } else if (error.message.includes("Hierarchy")) {
            errorMessage = "⚠️ I cannot modify this role because it's higher than or equal to my highest role.";
        }

        try {
            await interaction.editReply({ content: errorMessage });
        } catch (replyError) {
            logger.error('Failed to send error message:', {
                error: replyError.message,
                stack: replyError.stack
            });
        }
    }
};

