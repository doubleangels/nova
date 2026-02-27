const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { createPaginatedResults } = require('../utils/searchUtils');

/**
 * Command module for auditing member permissions.
 * Lists members with moderator-level permissions vs standard users.
 * Restricted to administrators.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Audit which members have moderator-level permissions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('admin')
        .setDescription('List members with the Administrator permission.')
        .addBooleanOption(option =>
          option
            .setName('include-bots')
            .setDescription('Would you like to include bot accounts in the audit? (default: no)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('moderator')
        .setDescription('List members with moderator-level permissions.')
        .addBooleanOption(option =>
          option
            .setName('include-bots')
            .setDescription('Would you like to include bot accounts in the audit? (default: no)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('kick')
        .setDescription('List members who can kick.')
        .addBooleanOption(option =>
          option
            .setName('include-bots')
            .setDescription('Would you like to include bot accounts in the audit? (default: no)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('ban')
        .setDescription('List members who can ban.')
        .addBooleanOption(option =>
          option
            .setName('include-bots')
            .setDescription('Would you like to include bot accounts in the audit? (default: no)')
            .setRequired(false)
        )
    ),

  /**
   * Executes the audit command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    logger.info('/audit command initiated.', {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({
          content: '⚠️ This command can only be used in a server.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const includeBots = interaction.options.getBoolean('include-bots') ?? false;
      const subcommand = interaction.options.getSubcommand();
      const members = await guild.members.fetch();

      const moderatorMembers = [];
      const standardMembers = [];
      const kickMembers = [];
      const banMembers = [];

      for (const [, member] of members) {
        if (!includeBots && member.user.bot) continue;

        const perms = member.permissions;
        const isAdmin = perms.has(PermissionFlagsBits.Administrator);
        const canKick = perms.has(PermissionFlagsBits.KickMembers);
        const canBan = perms.has(PermissionFlagsBits.BanMembers);
        const hasModPerms = perms.any([
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageNicknames,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ModerateMembers
        ]) || canKick || canBan;

        if (isAdmin || hasModPerms) {
          moderatorMembers.push(member);
        } else {
          standardMembers.push(member);
        }

        if (canKick) {
          kickMembers.push(member);
        }

        if (canBan) {
          banMembers.push(member);
        }
      }

      const PERMISSION_LABELS = [
        { bit: PermissionFlagsBits.Administrator, label: 'Administrator' },
        { bit: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
        { bit: PermissionFlagsBits.KickMembers, label: 'Kick Members' },
        { bit: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
        { bit: PermissionFlagsBits.ManageMessages, label: 'Manage Messages' },
        { bit: PermissionFlagsBits.ManageNicknames, label: 'Manage Nicknames' },
        { bit: PermissionFlagsBits.ManageRoles, label: 'Manage Roles' },
        { bit: PermissionFlagsBits.ModerateMembers, label: 'Timeout / Moderate Members' }
      ].sort((a, b) => a.label.localeCompare(b.label));

      const EXCLUDED_FOR_MODERATOR_LIST = new Set([
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers
      ]);

      const formatLine = (member, showPerms, excludePowerPerms = false) => {
        const name = member.displayName || member.user.username;
        const boldName = `**${name}**`;

        if (!showPerms) {
          return boldName;
        }

        const memberPermLabels = PERMISSION_LABELS
          .filter(p => {
            if (!member.permissions.has(p.bit)) return false;
            if (excludePowerPerms && EXCLUDED_FOR_MODERATOR_LIST.has(p.bit)) return false;
            return true;
          })
          .map(p => p.label);

        const permsText = memberPermLabels.length > 0
          ? memberPermLabels.join(', ')
          : 'None';

        return `${boldName} — ${permsText}`;
      };

      const buildPages = (membersList, showPerms, excludePowerPerms = false) => {
        let effectiveMembers = membersList;

        if (showPerms && excludePowerPerms) {
          // For moderators, only keep members who still have at least one
          // non-admin / non-kick / non-ban moderation permission.
          effectiveMembers = membersList.filter(member =>
            PERMISSION_LABELS.some(p =>
              member.permissions.has(p.bit) && !EXCLUDED_FOR_MODERATOR_LIST.has(p.bit)
            )
          );
        }

        if (effectiveMembers.length === 0) {
          return ['None'];
        }

        const lines = effectiveMembers
          .map(member => formatLine(member, showPerms, excludePowerPerms))
          .sort((a, b) => a.localeCompare(b));

        const pages = [];
        let currentLines = [];
        let currentLength = 0;

        for (const line of lines) {
          const extraLength = (currentLines.length > 0 ? 1 : 0) + line.length;

          // Split into multiple pages if we'd exceed a safe limit
          if (currentLines.length >= 25 || currentLength + extraLength > 900) {
            pages.push(currentLines.join('\n'));
            currentLines = [line];
            currentLength = line.length;
          } else {
            currentLines.push(line);
            currentLength += extraLength;
          }
        }

        if (currentLines.length > 0) {
          pages.push(currentLines.join('\n'));
        }

        return pages;
      };

      let targetMembers;
      let title;
      let description;
      let showPermsForMembers = false;
      let excludePowerPermsForMembers = false;

      if (subcommand === 'admin') {
        targetMembers = moderatorMembers.filter(m => m.permissions.has(PermissionFlagsBits.Administrator));
        title = `Admins (${targetMembers.length})`;
        description = 'Members with the Administrator permission.';
        showPermsForMembers = false;
      } else if (subcommand === 'moderator') {
        targetMembers = moderatorMembers.filter(m => !m.permissions.has(PermissionFlagsBits.Administrator));
        title = `Moderators (${targetMembers.length})`;
        description = 'Members with moderator-level permissions but without Administrator.';
        showPermsForMembers = true;
        excludePowerPermsForMembers = true;
      } else if (subcommand === 'kick') {
        targetMembers = kickMembers;
        title = `Members who can kick (${targetMembers.length})`;
        description = 'Members who have the Kick Members permission.';
        showPermsForMembers = false;
      } else if (subcommand === 'ban') {
        targetMembers = banMembers;
        title = `Members who can ban (${targetMembers.length})`;
        description = 'Members who have the Ban Members permission.';
        showPermsForMembers = false;
      } else {
        await interaction.editReply({
          content: '⚠️ Unknown subcommand.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const pages = buildPages(targetMembers, showPermsForMembers, excludePowerPermsForMembers);

      const generateEmbed = (index) => {
        return new EmbedBuilder()
          .setColor(config.baseEmbedColor ?? 0)
          .setTitle(`Permission Audit - ${title}`)
          .setDescription(description)
          .addFields({
            name: 'Members',
            value: pages[index]
          });
      };

      if (pages.length <= 1) {
        await interaction.editReply({
          embeds: [generateEmbed(0)],
          flags: MessageFlags.Ephemeral
        });
      } else {
        await createPaginatedResults(
          interaction,
          pages,
          generateEmbed,
          `audit_${subcommand}`,
          120000,
          logger,
          {
            buttonStyle: ButtonStyle.Secondary,
            prevLabel: 'Previous',
            nextLabel: 'Next',
            prevEmoji: '◀️',
            nextEmoji: '▶️'
          }
        );
      }

      logger.info('/audit command completed successfully.', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        moderatorCount: moderatorMembers.length,
        standardCount: standardMembers.length,
        kickCount: kickMembers.length,
        banCount: banMembers.length
      });
    } catch (error) {
      logger.error('Error in audit command.', {
        err: error,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id
      });

      let errorMessage = '⚠️ An unexpected error occurred while auditing permissions. Please try again later.';

      if (error && (error.name === 'GatewayRateLimitError' || error.constructor?.name === 'GatewayRateLimitError')) {
        const retrySeconds = Math.ceil(error.data?.retry_after ?? error.retry_after ?? 10);
        errorMessage = `⚠️ Discord is temporarily rate limiting member lookups. Please try again in about ${retrySeconds} seconds.`;
      }

      try {
        await interaction.editReply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral
        });
      } catch (replyError) {
        logger.error('Failed to send error reply for audit command.', {
          err: replyError,
          originalError: error.message,
          userId: interaction.user?.id
        });
      }
    }
  }
};

