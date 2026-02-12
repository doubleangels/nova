const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/** Role ID used to indicate the member has been in the server before (e.g. returning member role). */
const BEEN_IN_SERVER_BEFORE_ROLE_ID = '1471298047265734929';

/** Role ID to compare member permissions against (shows diff in embed). */
const PERMISSION_DIFF_ROLE_ID = '742683051607326720';

/**
 * Formats a permission key for display (e.g. "KickMembers" -> "Kick Members").
 * @param {string} key - Permission key from PermissionFlagsBits
 * @returns {string}
 */
function formatPermissionName(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newuser')
    .setDescription("View a user's profile picture, username, display name, and when they created their account.")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('What user do you want to look up?')
        .setRequired(true)),

  /**
   * Executes the newuser command.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('user');

    logger.info('/newuser command initiated.', {
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
      if (member) {
        const beenInServerBefore = member.roles.cache.has(BEEN_IN_SERVER_BEFORE_ROLE_ID);
        if (!beenInServerBefore) {
          await member.roles.add(BEEN_IN_SERVER_BEFORE_ROLE_ID).catch(err => {
            logger.warn('Could not add been-in-server-before role in newuser.', {
              err: err.message,
              guildId: member.guild.id,
              userId: member.id,
              roleId: BEEN_IN_SERVER_BEFORE_ROLE_ID
            });
          });
        }
        returningValue = beenInServerBefore ? 'Yes' : 'No';
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
        const diffRole = member.guild.roles.cache.get(PERMISSION_DIFF_ROLE_ID);
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

      const logUser = {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        target: {
          id: targetUser.id,
          username: targetUser.username,
          globalName: targetUser.globalName ?? null,
          displayName,
          bot: targetUser.bot,
          createdAt: targetUser.createdAt.toISOString()
        }
      };
      if (member) {
        logUser.target.joinedAt = member.joinedAt?.toISOString() ?? null;
        logUser.target.timeoutUntil = member.communicationDisabledUntilTimestamp != null && member.communicationDisabledUntilTimestamp > Date.now()
          ? new Date(member.communicationDisabledUntilTimestamp).toISOString()
          : null;
        logUser.target.boosterSince = member.premiumSince ? member.premiumSince.toISOString() : null;
        logUser.target.returning = member.roles.cache.has(BEEN_IN_SERVER_BEFORE_ROLE_ID);
        logUser.target.extraPermissions = extraPermissions?.length > 0 ? extraPermissions : null;
      } else {
        logUser.target.inGuild = false;
      }
      logger.info('/newuser command completed successfully.', logUser);
    } catch (error) {
      logger.error('Error in newuser command.', {
        err: error,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id
      });
      try {
        await interaction.editReply({
          content: "⚠️ An unexpected error occurred. Please try again later.",
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
