const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { validateAndNormalizeColor, hexToDecimal } = require('../utils/colorUtils');

// Configuration constants.
const POSITION_ABOVE_ROLE_ID = config.givePermsPositionAboveRoleId;
const FREN_ROLE_ID = config.givePermsFrenRoleId;
const MAX_ROLE_NAME_LENGTH = 100; // Discord's maximum role name length.

// Validate required configuration.
if (!POSITION_ABOVE_ROLE_ID || !FREN_ROLE_ID) {
    logger.error("Missing required configuration for /giveperms command.", {
        positionAboveRoleId: POSITION_ABOVE_ROLE_ID,
        frenRoleId: FREN_ROLE_ID
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
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // Check if required configuration is available.
        if (!POSITION_ABOVE_ROLE_ID || !FREN_ROLE_ID) {
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
            
            // Validate inputs
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
            
            // Fetch the target member from the guild.
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            if (!targetMember) {
                logger.warn("Target user not found in guild.", { targetUserId: targetUser.id });
                return await interaction.editReply({
                    content: "The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            // Validate and normalize color format using the utility function.
            const colorValidationResult = validateAndNormalizeColor(colorHex, logger);
            if (!colorValidationResult.success) {
                logger.warn("Invalid color format provided.", { colorHex });
                return await interaction.editReply({
                    content: "Invalid color format. Please use the format #RRGGBB or RRGGBB.",
                    ephemeral: true
                });
            }

            const normalizedColorHex = colorValidationResult.normalizedColor;
            // Convert hex to decimal for Discord's color system using the utility function.
            const colorDecimal = hexToDecimal(normalizedColorHex);
            
            // Create and assign roles
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
                content: this.getErrorMessage(error),
                ephemeral: true
            });
        }
    },
    
    /**
     * Validates the command inputs.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {string} roleName - The name for the new role.
     * @param {string} colorHex - The color for the new role.
     * @param {User} targetUser - The user to receive the role.
     * @returns {Object} An object with success status and message.
     */
    validateInputs(interaction, roleName, colorHex, targetUser) {
        // Validate role name.
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
     * Creates a new role and assigns it along with the fren role to the target member.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {string} roleName - The name for the new role.
     * @param {number} colorDecimal - The color for the new role in decimal format.
     * @param {GuildMember} targetMember - The member to receive the roles.
     * @returns {Object} An object with success status and message.
     */
    async createAndAssignRoles(interaction, roleName, colorDecimal, targetMember) {
        // Get the reference role for positioning.
        const positionRole = interaction.guild.roles.cache.get(POSITION_ABOVE_ROLE_ID);
        if (!positionRole) {
            logger.error("Reference role not found.", { roleId: POSITION_ABOVE_ROLE_ID });
            return {
                success: false,
                message: "⚠️ Reference role for positioning not found. Please check the positioning role ID."
            };
        }
        
        // Get the additional role to assign.
        const additionalRole = interaction.guild.roles.cache.get(FREN_ROLE_ID);
        if (!additionalRole) {
            logger.error("Additional role not found.", { roleId: FREN_ROLE_ID });
            return {
                success: false,
                message: "⚠️ Additional role not found. Please check the Fren role ID."
            };
        }
        
        // Check if the bot can create a role at the desired position
        const botMember = await interaction.guild.members.fetchMe();
        if (botMember.roles.highest.position <= positionRole.position) {
            logger.warn("Bot's highest role is not high enough to create a role above the reference role.", {
                botHighestRolePosition: botMember.roles.highest.position,
                referenceRolePosition: positionRole.position
            });
            return {
                success: false,
                message: "⚠️ I don't have permission to create a role at the desired position. My highest role must be above the reference role."
            };
        }
        
        // Create the new role.
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
        
        // Assign both roles to the user.
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
     * Gets a user-friendly error message based on the error.
     * @param {Error} error - The error object.
     * @returns {string} A user-friendly error message.
     */
    getErrorMessage(error) {
        if (error.code === 50013) {
            return "⚠️ I don't have permission to manage roles. Please check my permissions.";
        } else if (error.message.includes('Maximum number of server roles reached')) {
            return "⚠️ This server has reached the maximum number of roles allowed by Discord.";
        } else if (error.message.includes('rate limit')) {
            return "⚠️ Discord is currently rate limiting this action. Please try again in a few moments.";
        }
        return "⚠️ An unexpected error occurred. Please try again later.";
    }
};