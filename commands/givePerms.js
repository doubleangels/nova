/**
 * Give permissions command module for managing user roles and permissions.
 * Handles role creation, assignment, and permission validation.
 * @module commands/givePerms
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { validateAndNormalizeColor, hexToDecimal } = require('../utils/colorUtils');
const { logError } = require('../errors');

if (!config.givePermsPositionAboveRoleId || !config.givePermsFrenRoleId) {
    logger.error("Missing required configuration for /giveperms command:", {
        positionAboveRoleId: config.givePermsPositionAboveRoleId,
        frenRoleId: config.givePermsFrenRoleId
    });
}

/**
 * We handle the giveperms command.
 * This function creates a custom role with specified name and color for a user,
 * and assigns them both this role and a predefined "fren" role.
 *
 * We perform several tasks:
 * 1. We validate command inputs and configuration.
 * 2. We create a new role with the specified name and color.
 * 3. We assign the new role and the fren role to the target user.
 * 4. We handle errors and provide user feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveperms')
        .setDescription('Give a user permissions in the server.')
        .addStringOption(option =>
            option.setName('role')
                .setDescription("What do you want the name of the user's role to be?")
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription("What color should the user's role be? (e.g., #RRGGBB, RRGGBB)")
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user should receive the permissions?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the give permissions command.
     * @async
     * @function execute
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @throws {Error} If role creation or assignment fails
     */
    async execute(interaction) {
        if (!config.givePermsPositionAboveRoleId || !config.givePermsFrenRoleId) {
            logger.error("Command execution failed due to missing configuration:", {
                commandName: 'giveperms',
                guildId: interaction.guildId
            });
            return await interaction.reply({
                content: "⚠️ This command is not properly configured. Please contact an administrator.",
                ephemeral: true
            });
        }
        
        await interaction.deferReply();
        logger.info("/giveperms command initiated:", { 
            userId: interaction.user.id, 
            guildId: interaction.guildId 
        });
        
        try {
            const roleName = interaction.options.getString('role');
            const colorHex = interaction.options.getString('color');
            const targetUser = interaction.options.getUser('user');
            
            const validationResult = this.validateInputs(interaction, roleName, colorHex, targetUser);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message,
                    ephemeral: true
                });
            }
            
            logger.debug("Processing command options:", { 
                roleName, 
                colorHex, 
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag 
            });
            
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            if (!targetMember) {
                logger.warn("Target user not found in guild:", { targetUserId: targetUser.id });
                return await interaction.editReply({
                    content: "⚠️ The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            const colorValidationResult = validateAndNormalizeColor(colorHex, logger);
            if (!colorValidationResult.success) {
                logger.warn("Invalid color format provided:", { colorHex });
                return await interaction.editReply({
                    content: "⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB.",
                    ephemeral: true
                });
            }

            const normalizedColorHex = colorValidationResult.normalizedColor;
            const colorDecimal = hexToDecimal(normalizedColorHex);
            
            const rolesResult = await this.createAndAssignRoles(
                interaction, 
                roleName.trim(), 
                colorDecimal, 
                targetMember
            );
            
            if (!rolesResult.success) {
                return await interaction.editReply({
                    content: rolesResult.message,
                    ephemeral: true
                });
            }
            
            const embed = new EmbedBuilder()
                .setColor(colorDecimal)
                .setTitle('Permissions Granted')
                .setDescription(`✅ Successfully gave <@${targetUser.id}> permissions in the server!`)
                .addFields(
                    { name: 'New Role', value: roleName.trim(), inline: true },
                    { name: 'Role Color', value: `\`${normalizedColorHex}\``, inline: true }
                )
                .setFooter({ text: `Updated by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
                        
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },
    
    /**
     * Validates command input parameters.
     * @function validateInputs
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {string} roleName - The name for the new role
     * @param {string} colorHex - The color for the new role
     * @param {import('discord.js').User} targetUser - The user to receive the role
     * @returns {Object} Validation result with success status and message
     */
    validateInputs(interaction, roleName, colorHex, targetUser) {
        if (!roleName || roleName.trim().length === 0) {
            logger.warn("Invalid role name provided.", { roleName });
            return {
                success: false,
                message: "⚠️ Please provide a valid role name."
            };
        }

        if (roleName.length > 100) {
            logger.warn("Role name exceeds maximum length.", { 
                roleName, 
                maxLength: 100 
            });
            return {
                success: false,
                message: `Role name must be 100 characters or less.`
            };
        }
        
        return { success: true };
    },
    
    /**
     * Creates and assigns roles to a user.
     * @async
     * @function createAndAssignRoles
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {string} roleName - The name for the new role
     * @param {number} colorDecimal - The color for the new role in decimal format
     * @param {import('discord.js').GuildMember} targetMember - The member to receive the roles
     * @returns {Object} Result with success status and message
     * @throws {Error} If role creation or assignment fails
     */
    async createAndAssignRoles(interaction, roleName, colorDecimal, targetMember) {
        const positionRole = interaction.guild.roles.cache.get(config.givePermsPositionAboveRoleId);
        if (!positionRole) {
            logger.error("Reference role not found.", { roleId: config.givePermsPositionAboveRoleId });
            return {
                success: false,
                message: "⚠️ Required role not found. Please contact an administrator."
            };
        }
        
        const additionalRole = interaction.guild.roles.cache.get(config.givePermsFrenRoleId);
        if (!additionalRole) {
            logger.error("Additional role not found.", { roleId: config.givePermsFrenRoleId });
            return {
                success: false,
                message: "⚠️ Required role not found. Please contact an administrator."
            };
        }
        
        const botMember = await interaction.guild.members.fetchMe();
        if (botMember.roles.highest.position <= positionRole.position) {
            logger.warn("Bot's highest role is not high enough to create a role above the reference role.", {
                botHighestRolePosition: botMember.roles.highest.position,
                referenceRolePosition: positionRole.position
            });
            return {
                success: false,
                message: "⚠️ I don't have permission to create or assign roles."
            };
        }
        
        const auditReason = `Role created by ${interaction.user.tag} (ID: ${interaction.user.id}) using giveperms command`;
        const newRole = await interaction.guild.roles.create({
            name: roleName,
            color: colorDecimal,
            position: positionRole.position + 1,
            reason: auditReason
        });
        
        logger.info("New role created:", { 
            roleId: newRole.id, 
            roleName: newRole.name, 
            position: newRole.position,
            createdBy: interaction.user.tag
        });
        
        await targetMember.roles.add([newRole.id, additionalRole.id], auditReason);
        
        logger.info("Permissions successfully granted to user:", { 
            userId: targetMember.id, 
            userTag: targetMember.user.tag,
            roles: [newRole.name, additionalRole.name],
            roleIds: [newRole.id, additionalRole.id]
        });
        
        return { success: true };
    },
    
    /**
     * Handles errors that occur during command execution.
     * @async
     * @function handleError
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {Error} error - The error that occurred
     */
    async handleError(interaction, error) {
        logError(error, 'giveperms', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        let errorMessage = "⚠️ An unexpected error occurred while granting permissions.";
        
        if (error.message === "CONFIG_MISSING") {
            errorMessage = "⚠️ This command is not properly configured. Please contact an administrator.";
        } else if (error.message === "INSUFFICIENT_PERMISSIONS") {
            errorMessage = "⚠️ I don't have permission to create or assign roles.";
        } else if (error.message === "INVALID_ROLE_NAME") {
            errorMessage = "⚠️ Please provide a valid role name.";
        } else if (error.message === "INVALID_COLOR") {
            errorMessage = "⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB.";
        } else if (error.message === "USER_NOT_FOUND") {
            errorMessage = "⚠️ The specified user could not be found in this server.";
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for giveperms command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                ephemeral: true 
            }).catch(() => {
            });
        }
    }
};