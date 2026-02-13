const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { isFormerMember } = require('../utils/database');

/**
 * Formats a permission key for display (e.g. "KickMembers" -> "Kick Members").
 * @param {string} key - Permission key from PermissionFlagsBits
 * @returns {string}
 */
function formatPermissionName(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

/**
 * Command module for viewing user information (user context menu).
 * @type {Object}
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('View User Information')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(null),

  /**
   * Executes the View User Information context menu command.
   * @param {UserContextMenuCommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.targetUser;

    logger.info('View User Information context menu command initiated.', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      targetUserId: targetUser.id
    });

    try {
      let member = interaction.guild?.members.cache.get(targetUser.id);
      if (interaction.guild && !member) {
        member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      }
      let extraPermissions = [];
      let returningValue = '—';
      let isReturning = null;
      try {
        isReturning = await isFormerMember(targetUser.id);
        if (isReturning === true || isReturning === false) {
          returningValue = isReturning ? 'Yes' : 'No';
        }
      } catch (error) {
        logger.warn('Failed to check returning status from database in View User Information.', {
          err: error,
          targetUserId: targetUser.id
        });
      }

      const displayName = member?.displayName ?? targetUser.globalName ?? targetUser.username;
      const globalAvatarURL = targetUser.displayAvatarURL({ size: 1024 });
      const serverAvatarURL = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
      const createdTimestamp = Math.floor(targetUser.createdAt.getTime() / 1000);

      const avatarURL = serverAvatarURL ?? globalAvatarURL;
      const fields = [
        { name: 'Username', value: targetUser.username, inline: true },
        { name: 'Display Name', value: `<@${targetUser.id}>`, inline: true },
        { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
        { name: 'Returning', value: returningValue, inline: true },
        { name: 'ID', value: targetUser.id, inline: true },
        {
          name: 'Created',
          value: `<t:${createdTimestamp}:F>\n(<t:${createdTimestamp}:R>)`,
          inline: false
        }
      ];
      if (member?.joinedAt) {
        const joinedTimestamp = Math.floor(member.joinedAt.getTime() / 1000);
        fields.push({
          name: 'Joined',
          value: `<t:${joinedTimestamp}:F>\n(<t:${joinedTimestamp}:R>)`,
          inline: false
        });
      }
      if (member) {
        if (member.communicationDisabledUntilTimestamp != null && member.communicationDisabledUntilTimestamp > Date.now()) {
          const untilTimestamp = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
          fields.push({
            name: 'Timeout',
            value: `Until <t:${untilTimestamp}:F>\n(<t:${untilTimestamp}:R>)`,
            inline: true
          });
        }
        if (member.premiumSince) {
          const boostTimestamp = Math.floor(member.premiumSince.getTime() / 1000);
          fields.push({
            name: 'Booster',
            value: `Since <t:${boostTimestamp}:F>\n(<t:${boostTimestamp}:R>)`,
            inline: true
          });
        }
        const diffRole = config.newUserPermissionDiffRoleId
          ? member.guild.roles.cache.get(config.newUserPermissionDiffRoleId)
          : null;
        if (diffRole) {
          const memberPerms = member.permissions.toArray();
          extraPermissions = memberPerms.filter(p => !diffRole.permissions.has(p)).map(formatPermissionName).sort();
          if (extraPermissions.length > 0) {
            fields.push({
              name: 'Permissions',
              value: `**Extra:** ${extraPermissions.join(', ')}`,
              inline: false
            });
          }
        }
      }
      const embed = new EmbedBuilder()
        .setColor(config.baseEmbedColor ?? 0)
        .setAuthor({
          name: displayName,
          iconURL: avatarURL
        })
        .setImage(avatarURL)
        .addFields(fields);

      await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });

      logger.info('View User Information context menu command completed successfully.', {
        userId: interaction.user.id,
        targetUserId: targetUser.id
      });
    } catch (error) {
      logger.error('Error in View User Information context menu command.', {
        err: error,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id
      });
      try {
        await interaction.editReply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
      } catch (e) {
        logger.error('Failed to send error reply.', {
          err: e,
          originalError: error.message,
          userId: interaction.user?.id
        });
      }
    }
  }
};
