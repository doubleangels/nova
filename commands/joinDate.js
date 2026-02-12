const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/**
 * Command module for showing when a user joined the server.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('joindate')
    .setDescription('See when a user joined this server.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('What user do you want to check the join date of?')
        .setRequired(false)),

  /**
   * Executes the joindate command.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') ?? interaction.user;

    logger.info('/joindate command used.', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      targetUserId: targetUser.id
    });

    try {
      let member = interaction.guild.members.cache.get(targetUser.id);
      if (!member) {
        member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      }

      if (!member) {
        return await interaction.editReply({
          content: "⚠️ The specified user could not be found in this server.",
          flags: MessageFlags.Ephemeral
        });
      }

      const joinedAt = member.joinedAt;
      const createdAt = targetUser.createdAt;

      if (!joinedAt) {
        return await interaction.editReply({
          content: "⚠️ Join date for this member isn't available.",
          flags: MessageFlags.Ephemeral
        });
      }

      const joinTimestamp = Math.floor(joinedAt.getTime() / 1000);
      const createdTimestamp = Math.floor(createdAt.getTime() / 1000);

      const displayName = member.displayName ?? targetUser.username;
      const fields = [
        { name: 'Joined server', value: `<t:${joinTimestamp}:F>\n(<t:${joinTimestamp}:R>)`, inline: false },
        { name: 'Account created', value: `<t:${createdTimestamp}:F>\n(<t:${createdTimestamp}:R>)`, inline: false }
      ];
      const embed = new EmbedBuilder()
        .setColor(config.baseEmbedColor ?? 0)
        .setAuthor({
          name: displayName,
          iconURL: member.displayAvatarURL()
        })
        .setDescription(`Join date for **${displayName}**.`)
        .addFields(fields)
        .setFooter({ text: `User ID: ${targetUser.id}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in joinDate command.', {
        err: error,
        userId: interaction.user?.id,
        guildId: interaction.guildId
      });
      try {
        await interaction.editReply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
      } catch (e) {
        logger.error('Failed to send error reply.', { err: e });
      }
    }
  }
};
