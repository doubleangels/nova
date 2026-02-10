const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/**
 * Command module for showing a user's profile (avatar, username, display name, account creation).
 * @type {Object}
 */
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
        { name: 'Display name', value: displayName, inline: true },
        { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
        {
          name: 'Account created',
          value: `<t:${createdTimestamp}:F>\n(<t:${createdTimestamp}:R>)`,
          inline: false
        }
      ];
      if (member?.joinedAt) {
        const joinedTimestamp = Math.floor(member.joinedAt.getTime() / 1000);
        fields.push({
          name: 'Joined server',
          value: `<t:${joinedTimestamp}:F>\n(<t:${joinedTimestamp}:R>)`,
          inline: false
        });
      }
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
