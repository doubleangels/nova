const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/**
 * Formats a permission key for display (e.g. "KickMembers" -> "Kick Members").
 * @param {string} key - Permission key from PermissionFlagsBits / toArray()
 * @returns {string}
 */
function formatPermissionName(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

/**
 * Command module for comparing two roles' permissions.
 * Shows which permissions are shared (duplicates) between the roles.
 * Restricted to administrators.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('compareroles')
    .setDescription('Compare two roles and see which permissions they share.')
    .addRoleOption(option =>
      option
        .setName('first_role')
        .setDescription('What is the first role you want to compare?')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('second_role')
        .setDescription('What is the second role you want to compare?')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  /**
   * Executes the compareroles command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();

    const roleOne = interaction.options.getRole('first_role');
    const roleTwo = interaction.options.getRole('second_role');

    logger.info('/compareroles command initiated.', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      roleOneId: roleOne?.id ?? null,
      roleTwoId: roleTwo?.id ?? null
    });

    try {
      if (!roleOne || !roleTwo) {
        await interaction.editReply({
          content: '⚠️ Please provide two valid roles to compare.'
        });
        return;
      }

      if (roleOne.id === roleTwo.id) {
        await interaction.editReply({
          content: '⚠️ Please select **two different roles** to compare.'
        });
        return;
      }

      const permsOne = roleOne.permissions.toArray();
      const permsTwo = roleTwo.permissions.toArray();

      const sharedRaw = permsOne.filter(p => permsTwo.includes(p));
      const onlyOneRaw = permsOne.filter(p => !permsTwo.includes(p));
      const onlyTwoRaw = permsTwo.filter(p => !permsOne.includes(p));

      const sharedFormatted = sharedRaw.map(formatPermissionName).sort();
      const onlyOneFormatted = onlyOneRaw.map(formatPermissionName).sort();
      const onlyTwoFormatted = onlyTwoRaw.map(formatPermissionName).sort();

      const embedFields = [
        {
          name: 'Role 1',
          value: `${roleOne} (\`${permsOne.length}\` permissions)`,
          inline: true
        },
        {
          name: 'Role 2',
          value: `${roleTwo} (\`${permsTwo.length}\` permissions)`,
          inline: true
        },
        {
          name: 'Shared permissions',
          value: sharedFormatted.length > 0
            ? sharedFormatted.join(', ')
            : 'None',
          inline: false
        },
        {
          name: 'Only in Role 1',
          value: onlyOneFormatted.length > 0
            ? onlyOneFormatted.join(', ')
            : 'None',
          inline: false
        },
        {
          name: 'Only in Role 2',
          value: onlyTwoFormatted.length > 0
            ? onlyTwoFormatted.join(', ')
            : 'None',
          inline: false
        }
      ];

      const embed = new EmbedBuilder()
        .setColor(config.baseEmbedColor ?? 0)
        .setTitle('Shared Role Permissions')
        .setDescription(`Comparing permissions for ${roleOne} and ${roleTwo}.`)
        .addFields(embedFields);

      await interaction.editReply({
        embeds: [embed]
      });

      logger.info('/compareroles command completed successfully.', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        roleOneId: roleOne.id,
        roleTwoId: roleTwo.id,
        sharedCount: sharedFormatted.length,
        onlyRoleOneCount: onlyOneFormatted.length,
        onlyRoleTwoCount: onlyTwoFormatted.length
      });
    } catch (error) {
      logger.error('Error in compareroles command.', {
        err: error,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id
      });

      try {
        await interaction.editReply({
          content: '⚠️ An unexpected error occurred while comparing permissions. Please try again later.'
        });
      } catch (replyError) {
        logger.error('Failed to send error reply for compareroles command.', {
          err: replyError,
          originalError: error.message,
          userId: interaction.user?.id
        });
      }
    }
  }
};

