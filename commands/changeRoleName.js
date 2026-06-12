const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { serializeError } = require('../utils/logSanitize.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getBotMember } = require('../utils/asyncUtils');
const { validateExistingRoleChange } = require('../utils/roleHierarchyUtils');

/**
 * Command module for changing a role's name.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('changerolename')
    .setDescription('Change the name of a role.')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('What role do you want to change the name of?')
        .setRequired(true))
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('What name do you want to change the role to?')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  /**
   * Executes the change role name command.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const role = interaction.options.getRole('role');
    const newName = interaction.options.getString('name').trim();

    logger.info('/changerolename command initiated.', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      roleId: role.id,
      oldName: role.name,
      newName
    });

    try {
      const botMember = await getBotMember(interaction);
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return await interaction.editReply({
          content: "⚠️ I don't have permission to manage roles.",
          flags: MessageFlags.Ephemeral
        });
      }

      const hierarchy = validateExistingRoleChange({
        botMember,
        invokerMember: interaction.member,
        role,
        guild: interaction.guild
      });
      if (!hierarchy.ok) {
        return await interaction.editReply({
          content: hierarchy.message,
          flags: MessageFlags.Ephemeral
        });
      }

      if (newName.length < 1 || newName.length > 100) {
        return await interaction.editReply({
          content: '⚠️ Role name must be between 1 and 100 characters.',
          flags: MessageFlags.Ephemeral
        });
      }

      const oldName = role.name;
      await role.setName(newName, `Renamed by ${interaction.user.tag} (ID: ${interaction.user.id}) via /changerolename`);

      const fields = [
        { name: 'Role', value: newName, inline: true },
        { name: 'Color', value: role.hexColor, inline: true }
      ];
      const embed = new EmbedBuilder()
        .setColor(role.color || 0)
        .setTitle('Role renamed')
        .setDescription(`Renamed role from **${oldName}** to **${newName}**.`)
        .addFields(fields);

      await interaction.editReply({ embeds: [embed] });

      logger.info('/changerolename command completed successfully.', {
        roleId: role.id,
        oldName,
        newName,
        userId: interaction.user.id
      });
    } catch (error) {
      await this.handleError(error, interaction);
    }
  },

  /**
   * Handles errors during command execution.
   * @param {Error} error - The error that occurred
   * @param {CommandInteraction} interaction - The interaction
   * @returns {Promise<void>}
   */
  async handleError(error, interaction) {
    logger.error('Error in changeRoleName command.', { ...serializeError(error, { includeStack: true }),
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });

    let message = "⚠️ An unexpected error occurred while renaming the role. Please try again later.";
    if (error.code === 50013) {
      message = "⚠️ I don't have permission to edit that role, or it's above my highest role.";
    } else if (error.code === 50035 && error.rawError?.errors?.name) {
      message = '⚠️ Invalid role name. It must be 1–100 characters and follow Discord\'s rules.';
    }

    try {
      await interaction.editReply({ content: message, flags: MessageFlags.Ephemeral });
    } catch (e) {
      logger.error('Failed to send error reply.', { ...serializeError(e, { includeStack: true }),
        originalError: error.message,
        userId: interaction.user?.id
      });
    }
  }
};
