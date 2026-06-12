const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { serializeError } = require('../utils/logSanitize.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { validateAndNormalizeColor } = require('../utils/colorUtils');
const config = require('../config');
const { getBotMember } = require('../utils/asyncUtils');
const { validateExistingRoleChange } = require('../utils/roleHierarchyUtils');

/**
 * Command module for changing role colors
 * @type {Object}
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('changecolor')
        .setDescription('Change the color of a role.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('What role do you want to change the color of?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('What color do you want to change to?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the change color command
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @returns {Promise<void>}
     * @throws {Error} If the command execution fails
     */
    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const role = interaction.options.getRole('role');
            const colorInput = interaction.options.getString('color');
            const oldColor = role.hexColor;
            
            logger.info("/changecolor command initiated.", {
                userId: interaction.user.id,
                guildId: interaction.guild.id,
                roleId: role.id,
                colorInput,
                oldColor
            });

            const colorValidation = validateAndNormalizeColor(colorInput);
            if (!colorValidation.success) {
                throw new Error("INVALID_COLOR");
            }

            const botMember = await getBotMember(interaction);
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                throw new Error("BOT_PERMISSION_DENIED");
            }

            const hierarchy = validateExistingRoleChange({
                botMember,
                invokerMember: interaction.member,
                role,
                guild: interaction.guild
            });
            if (!hierarchy.ok) {
                if (hierarchy.message.includes('integration')) {
                    throw new Error('ROLE_NOT_MANAGEABLE');
                }
                if (hierarchy.message.includes('You cannot')) {
                    throw new Error('INVOKER_HIERARCHY');
                }
                throw new Error('BOT_PERMISSION_DENIED');
            }

            await role.setColor(colorValidation.normalizedColor);
            
            const embed = new EmbedBuilder()
                .setColor(colorValidation.normalizedColor)
                .setTitle('Role Color Updated')
                .setDescription(`Successfully changed the color of ${role} from **${oldColor}** to **${colorValidation.normalizedColor}**.`);
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/changecolor command completed successfully.", {
                roleId: role.id,
                oldColor,
                newColor: colorValidation.normalizedColor
            });
        } catch (error) {
            logger.error("Error occurred in change color command.", { ...serializeError(error, { includeStack: true }),
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                roleId: interaction.options?.getRole('role')?.id
            });

            let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
            
            if (error.message === "INVALID_COLOR") {
                errorMessage = "⚠️ Invalid color format. Please provide a valid hex color code (e.g., #FF0000).";
            } else if (error.message === "BOT_PERMISSION_DENIED") {
                errorMessage = "⚠️ I don't have permission to manage roles in this server.";
            } else if (error.message === "ROLE_NOT_MANAGEABLE") {
                errorMessage = "⚠️ This role is managed by an integration and cannot be modified.";
            } else if (error.message === "INVOKER_HIERARCHY") {
                errorMessage = '⚠️ You cannot manage a role that is above or equal to your highest role.';
            }
            
            try {
                await interaction.editReply({ 
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral 
                });
            } catch (followUpError) {
                logger.error("Failed to send error response for change color command.", { ...serializeError(followUpError, { includeStack: true }),
                    originalError: error.message,
                    userId: interaction.user?.id
                });
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(config.baseEmbedColor)
                    .setTitle('Error')
                    .setDescription(errorMessage);
                
                await interaction.reply({ 
                    embeds: [errorEmbed],
                    flags: MessageFlags.Ephemeral 
                }).catch(() => {});
            }
        }
    }
};