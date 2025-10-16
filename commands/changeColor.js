const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { validateAndNormalizeColor } = require('../utils/colorUtils');

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
                .setTitle('🎨 Role Color Updated')
                .setDescription(`Successfully changed the color of ${role} from \`${oldColor}\` to \`${colorValidation.normalizedColor}\`!`);
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/changecolor command completed successfully:", {
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

            let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
            
            if (error.message === "INVALID_COLOR") {
                errorMessage = "⚠️ Invalid color format. Please provide a valid hex color code (e.g., #FF0000).";
            } else if (error.message === "BOT_PERMISSION_DENIED") {
                errorMessage = "⚠️ I don't have permission to manage roles in this server.";
            } else if (error.message === "ROLE_NOT_MANAGEABLE") {
                errorMessage = "⚠️ I cannot modify this role. It may be managed by an integration or have higher permissions than me.";
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
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xcd41ff)
                    .setTitle('Error')
                    .setDescription(errorMessage);
                
                await interaction.reply({ 
                    embeds: [errorEmbed],
                    ephemeral: true 
                }).catch(() => {});
            }
        }
    }
};