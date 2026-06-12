const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { serializeError } = require('../utils/logSanitize.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getBotMember } = require('../utils/asyncUtils');
const { validateExistingRoleChange } = require('../utils/roleHierarchyUtils');

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Whether the validation was successful
 * @property {string} [message] - Error message if validation failed
 */

/**
 * @typedef {Object} RoleAssignmentResult
 * @property {boolean} success - Whether the role assignment was successful
 * @property {string} [message] - Error message if role assignment failed
 */

/**
 * Command module for assigning existing roles to users.
 * @type {Object}
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giverole')
        .setDescription('Give a role to a user.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to give to the user.')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give the role to.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    /**
     * Executes the give role command.
     * This function:
     * 1. Validates the role and user inputs
     * 2. Checks bot permissions and role hierarchy
     * 3. Assigns the role to the target user
     * 4. Sends a confirmation embed
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error assigning the role
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        logger.info("/giverole command initiated.", {
            userId: interaction.user.id,
            guildId: interaction.guildId
        });

        try {
            const role = interaction.options.getRole('role');
            const targetUser = interaction.options.getUser('user');

            const validationResult = this.validateInputs(interaction, role, targetUser);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message,
                    flags: MessageFlags.Ephemeral
                });
            }

            logger.debug("Processing command options.", {
                roleId: role.id,
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag
            });

            // Check cache before fetching member
            let targetMember = interaction.guild.members.cache.get(targetUser.id);
            if (!targetMember) {
                targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            }
            if (!targetMember) {
                logger.warn("Target user not found in guild.", { targetUserId: targetUser.id });
                return await interaction.editReply({
                    content: "⚠️ The specified user could not be found in this server.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const roleAssignmentResult = await this.assignRole(interaction, role, targetMember);
            if (!roleAssignmentResult.success) {
                return await interaction.editReply({
                    content: roleAssignmentResult.message,
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = [
                { name: 'Role', value: `<@&${role.id}>`, inline: true },
                { name: 'Role Color', value: `\`${role.hexColor}\``, inline: true }
            ];
            const embed = new EmbedBuilder()
                .setColor(role.color)
                .setTitle('Role Assigned')
                .setDescription(`Successfully gave <@${targetUser.id}> the <@&${role.id}> role.`)
                .addFields(fields);

            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Validates the command inputs.
     * Checks if role and user are provided and valid.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Role} role - The role to be assigned
     * @param {User} targetUser - The user to receive the role
     * @returns {ValidationResult} Object containing validation result
     */
    validateInputs(interaction, role, targetUser) {
        if (!role) {
            logger.warn("Invalid role provided.");
            return {
                success: false,
                message: "⚠️ Please provide a valid role."
            };
        }

        if (!targetUser) {
            logger.warn("Invalid user provided.");
            return {
                success: false,
                message: "⚠️ Please provide a valid user."
            };
        }

        return { success: true };
    },

    /**
     * Assigns the role to the target member.
     * Checks bot permissions and role hierarchy before assignment.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Role} role - The role to be assigned
     * @param {GuildMember} targetMember - The member to receive the role
     * @returns {Promise<RoleAssignmentResult>} Object containing role assignment result
     */
    async assignRole(interaction, role, targetMember) {
        const botMember = await getBotMember(interaction);
        const invokerMember = interaction.member;
        if (!invokerMember) {
            return {
                success: false,
                message: '⚠️ Could not verify your member permissions in this server.'
            };
        }

        const hierarchy = validateExistingRoleChange({
            botMember,
            invokerMember,
            role,
            targetMember,
            guild: interaction.guild
        });
        if (!hierarchy.ok) {
            if (hierarchy.message.includes("I don't")) {
                logger.warn("Bot's highest role is not high enough to assign the specified role.", {
                    botHighestRolePosition: botMember.roles.highest.position,
                    rolePosition: role.position
                });
            }
            return { success: false, message: hierarchy.message };
        }

        const auditReason = `Role assigned by ${interaction.user.tag} (ID: ${interaction.user.id}) using giverole command.`;
        await targetMember.roles.add(role.id, auditReason);

        logger.info("/giverole command completed successfully.", {
            userId: targetMember.id,
            userTag: targetMember.user.tag,
            role: role.name,
            roleId: role.id
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
    async handleError(interaction, error) {
        logger.error('Error occurred in giveRole command.', { ...serializeError(error, { includeStack: true }),
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId
        });

        let errorMessage = "⚠️ An unexpected error occurred while giving the role. Please try again later.";

        if (error.message === "INSUFFICIENT_PERMISSIONS") {
            errorMessage = "⚠️ I don't have permission to manage roles.";
        } else if (error.message === "INVALID_ROLE") {
            errorMessage = "⚠️ The specified role is invalid or doesn't exist.";
        } else if (error.message === "INVALID_USER") {
            errorMessage = "⚠️ The specified user is invalid or doesn't exist.";
        } else if (error.message === "USER_NOT_FOUND") {
            errorMessage = "⚠️ Could not find the specified user.";
        }

        try {
            await interaction.editReply({ content: errorMessage, flags: MessageFlags.Ephemeral });
        } catch (replyError) {
            logger.error('Failed to send error message.', { ...serializeError(replyError, { includeStack: true }) });
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
                }
            } catch (followUpError) {
                logger.error('Failed to send error follow-up.', { ...serializeError(followUpError, { includeStack: true }) });
            }
        }
    }
};