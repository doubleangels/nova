/**
 * Change color command module for modifying role colors.
 * Handles color validation, role updates, and permission checks.
 * @module commands/changeColor
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { validateAndNormalizeColor } = require('../utils/colorUtils');

const COLOR_EMBED_FOOTER_PREFIX = "Updated by";
const COLOR_EMBED_TITLE = 'Role Color Updated';

const COLOR_ERROR_BOT_PERMISSION = "⚠️ I don't have permission to manage roles in this server.";
const COLOR_ERROR_INVALID_FORMAT = "⚠️ Invalid color format. Please provide a valid hex color code (e.g., #FF0000).";
const COLOR_ERROR_ROLE_NOT_MANAGEABLE = "⚠️ I cannot modify this role. It may be managed by an integration or have higher permissions than me.";
const COLOR_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred. Please try again later.";

/**
 * We handle the changecolor command.
 * This function changes the color of a specified role to the provided hex color.
 *
 * We perform several tasks:
 * 1. We validate the provided hex color.
 * 2. We check if the role exists and is editable.
 * 3. We update the role's color.
 * 4. We notify the user of the change.
 *
 * @param {Interaction} interaction - The Discord interaction object.
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
     * Executes the change color command.
     * @async
     * @function execute
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @throws {Error} If role update fails or color is invalid
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const role = interaction.options.getRole('role');
            const colorInput = interaction.options.getString('color');
            const oldColor = role.hexColor;
            
            logger.info("/changecolor command initiated:", {
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

            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                throw new Error("BOT_PERMISSION_DENIED");
            }

            await role.setColor(colorValidation.normalizedColor);
            
            const embed = new EmbedBuilder()
                .setColor(colorValidation.normalizedColor)
                .setTitle('Role Color Updated')
                .setDescription(`Successfully changed the color of ${role} from \`${oldColor}\` to \`${colorValidation.normalizedColor}\`!`)
                .setFooter({ text: `Updated by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("Role color updated successfully:", {
                roleId: role.id,
                oldColor,
                newColor: colorValidation.normalizedColor
            });
        } catch (error) {
            logger.error("Error in change color command:", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                roleId: interaction.options?.getRole('role')?.id
            });

            let errorMessage = COLOR_ERROR_UNEXPECTED;
            
            if (error.message === "INVALID_COLOR") {
                errorMessage = COLOR_ERROR_INVALID_FORMAT;
            } else if (error.message === "BOT_PERMISSION_DENIED") {
                errorMessage = COLOR_ERROR_BOT_PERMISSION;
            } else if (error.message === "ROLE_NOT_MANAGEABLE") {
                errorMessage = COLOR_ERROR_ROLE_NOT_MANAGEABLE;
            }
            
            try {
                await interaction.editReply({ 
                    content: errorMessage,
                    ephemeral: true 
                });
            } catch (followUpError) {
                logger.error("Failed to send error response for change color command:", {
                    error: followUpError.message,
                    originalError: error.message,
                    userId: interaction.user?.id
                });
                
                await interaction.reply({ 
                    content: errorMessage,
                    ephemeral: true 
                }).catch(() => {});
            }
        }
    }
};