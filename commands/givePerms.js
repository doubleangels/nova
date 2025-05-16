const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { validateAndNormalizeColor, hexToDecimal } = require('../utils/colorUtils');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the givePerms command.
const POSITION_ABOVE_ROLE_ID = config.givePermsPositionAboveRoleId;
const FREN_ROLE_ID = config.givePermsFrenRoleId;
const MAX_ROLE_NAME_LENGTH = 100; // We enforce a maximum role name length of 100 characters.

// We validate that the required configuration values are present.
if (!POSITION_ABOVE_ROLE_ID || !FREN_ROLE_ID) {
    logger.error("Missing required configuration for /giveperms command.", {
        positionAboveRoleId: POSITION_ABOVE_ROLE_ID,
        frenRoleId: FREN_ROLE_ID
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
     * We execute the /giveperms command.
     * This function processes the permission assignment request.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // We check if the required configuration values are available before proceeding.
        if (!POSITION_ABOVE_ROLE_ID || !FREN_ROLE_ID) {
            logger.error("Command execution failed due to missing configuration.", {
                commandName: 'giveperms',
                guildId: interaction.guildId
            });
            return await interaction.reply({
                content: ERROR_MESSAGES.CONFIG_MISSING,
                ephemeral: true
            });
        }
        
        // We defer the reply since role creation and assignment might take a moment.
        await interaction.deferReply();
        logger.info("/giveperms command initiated.", { 
            userId: interaction.user.id, 
            guildId: interaction.guildId 
        });
        
        try {
            // We extract the command options provided by the user.
            const roleName = interaction.options.getString('role');
            const colorHex = interaction.options.getString('color');
            const targetUser = interaction.options.getUser('user');
            
            // We validate all inputs before proceeding with role creation.
            const validationResult = this.validateInputs(interaction, roleName, colorHex, targetUser);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message,
                    ephemeral: true
                });
            }
            
            logger.debug("Processing command options.", { 
                roleName, 
                colorHex, 
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag 
            });
            
            // We fetch the target member from the guild to ensure they exist.
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            if (!targetMember) {
                logger.warn("Target user not found in guild.", { targetUserId: targetUser.id });
                return await interaction.editReply({
                    content: "The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            // We validate and normalize the color format using the utility function.
            const colorValidationResult = validateAndNormalizeColor(colorHex, logger);
            if (!colorValidationResult.success) {
                logger.warn("Invalid color format provided.", { colorHex });
                return await interaction.editReply({
                    content: "Invalid color format. Please use the format #RRGGBB or RRGGBB.",
                    ephemeral: true
                });
            }

            const normalizedColorHex = colorValidationResult.normalizedColor;
            // We convert the hex color to decimal for Discord's color system using the utility function.
            const colorDecimal = hexToDecimal(normalizedColorHex);
            
            // We create and assign the roles to the target member.
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
            
            await interaction.editReply({
                content: `✅ Successfully gave <@${targetUser.id}> permissions in the server!`
            });
                        
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },
    
    /**
     * We validate the command inputs to ensure they meet requirements.
     * This function checks the role name, color, and user validity.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {string} roleName - The name for the new role.
     * @param {string} colorHex - The color for the new role.
     * @param {User} targetUser - The user to receive the role.
     * @returns {Object} An object with success status and message.
     */
    validateInputs(interaction, roleName, colorHex, targetUser) {
        // We validate that the role name is not empty and within Discord's length limits.
        if (!roleName || roleName.trim().length === 0) {
            logger.warn("Invalid role name provided.", { roleName });
            return {
                success: false,
                message: "Please provide a valid role name."
            };
        }

        if (roleName.length > MAX_ROLE_NAME_LENGTH) {
            logger.warn("Role name exceeds maximum length.", { 
                roleName, 
                maxLength: MAX_ROLE_NAME_LENGTH 
            });
            return {
                success: false,
                message: `Role name must be ${MAX_ROLE_NAME_LENGTH} characters or less.`
            };
        }
        
        return { success: true };
    },
    
    /**
     * We create a new role and assign it along with the fren role to the target member.
     * This function creates the role, positions it, and assigns both roles to the user.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {string} roleName - The name for the new role.
     * @param {number} colorDecimal - The color for the new role in decimal format.
     * @param {GuildMember} targetMember - The member to receive the roles.
     * @returns {Object} An object with success status and message.
     */
    async createAndAssignRoles(interaction, roleName, colorDecimal, targetMember) {
        // We get the reference role for positioning the new role in the hierarchy.
        const positionRole = interaction.guild.roles.cache.get(POSITION_ABOVE_ROLE_ID);
        if (!positionRole) {
            logger.error("Reference role not found.", { roleId: POSITION_ABOVE_ROLE_ID });
            return {
                success: false,
                message: ERROR_MESSAGES.ROLE_NOT_FOUND
            };
        }
        
        // We get the additional role that will be assigned to the user.
        const additionalRole = interaction.guild.roles.cache.get(FREN_ROLE_ID);
        if (!additionalRole) {
            logger.error("Additional role not found.", { roleId: FREN_ROLE_ID });
            return {
                success: false,
                message: ERROR_MESSAGES.ROLE_NOT_FOUND
            };
        }
        
        // We check if the bot has sufficient permissions to create a role at the desired position.
        const botMember = await interaction.guild.members.fetchMe();
        if (botMember.roles.highest.position <= positionRole.position) {
            logger.warn("Bot's highest role is not high enough to create a role above the reference role.", {
                botHighestRolePosition: botMember.roles.highest.position,
                referenceRolePosition: positionRole.position
            });
            return {
                success: false,
                message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
            };
        }
        
        // We create the new role with the specified name, color, and position.
        const auditReason = `Role created by ${interaction.user.tag} (ID: ${interaction.user.id}) using giveperms command`;
        const newRole = await interaction.guild.roles.create({
            name: roleName,
            color: colorDecimal,
            position: positionRole.position + 1,
            reason: auditReason
        });
        
        logger.info("New role created.", { 
            roleId: newRole.id, 
            roleName: newRole.name, 
            position: newRole.position,
            createdBy: interaction.user.tag
        });
        
        // We assign both the new role and the fren role to the target user.
        await targetMember.roles.add([newRole.id, additionalRole.id], auditReason);
        
        logger.info("Permissions successfully granted to user.", { 
            userId: targetMember.id, 
            userTag: targetMember.user.tag,
            roles: [newRole.name, additionalRole.name],
            roleIds: [newRole.id, additionalRole.id]
        });
        
        return { success: true };
    },
    
    /**
     * We handle errors that occur during command execution.
     * This function logs the error and attempts to notify the user.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Error} error - The error that occurred.
     */
    async handleError(interaction, error) {
        logError(error, 'giveperms', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        try {
            await interaction.editReply({ 
                content: getErrorMessage(error),
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for giveperms command.", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: getErrorMessage(error),
                ephemeral: true 
            }).catch(() => {
                // We silently catch if all error handling attempts fail.
            });
        }
    }
};