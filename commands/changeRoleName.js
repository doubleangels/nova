const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

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
    await interaction.deferReply();

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
      const botMember = interaction.guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return await interaction.editReply({
          content: "I don't have permission to manage roles.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (botMember.roles.highest.position <= role.position) {
        return await interaction.editReply({
          content: "I can't edit that role. It is above or equal to my highest role.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (role.managed) {
        return await interaction.editReply({
          content: "That role is managed by an integration (e.g. bot or Booster) and can't be renamed.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (newName.length < 1 || newName.length > 100) {
        return await interaction.editReply({
          content: 'Role name must be between 1 and 100 characters.',
          flags: MessageFlags.Ephemeral
        });
      }

      const oldName = role.name;
      await role.setName(newName, `Renamed by ${interaction.user.tag} (ID: ${interaction.user.id}) via /changerolename`);

      const embed = new EmbedBuilder()
        .setColor(role.color || 0)
        .setTitle('Role renamed')
        .setDescription(`Renamed role from **${oldName}** to **${newName}**.`)
        .addFields(
          { name: 'Role', value: newName, inline: true },
          { name: 'Color', value: role.hexColor, inline: true }
        );

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
    logger.error('Error in changeRoleName command.', {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });

    let message = "An unexpected error occurred while renaming the role.";
    if (error.code === 50013) {
      message = "I don't have permission to edit that role, or it's above my highest role.";
    } else if (error.code === 50035 && error.rawError?.errors?.name) {
      message = 'Invalid role name. It must be 1–100 characters and follow Discord\'s rules.';
    }

    try {
      await interaction.editReply({ content: message, flags: MessageFlags.Ephemeral });
    } catch (e) {
      logger.error('Failed to send error reply.', {
        err: e,
        originalError: error.message,
        userId: interaction.user?.id
      });
    }
  }
};
