const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/** Permission bits that count as "moderator" (kick, ban, manage messages, timeout, manage threads). */
const MODERATOR_PERMISSIONS = [
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageThreads
];

/** Role ID used to indicate the member has been in the server before (e.g. returning member role). */
const BEEN_IN_SERVER_BEFORE_ROLE_ID = '1471298047265734929';

/** Human-readable labels for user flag keys (public badges). All flags included so every badge is shown. */
const USER_FLAG_LABELS = {
  Staff: 'Discord Staff',
  Partner: 'Partnered Server Owner',
  Hypesquad: 'HypeSquad Events',
  BugHunterLevel1: 'Bug Hunter Level 1',
  MFASMS: 'MFA SMS',
  PremiumPromoDismissed: 'Premium Promo Dismissed',
  HypeSquadOnlineHouse1: 'HypeSquad Bravery',
  HypeSquadOnlineHouse2: 'HypeSquad Brilliance',
  HypeSquadOnlineHouse3: 'HypeSquad Balance',
  PremiumEarlySupporter: 'Early Nitro Supporter',
  TeamPseudoUser: 'Team User',
  HasUnreadUrgentMessages: 'Has Unread Urgent Messages',
  BugHunterLevel2: 'Bug Hunter Level 2',
  VerifiedBot: 'Verified Bot',
  VerifiedDeveloper: 'Verified Bot Developer',
  CertifiedModerator: 'Certified Moderator',
  BotHTTPInteractions: 'Bot HTTP Interactions',
  Spammer: 'Spammer',
  DisablePremium: 'Disable Premium',
  ActiveDeveloper: 'Active Developer',
  Quarantined: 'Quarantined',
  Collaborator: 'Collaborator',
  RestrictedCollaborator: 'Restricted Collaborator'
};

/** Max length for each badges field value (Discord embed limit 1024). */
const BADGES_FIELD_MAX_LENGTH = 1020;

/**
 * Turns a camelCase or PascalCase key into a readable label (e.g. "SomeKey" -> "Some Key").
 * @param {string} key - Flag key
 * @returns {string}
 */
function flagKeyToLabel(key) {
  return USER_FLAG_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

/**
 * Returns all user badge names for display, split into chunks if needed to fit embed fields.
 * @param {User} user - Discord user (flags may be null if not fetched)
 * @returns {string[]} One or more strings (e.g. [] for no badges, or ['Badge1, Badge2', 'Badge3'] for continuation)
 */
function formatUserBadgesChunks(user) {
  if (!user?.flags?.bitfield) return [];
  const keys = user.flags.toArray();
  if (keys.length === 0) return [];
  const display = keys.map(k => flagKeyToLabel(k));
  const chunks = [];
  let current = '';
  for (const label of display) {
    const next = current ? `${current}, ${label}` : label;
    if (next.length <= BADGES_FIELD_MAX_LENGTH) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = label;
    }
  }
  if (current) chunks.push(current);
  return chunks;
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
    await interaction.deferReply();

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

      const displayName = member?.displayName ?? targetUser.globalName ?? targetUser.username;
      const globalAvatarURL = targetUser.displayAvatarURL({ size: 1024 });
      const serverAvatarURL = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
      const createdTimestamp = Math.floor(targetUser.createdAt.getTime() / 1000);

      const avatarURL = serverAvatarURL ?? globalAvatarURL;
      const fields = [
        { name: 'Username', value: targetUser.username, inline: true },
        { name: 'Display Name', value: displayName, inline: true },
        { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
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
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        const isModerator = isAdmin || member.permissions.any(MODERATOR_PERMISSIONS);
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
        fields.push(
          { name: 'Administrator', value: isAdmin ? 'Yes' : 'No', inline: true },
          { name: 'Moderator', value: isModerator ? 'Yes' : 'No', inline: true },
          { name: 'Returning', value: beenInServerBefore ? 'Yes' : 'No', inline: true }
        );
      }
      const badgesChunks = formatUserBadgesChunks(targetUser);
      badgesChunks.forEach((value, i) => {
        fields.push({
          name: badgesChunks.length === 1 ? 'Badges' : `Badges (${i + 1})`,
          value,
          inline: false
        });
      });
      const embed = new EmbedBuilder()
        .setColor(config.baseEmbedColor ?? 0)
        .setAuthor({
          name: displayName,
          iconURL: avatarURL
        })
        .setImage(avatarURL)
        .addFields(fields)
        .setFooter({ text: `User ID: ${targetUser.id}` });

      await interaction.editReply({ embeds: [embed] });

      logger.info('/newuser command completed successfully.', {
        userId: interaction.user.id,
        targetUserId: targetUser.id,
        guildId: interaction.guildId
      });
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
